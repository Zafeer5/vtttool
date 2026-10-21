import io
import subprocess
import tempfile
import unittest
import wave
import zipfile
from contextlib import redirect_stdout
from pathlib import Path

from PIL import Image, ImageDraw

from vtt_slideshow_generator import (
    DEFAULT_ZOOM_INTENSITY,
    FFmpegProgressReporter,
    clip_zoom_directions,
    compute_unified_timeline,
    get_ffmpeg_executable,
    is_zoom_enabled,
    render_clips_zip_native,
    run_ffmpeg_with_progress,
    zoom_scale_for_frame,
    zoompan_filter,
)


class TimelineMotionTests(unittest.TestCase):
    def test_ffmpeg_progress_reports_encoded_frames(self):
        with tempfile.TemporaryDirectory(prefix="vtt_progress_test_") as temp:
            output_path = Path(temp) / "progress.mp4"
            ffmpeg = get_ffmpeg_executable()
            reporter = FFmpegProgressReporter(6, 25.0, 76.0)
            output = io.StringIO()
            with redirect_stdout(output):
                result = run_ffmpeg_with_progress(
                    [
                        ffmpeg,
                        "-y",
                        "-f", "lavfi",
                        "-i", "color=c=blue:s=320x180:r=30:d=0.2",
                        "-frames:v", "6",
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-pix_fmt", "yuv420p",
                        str(output_path),
                    ],
                    reporter.callback("progress-test"),
                )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(output_path.exists())
            self.assertIn("[Progress] 76.0%", output.getvalue())

    def test_timeline_uses_each_clip_absolute_frame_boundaries(self):
        timings = [
            {"startTime": 0.0, "endTime": 0.2},
            {"startTime": 0.2, "endTime": 25.2},
        ]

        result = compute_unified_timeline(
            [0.2, 25.0],
            target_total_duration=99.0,
            slide_timings=timings,
        )

        self.assertEqual(result["frame_counts"], [6, 750])
        self.assertEqual(result["total_frames"], 756)
        self.assertAlmostEqual(result["total_duration"], 25.2)
        self.assertEqual(result["clip_timings"][1]["start_frame"], 6)
        self.assertEqual(result["clip_timings"][1]["start_sample"], 8820)
        self.assertEqual(result["clip_timings"][1]["sample_count"], 1_102_500)

    def test_each_video_timing_set_is_independent(self):
        first_video = compute_unified_timeline(
            [1.0, 2.0],
            slide_timings=[
                {"startTime": 0.0, "endTime": 1.0},
                {"startTime": 1.0, "endTime": 3.0},
            ],
        )
        second_video = compute_unified_timeline(
            [4.0, 0.5],
            slide_timings=[
                {"startTime": 0.0, "endTime": 4.0},
                {"startTime": 4.0, "endTime": 4.5},
            ],
        )

        self.assertEqual(first_video["frame_counts"], [30, 60])
        self.assertEqual(first_video["total_frames"], 90)
        self.assertEqual(second_video["frame_counts"], [120, 15])
        self.assertEqual(second_video["total_frames"], 135)

    def test_short_clips_keep_their_own_duration(self):
        timeline = compute_unified_timeline(
            [0.1],
            slide_timings=[{"startTime": 0.0, "endTime": 0.1}],
        )
        self.assertEqual(timeline["frame_counts"], [3])
        self.assertEqual(timeline["total_frames"], 3)

    def test_timeline_gap_does_not_shift_later_clip_boundaries(self):
        timeline = compute_unified_timeline(
            [1.0, 1.0],
            slide_timings=[
                {"startTime": 0.0, "endTime": 1.0},
                {"startTime": 1.5, "endTime": 2.5},
            ],
        )
        self.assertEqual(timeline["total_frames"], 75)
        self.assertEqual(timeline["clip_timings"][1]["start_frame"], 45)
        self.assertEqual(timeline["clip_timings"][1]["frame_count"], 30)

    def test_zoom_is_smooth_bounded_and_has_exact_endpoints(self):
        frame_count = 30
        intensity = DEFAULT_ZOOM_INTENSITY / 100
        for direction, expected_start, expected_end in (
            ("in", 1.0, 1.0 + intensity),
            ("out", 1.0 + intensity, 1.0),
        ):
            scales = [
                zoom_scale_for_frame(index, frame_count, direction, intensity)
                for index in range(frame_count)
            ]
            self.assertAlmostEqual(scales[0], expected_start)
            self.assertAlmostEqual(scales[-1], expected_end)
            self.assertTrue(all(scale >= 1.0 for scale in scales))
            self.assertTrue(
                all(
                    abs(current - previous) <= 0.01
                    for previous, current in zip(scales, scales[1:])
                )
            )
            self.assertTrue(
                all(
                    (current >= previous if direction == "in" else current <= previous)
                    for previous, current in zip(scales, scales[1:])
                )
            )

    def test_clip_directions_are_seeded_and_alternate(self):
        timings = [
            {"zoomSeed": 91},
            {"zoomSeed": 12},
            {"zoomSeed": 44},
            {"zoomSeed": 91},
        ]
        directions = clip_zoom_directions(4, timings)

        self.assertEqual(directions, clip_zoom_directions(4, timings))
        self.assertTrue(
            all(left != right for left, right in zip(directions, directions[1:]))
        )

    def test_zoompan_uses_frame_number_and_lanczos_resampling(self):
        expression = zoompan_filter(30, "in", 0.15, 1920, 1080, 30)

        self.assertIn("zoompan=z=", expression)
        self.assertIn("clip(on/29,0,1)", expression)
        self.assertIn("flags=lanczos", expression)
        self.assertIn("iw/2-iw/zoom/2", expression)
        self.assertNotIn("trunc(", expression)

    def test_zoom_off_is_independent_of_transition_master_setting(self):
        self.assertTrue(is_zoom_enabled({"enabled": False, "zoomEnabled": True}))
        self.assertFalse(is_zoom_enabled({"enabled": True, "zoomEnabled": False}))
        self.assertFalse(is_zoom_enabled({"enabled": False, "zoomEnabled": False}))

    def test_zip_export_preserves_clip_and_master_frame_counts_with_zoom(self):
        fps = 30
        width, height = 320, 180
        timings = [
            {"startTime": 0.0, "endTime": 0.2, "zoomSeed": 17, "zoomDirection": "in"},
            {"startTime": 0.2, "endTime": 1.0, "zoomSeed": 31, "zoomDirection": "out"},
        ]

        with tempfile.TemporaryDirectory(prefix="vtt_zoom_test_") as temp:
            root = Path(temp)
            image_paths = []
            for index, color in enumerate(((210, 55, 45), (40, 95, 210))):
                image = Image.new("RGB", (640, 360), color)
                draw = ImageDraw.Draw(image)
                for x in range(0, 640, 40):
                    draw.line((x, 0, x, 360), fill=(255, 255, 255), width=2)
                for y in range(0, 360, 40):
                    draw.line((0, y, 640, y), fill=(255, 255, 255), width=2)
                image_path = root / f"image_{index}.png"
                image.save(image_path)
                image_paths.append(str(image_path))

            audio_path = root / "audio.wav"
            with wave.open(str(audio_path), "wb") as audio:
                audio.setnchannels(2)
                audio.setsampwidth(2)
                audio.setframerate(44100)
                audio.writeframes(b"\x00" * (44100 * 4))

            ffmpeg = get_ffmpeg_executable()
            for zoom_enabled in (True, False):
                output_zip = root / f"clips_zoom_{zoom_enabled}.zip"
                render_clips_zip_native(
                    image_paths,
                    [0.2, 0.8],
                    str(output_zip),
                    timings,
                    str(audio_path),
                    width,
                    height,
                    {
                        "enabled": False,
                        "zoomEnabled": zoom_enabled,
                        "zoomIntensity": 15,
                        "zoomDirection": "random",
                    },
                    target_total_duration=1.0,
                )

                with zipfile.ZipFile(output_zip) as archive:
                    members = [
                        ("clip_001_0.00s-0.20s.mp4", 6),
                        ("clip_002_0.20s-1.00s.mp4", 24),
                    ]
                    if "full_slideshow_video.mp4" in archive.namelist():
                        members.append(("full_slideshow_video.mp4", 30))
                    for member, expected_frames in members:
                        video_path = root / f"{zoom_enabled}_{member}"
                        video_path.write_bytes(archive.read(member))
                        decoded_video = subprocess.run(
                            [
                                ffmpeg,
                                "-v", "error",
                                "-i", str(video_path),
                                "-map", "0:v:0",
                                "-f", "rawvideo",
                                "-pix_fmt", "rgb24",
                                "-",
                            ],
                            capture_output=True,
                            check=True,
                        ).stdout
                        frame_count = len(decoded_video) // (width * height * 3)
                        self.assertEqual(frame_count, expected_frames, member)
                        rgb_offset = (30 * width + 30) * 3
                        if member == "clip_001_0.00s-0.20s.mp4":
                            slide_color = decoded_video[rgb_offset:rgb_offset + 3]
                            self.assertGreater(slide_color[0], slide_color[2] * 2)
                        elif member == "clip_002_0.20s-1.00s.mp4":
                            slide_color = decoded_video[rgb_offset:rgb_offset + 3]
                            self.assertGreater(slide_color[2], slide_color[0] * 2)

                        decoded_audio = subprocess.run(
                            [
                                ffmpeg,
                                "-v", "error",
                                "-i", str(video_path),
                                "-map", "0:a:0",
                                "-f", "s16le",
                                "-ac", "2",
                                "-ar", "44100",
                                "-",
                            ],
                            capture_output=True,
                            check=True,
                        ).stdout
                        audio_duration = len(decoded_audio) / (2 * 2 * 44100)
                        video_duration = frame_count / fps
                        self.assertLessEqual(
                            abs(audio_duration - video_duration),
                            1 / fps,
                            member,
                        )


if __name__ == "__main__":
    unittest.main()
