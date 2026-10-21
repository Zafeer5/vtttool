#!/usr/bin/env python3
"""
VTT-to-Slideshow Video Generator (Native Python & Local FFmpeg)
================================================================
Bypasses browser WebAssembly limitations by utilizing native FFmpeg
and Python for lightning-fast (often sub-minute) video compilation.

Requirements:
    pip install -r requirements-renderer.txt

Usage:
    python vtt_slideshow_generator.py --vtt subtitles.vtt --script script.txt --images img1.jpg img2.jpg img3.jpg --output output.mp4
"""

import argparse
import os
import re
import shutil
import subprocess
import sys
import tempfile
import concurrent.futures
import json
import zipfile
import math
import random
import threading
import queue
from typing import Callable, List, Dict, Optional, Tuple

try:
    import cv2
    import numpy as np
    HAS_CV2 = True
except ImportError:
    HAS_CV2 = False

try:
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
except ImportError:
    print("Error: Pillow is required. Install it using: pip install pillow")
    sys.exit(1)


# ----------------------------------------------------------------------
# Helper: Locate Native FFmpeg Binary & Hardware Encoders
# ----------------------------------------------------------------------
def get_ffmpeg_executable() -> str:
    """Finds ffmpeg executable from PATH or imageio_ffmpeg bundle."""
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    
    # Check if imageio_ffmpeg is installed
    try:
        import imageio_ffmpeg
        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and os.path.exists(exe):
            return exe
    except ImportError:
        pass

_CACHED_ENCODER = None
_IMAGE_CACHE: Dict[str, any] = {}
DEFAULT_ZOOM_INTENSITY = 2.0

def get_hardware_encoder(ffmpeg_exe: str) -> Tuple[str, List[str]]:
    """Detects available hardware-accelerated H.264 encoder with fast response validation.
    Prioritizes Intel Quick Sync Video (h264_qsv) on Intel Skylake / HD Graphics 530,
    with checks for NVIDIA (h264_nvenc), AMD AMF (h264_amf), Windows MediaFoundation (h264_mf),
    and ultrafast multi-core CPU libx264 fallback.
    """
    global _CACHED_ENCODER
    if _CACHED_ENCODER is not None:
        return _CACHED_ENCODER

    cpu_cores = os.cpu_count() or 4

    # Candidate GPU hardware encoders - prioritize Intel Quick Sync Video (h264_qsv)
    candidates = [
        (
            "h264_qsv",
            [
                "-c:v", "h264_qsv",
                "-preset", "veryfast",
                "-async_depth", "4",
                "-global_quality", "23",
                "-g", "60",
                "-keyint_min", "30",
            ],
            "Intel Quick Sync Video (h264_qsv)"
        ),
        (
            "h264_nvenc",
            [
                "-c:v", "h264_nvenc",
                "-preset", "p1",
                "-tune", "ull",
                "-cq", "22",
                "-g", "60",
                "-keyint_min", "30",
            ],
            "NVIDIA NVENC (h264_nvenc)"
        ),
        (
            "h264_amf",
            [
                "-c:v", "h264_amf",
                "-usage", "lowlatency",
                "-quality", "speed",
                "-g", "60",
                "-keyint_min", "30",
            ],
            "AMD AMF (h264_amf)"
        ),
        (
            "h264_mf",
            [
                "-c:v", "h264_mf",
                "-rate_control", "cbr",
                "-b:v", "5M",
                "-g", "60",
            ],
            "Windows MediaFoundation (h264_mf)"
        ),
    ]

    for enc, args, label in candidates:
        try:
            r = subprocess.run(
                [ffmpeg_exe, "-y", "-f", "lavfi", "-i", "color=c=black:s=640x360:d=0.1:r=30", *args, "-f", "null", "-"],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=1.5
            )
            if r.returncode == 0:
                print(f"[*] Hardware video acceleration enabled: {label}")
                _CACHED_ENCODER = (enc, args)
                return _CACHED_ENCODER
        except Exception:
            pass

    print(f"[*] Using multi-threaded CPU encoder: libx264 (ultrafast stillimage, {cpu_cores} threads)")
    _CACHED_ENCODER = ("libx264", [
        "-c:v", "libx264",
        "-preset", "ultrafast",
        "-tune", "stillimage",
        "-crf", "22",
        "-threads", str(cpu_cores),
    ])
    return _CACHED_ENCODER



def prepare_preprocessed_logo(
    logo_path: str,
    target_width: int,
    logo_scale_pct: float,
    logo_opacity: float,
    out_dir: str
) -> Optional[str]:
    """Pre-scales and modulates alpha of the logo watermark once in memory to eliminate per-frame FFmpeg scaling."""
    try:
        with Image.open(logo_path) as l_img:
            l_img = l_img.convert("RGBA")
            target_logo_w = int(target_width * (logo_scale_pct / 100.0))
            if target_logo_w % 2 != 0:
                target_logo_w += 1
            ratio = target_logo_w / float(l_img.width)
            target_logo_h = max(2, int(l_img.height * ratio))
            if target_logo_h % 2 != 0:
                target_logo_h += 1
            resized_logo = l_img.resize((target_logo_w, target_logo_h), Image.Resampling.BILINEAR)
            if logo_opacity < 0.999:
                r, g, b, a = resized_logo.split()
                alpha_factor = max(0.05, min(1.0, float(logo_opacity)))
                a = a.point(lambda p: int(p * alpha_factor))
                resized_logo = Image.merge("RGBA", (r, g, b, a))
            prepped_path = os.path.join(out_dir, "watermark_prepared.png")
            resized_logo.save(prepped_path, "PNG", optimize=False)
            return prepped_path
    except Exception as e:
        sys.stderr.write(f"Warning: could not preprocess logo: {e}\n")
        return None


class FFmpegProgressReporter:
    def __init__(
        self,
        total_frames: int,
        start_percent: float,
        end_percent: float,
    ) -> None:
        self.total_frames = max(1, total_frames)
        self.start_percent = start_percent
        self.end_percent = end_percent
        self._encoded_frames = 0
        self._task_frames: Dict[str, int] = {}
        self._last_reported_percent = start_percent
        self._lock = threading.Lock()

    def emit_stage(self, percent: float, message: str) -> None:
        """Emits a stage progress marker with monotonic guarantee."""
        with self._lock:
            percent = max(self._last_reported_percent, min(100.0, percent))
            self._last_reported_percent = percent
            print(f"[Progress] {percent:.1f}% - {message}", flush=True)

    def add_frames(self, count: int = 1) -> None:
        """Atomically adds rendered frames from parallel chunk workers and emits
        monotonic progress calculated directly as: Total Rendered Frames / Total Expected Frames.
        """
        with self._lock:
            if count <= 0:
                return
            self._encoded_frames = min(
                self.total_frames,
                self._encoded_frames + count,
            )
            progress = self.start_percent + (
                self._encoded_frames / float(self.total_frames)
            ) * (self.end_percent - self.start_percent)
            progress = min(self.end_percent, progress)

            if (
                progress < self.end_percent
                and progress < self._last_reported_percent + 1.0
            ):
                return

            self._last_reported_percent = progress
            print(
                f"[Progress] {progress:.1f}% - "
                f"{self._encoded_frames}/{self.total_frames} frames encoded ({progress:.0f}%)",
                flush=True,
            )

    def update(self, task_id: str, frame_count: int) -> None:
        with self._lock:
            frame_count = max(0, frame_count)
            previous_count = self._task_frames.get(task_id, 0)
            if frame_count <= previous_count:
                return

            delta = frame_count - previous_count
            self._task_frames[task_id] = frame_count
            self._encoded_frames = min(
                self.total_frames,
                self._encoded_frames + delta,
            )
            progress = self.start_percent + (
                self._encoded_frames / float(self.total_frames)
            ) * (self.end_percent - self.start_percent)
            progress = min(self.end_percent, progress)

            if (
                progress < self.end_percent
                and progress < self._last_reported_percent + 1.0
            ):
                return

            self._last_reported_percent = progress
            print(
                f"[Progress] {progress:.1f}% - "
                f"{self._encoded_frames}/{self.total_frames} frames encoded ({progress:.0f}%)",
                flush=True,
            )

    def callback(self, task_id: str) -> Callable[[int], None]:
        return lambda frame_count: self.update(task_id, frame_count)


def run_ffmpeg_with_progress(
    command: List[str],
    on_frame: Optional[Callable[[int], None]] = None,
) -> subprocess.CompletedProcess:
    """Runs FFmpeg while forwarding its encoded-frame progress to the caller."""
    progress_command = [
        *command[:-1],
        "-progress",
        "pipe:1",
        "-nostats",
        command[-1],
    ]
    process = subprocess.Popen(
        progress_command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding="utf-8",
        errors="replace",
        bufsize=1,
    )
    stderr_chunks: List[str] = []

    def collect_stderr() -> None:
        if process.stderr:
            stderr_chunks.append(process.stderr.read())

    stderr_thread = threading.Thread(target=collect_stderr, daemon=True)
    stderr_thread.start()

    if process.stdout:
        for line in process.stdout:
            key, separator, value = line.strip().partition("=")
            if separator and key == "frame" and on_frame:
                try:
                    on_frame(int(value))
                except ValueError:
                    continue

    return_code = process.wait()
    stderr_thread.join()
    if process.stdout:
        process.stdout.close()
    if process.stderr:
        process.stderr.close()
    return subprocess.CompletedProcess(
        command,
        return_code,
        stdout="",
        stderr="".join(stderr_chunks)[-12000:],
    )



# ----------------------------------------------------------------------
# 1. Parse VTT Subtitles
# ----------------------------------------------------------------------
def parse_timestamp_to_seconds(time_str: str) -> float:
    """Parses HH:MM:SS.mmm or MM:SS.mmm to seconds."""
    time_str = time_str.strip().replace(',', '.')
    parts = time_str.split(':')
    if len(parts) == 3:
        return float(parts[0]) * 3600 + float(parts[1]) * 60 + float(parts[2])
    elif len(parts) == 2:
        return float(parts[0]) * 60 + float(parts[1])
    elif len(parts) == 1:
        return float(parts[0])
    return 0.0


def strip_vtt_tags(text: str) -> str:
    """Removes HTML and WebVTT styling tags."""
    clean = re.sub(r'<[^>]+>', '', text)
    clean = clean.replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>')
    return clean.strip()


def normalize_text_for_search(text: str) -> str:
    """Normalizes text by lowercasing and stripping punctuation."""
    clean = strip_vtt_tags(text).lower()
    clean = re.sub(r'[^\w\s\d]', ' ', clean)
    clean = re.sub(r'\s+', ' ', clean)
    return clean.strip()


def parse_vtt(content: str) -> List[Dict]:
    """Parses WebVTT content into a list of cue dictionaries."""
    lines = content.replace('\r\n', '\n').replace('\r', '\n').split('\n')
    cues = []
    
    # Regex to extract start and end timestamps
    time_regex = re.compile(
        r'((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})\s+-->\s+((?:\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{3})'
    )

    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        match = time_regex.search(line)
        if not match:
            # Maybe line is cue identifier, check next line
            if i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                match = time_regex.search(next_line)
                if match:
                    i += 1

        if match:
            start_sec = parse_timestamp_to_seconds(match.group(1))
            end_sec = parse_timestamp_to_seconds(match.group(2))
            duration = max(0.0, end_sec - start_sec)
            
            i += 1
            text_lines = []
            while i < len(lines) and lines[i].strip():
                text_lines.append(lines[i].strip())
                i += 1
            
            raw_text = " ".join(text_lines)
            cues.append({
                'start': start_sec,
                'end': end_sec,
                'duration': duration,
                'text': raw_text,
                'clean_text': strip_vtt_tags(raw_text),
                'normalized': normalize_text_for_search(raw_text),
            })
        else:
            i += 1

    cues.sort(key=lambda x: x['start'])
    return cues


# ----------------------------------------------------------------------
# 2. Parse Script into Paragraphs
# ----------------------------------------------------------------------
def extract_first_sentence(text: str) -> str:
    """Extracts first sentence up to .?! or first line."""
    first_line = text.split('\n')[0].strip()
    match = re.match(r'^(.+?[.?!。！？])(?:\s+|$)', first_line)
    if match:
        return match.group(1).strip()
    return first_line


def parse_script(raw_script: str) -> List[Dict]:
    """
    Splits raw script into paragraphs (1 paragraph = 1 visual slide).
    Paragraphs are separated by double line breaks (\n\n).
    """
    normalized = raw_script.replace('\r\n', '\n').replace('\r', '\n')
    raw_paragraphs = re.split(r'\n\s*\n+', normalized)
    
    paragraphs = []
    for raw_p in raw_paragraphs:
        text = raw_p.strip()
        # Clean prefix like "[Paragraph 1]" if present
        text = re.sub(r'^(?:\[?(?:paragraph|slide|scene)\s*\d+\]?:?\s*)', '', text, flags=re.I).strip()
        if not text:
            continue
        
        lines = [l.strip() for l in text.split('\n') if l.strip()]
        starting_line = lines[0] if lines else text
        starting_sentence = extract_first_sentence(text) or starting_line
        
        words = text.split()
        first_sentence_words = starting_sentence.split()
        leading_words = first_sentence_words[:min(8, max(4, len(first_sentence_words)))]
        search_phrase = normalize_text_for_search(" ".join(leading_words))
        
        paragraphs.append({
            'text': text,
            'starting_line': starting_line,
            'starting_sentence': starting_sentence,
            'words': words,
            'first_sentence_words': first_sentence_words,
            'leading_words': leading_words,
            'search_phrase': search_phrase,
            'full_search_phrase': normalize_text_for_search(starting_sentence),
        })
    return paragraphs


# ----------------------------------------------------------------------
# 3. Match Timestamps & Calculate Durations
# ----------------------------------------------------------------------
def match_script_to_vtt(paragraphs: List[Dict], cues: List[Dict]) -> List[Dict]:
    """
    Matches script paragraphs to VTT subtitle speech cues.
    - Strictly matches the opening 3 to 4 starting words of each paragraph ("firstly shuru kay words").
    - Slide 1 (Paragraph 1) begins at 00:00:00.000 so the video starts immediately.
    - For Paragraph N (N > 0), finds where its first 3 to 4 words appear in VTT cues.
    - Holds Slide N-1 on screen continuously until Paragraph N's opening 3 to 4 words match.
    - Final slide remains active until the voiceover concludes.
    """
    num_p = len(paragraphs)
    if num_p == 0 or len(cues) == 0:
        return []

    start_times = [0.0] * num_p
    matched_cues = [None] * num_p

    current_cue_idx = 0
    for i in range(num_p):
        p = paragraphs[i]
        if i == 0:
            start_times[0] = 0.0
            matched_cues[0] = cues[0] if cues else None
            continue

        raw_words = p.get('words', []) or p.get('text', '').split()
        # Clean punctuation from words
        clean_words = [re.sub(r'^[^\w\s\d]+|[^\w\s\d]+$', '', w).strip() for w in raw_words]
        clean_words = [w for w in clean_words if w]

        opening4 = clean_words[:4]
        opening3 = clean_words[:3]
        matched_cue = None

        # Check if cues are word-level (individual words)
        sample_size = min(30, len(cues))
        avg_words_per_cue = sum(len(c.get('clean_text', '').split()) for c in cues[:sample_size]) / max(1, sample_size)
        is_word_level = len(cues) >= 3 and avg_words_per_cue < 2.2

        # 0. Primary for Word-Level Cues: Match 4 initial words, then 3 initial words
        if is_word_level:
            # 4 initial words
            if len(opening4) >= 4:
                sub_target = [normalize_text_for_search(w) for w in opening4]
                for c_idx in range(current_cue_idx, len(cues) - 4 + 1):
                    match_count = 0
                    for m in range(4):
                        cue_w = cues[c_idx + m]['normalized']
                        target_w = sub_target[m]
                        if cue_w == target_w or (len(cue_w) >= 3 and len(target_w) >= 3 and (cue_w in target_w or target_w in cue_w)):
                            match_count += 1
                    if match_count >= 3:
                        if cues[c_idx]['normalized'] == sub_target[0]:
                            matched_cue = cues[c_idx]
                            current_cue_idx = c_idx + 1
                            break

            # 3 initial words
            if not matched_cue and len(opening3) >= 3:
                sub_target = [normalize_text_for_search(w) for w in opening3]
                for c_idx in range(current_cue_idx, len(cues) - 3 + 1):
                    match_count = sum(1 for m in range(3) if cues[c_idx + m]['normalized'] == sub_target[m])
                    if match_count == 3:
                        matched_cue = cues[c_idx]
                        current_cue_idx = c_idx + 1
                        break

        # 1. Sentence-level cues: Match opening 4 words phrase, then 3 words phrase
        if not matched_cue:
            phrase4 = normalize_text_for_search(" ".join(opening4)) if len(opening4) >= 4 else ""
            phrase3 = normalize_text_for_search(" ".join(opening3)) if len(opening3) >= 3 else ""

            if phrase4:
                for c_idx in range(current_cue_idx, len(cues)):
                    cue_norm = cues[c_idx]['normalized']
                    next_norm = cues[c_idx + 1]['normalized'] if c_idx + 1 < len(cues) else ''
                    window_norm = f"{cue_norm} {next_norm}".strip()
                    if phrase4 in cue_norm or (phrase4 in window_norm and opening4 and normalize_text_for_search(opening4[0]) in cue_norm):
                        matched_cue = cues[c_idx]
                        current_cue_idx = c_idx + 1
                        break

            if not matched_cue and phrase3:
                for c_idx in range(current_cue_idx, len(cues)):
                    cue_norm = cues[c_idx]['normalized']
                    next_norm = cues[c_idx + 1]['normalized'] if c_idx + 1 < len(cues) else ''
                    window_norm = f"{cue_norm} {next_norm}".strip()
                    if phrase3 in cue_norm or (phrase3 in window_norm and opening3 and normalize_text_for_search(opening3[0]) in cue_norm):
                        matched_cue = cues[c_idx]
                        current_cue_idx = c_idx + 1
                        break

        # Chronological progression fallback
        if matched_cue:
            start_sec = matched_cue['start']
        else:
            prev_sec = start_times[i - 1]
            start_sec = prev_sec + 4.0

        # Maintain strict advancement
        if start_sec <= start_times[i - 1]:
            start_sec = start_times[i - 1] + 1.5

        start_times[i] = round(start_sec, 3)
        matched_cues[i] = matched_cue

    # Enforce continuous, gapless intervals:
    # Slide i stays active continuously until Slide i+1 starts (held until next paragraph's opening 3-4 words match)
    last_vtt_end = cues[-1]['end'] if cues else start_times[-1] + 5.0
    matches = []
    for i in range(num_p):
        st = start_times[i]
        if i < num_p - 1:
            et = start_times[i + 1]
        else:
            et = max(st + 3.0, last_vtt_end)

        duration = max(0.5, round(et - st, 3))
        matches.append({
            'index': i,
            'paragraph': paragraphs[i],
            'start': st,
            'end': et,
            'duration': duration,
            'matched_cue': matched_cues[i],
        })

    return matches


# ----------------------------------------------------------------------
# 4. Downscale Images (Vectorized OpenCV & In-Memory Caching)
# ----------------------------------------------------------------------
def downscale_and_normalize_image(
    image_path: str,
    output_path: str,
    target_width: int = 1920,
    target_height: int = 1080
) -> str:
    """
    Downscales large source images to target dimensions with 16:9 aspect ratio fit.
    Vectorized using SIMD OpenCV when available, eliminating pixel loops and CPU bottlenecks.
    Caches normalized in-memory matrices in RAM to eliminate subsequent disk read I/O.
    """
    global _IMAGE_CACHE
    image_path = os.path.abspath(image_path)
    output_path = os.path.abspath(output_path)
    if HAS_CV2:
        try:
            img_data = np.fromfile(image_path, dtype=np.uint8)
            img = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
            if img is not None:
                src_h, src_w = img.shape[:2]
                if src_w == target_width and src_h == target_height:
                    _IMAGE_CACHE[output_path] = img
                    _IMAGE_CACHE[image_path] = img
                    return image_path

                src_aspect = src_w / float(src_h)
                target_aspect = target_width / float(target_height)

                if abs(src_aspect - target_aspect) < 0.005:
                    interp = cv2.INTER_AREA if src_w > target_width else cv2.INTER_LINEAR
                    resized = cv2.resize(img, (target_width, target_height), interpolation=interp)
                    _IMAGE_CACHE[output_path] = resized
                    cv2.imwrite(output_path, resized, [cv2.IMWRITE_JPEG_QUALITY, 95])
                    return output_path

                canvas = np.full((target_height, target_width, 3), (20, 13, 10), dtype=np.uint8)
                if abs(src_aspect - target_aspect) > 0.02:
                    small_w = max(48, target_width // 8)
                    small_h = max(27, target_height // 8)
                    bg_small = cv2.resize(img, (small_w, small_h), interpolation=cv2.INTER_AREA)
                    bg_blur = cv2.blur(bg_small, (7, 7))
                    canvas = cv2.resize(bg_blur, (target_width, target_height), interpolation=cv2.INTER_LINEAR)

                if src_aspect > target_aspect:
                    fg_w = target_width
                    fg_h = int(target_width / src_aspect)
                else:
                    fg_h = target_height
                    fg_w = int(target_height * src_aspect)

                interp = cv2.INTER_AREA if src_w > fg_w else cv2.INTER_LINEAR
                fg = cv2.resize(img, (fg_w, fg_h), interpolation=interp)
                offset_x = (target_width - fg_w) // 2
                offset_y = (target_height - fg_h) // 2
                canvas[offset_y:offset_y + fg_h, offset_x:offset_x + fg_w] = fg
                _IMAGE_CACHE[output_path] = canvas
                cv2.imwrite(output_path, canvas, [cv2.IMWRITE_JPEG_QUALITY, 95])
                return output_path
        except Exception as e:
            sys.stderr.write(f"Warning: OpenCV normalization error for {image_path}: {e}\n")

    # Pillow fallback
    try:
        with Image.open(image_path) as img:
            src_w, src_h = img.size
            if src_w == target_width and src_h == target_height:
                return image_path

            img = img.convert("RGB")
            src_aspect = src_w / float(src_h)
            target_aspect = target_width / float(target_height)

            if abs(src_aspect - target_aspect) < 0.005:
                resized = img.resize((target_width, target_height), Image.Resampling.LANCZOS)
                resized.save(output_path, "JPEG", quality=95, optimize=False)
                return output_path

            canvas = Image.new("RGB", (target_width, target_height), color=(10, 13, 20))
            if abs(src_aspect - target_aspect) > 0.02:
                small_w = max(48, target_width // 8)
                small_h = max(27, target_height // 8)
                bg_small = img.resize((small_w, small_h), Image.Resampling.BILINEAR)
                bg_small = bg_small.filter(ImageFilter.BoxBlur(3))
                bg = bg_small.resize((target_width, target_height), Image.Resampling.BILINEAR)
                canvas.paste(bg, (0, 0))

            if src_aspect > target_aspect:
                fg_w = target_width
                fg_h = int(target_width / src_aspect)
            else:
                fg_h = target_height
                fg_w = int(target_height * src_aspect)

            fg = img.resize((fg_w, fg_h), Image.Resampling.LANCZOS)
            offset_x = (target_width - fg_w) // 2
            offset_y = (target_height - fg_h) // 2
            canvas.paste(fg, (offset_x, offset_y))
            canvas.save(output_path, "JPEG", quality=95, optimize=False)
            return output_path
    except Exception as e:
        sys.stderr.write(f"Warning: normalization error for {image_path}: {e}\n")
        if os.path.abspath(image_path) != os.path.abspath(output_path):
            shutil.copy2(image_path, output_path)
        return output_path


def stream_frames_decoupled(
    frame_render_fn: Callable[[int], bytes],
    frame_count: int,
    proc_stdin,
    max_workers: int = 1,
    queue_size: int = 24,
    on_frame_rendered: Optional[Callable[[int], None]] = None,
) -> None:
    """Streams rendered frames into FFmpeg stdin directly or via queue.
    When max_workers <= 1, streams directly in a single lightweight loop to prevent
    thread thrashing across the 4 CPU cores, avoiding GIL lock contention.
    """
    if max_workers <= 1:
        accum = 0
        for f in range(frame_count):
            data = frame_render_fn(f)
            proc_stdin.write(data)
            accum += 1
            if accum >= 5:
                if on_frame_rendered:
                    on_frame_rendered(accum)
                accum = 0
        if accum > 0 and on_frame_rendered:
            on_frame_rendered(accum)
        return

    frame_queue = queue.Queue(maxsize=queue_size)
    worker_error: List[Exception] = []

    def writer_worker():
        try:
            while True:
                item = frame_queue.get()
                if item is None:
                    frame_queue.task_done()
                    break
                proc_stdin.write(item)
                frame_queue.task_done()
                if on_frame_rendered:
                    on_frame_rendered(1)
        except Exception as e:
            worker_error.append(e)

    writer_t = threading.Thread(target=writer_worker, daemon=True)
    writer_t.start()

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        pending = {}
        next_submit = 0
        next_write = 0
        window = queue_size

        while next_write < frame_count:
            if worker_error:
                raise worker_error[0]

            while next_submit < frame_count and len(pending) < window:
                pending[next_submit] = executor.submit(frame_render_fn, next_submit)
                next_submit += 1

            frame_data = pending.pop(next_write).result()
            frame_queue.put(frame_data)
            next_write += 1

    frame_queue.put(None)
    writer_t.join()
    if worker_error:
        raise worker_error[0]


def render_zoomed_frame(
    img_cv: Optional[any],
    img_pil: Optional[any],
    f_idx: int,
    frame_count: int,
    direction: str,
    intensity: float,
    target_width: int,
    target_height: int,
    logo_cv: Optional[any] = None,
    logo_pil: Optional[any] = None,
    logo_coords: Tuple[int, int] = (0, 0),
) -> bytes:
    """Renders a single frame with Ken Burns zoom using SIMD vectorized matrix operations.
    Releases the Python GIL during C++ SIMD warpAffine, maximizing throughput across all 4 CPU cores.
    """
    scale = zoom_scale_for_frame(f_idx, frame_count, direction, intensity)

    if HAS_CV2 and img_cv is not None:
        center = (target_width / 2.0, target_height / 2.0)
        M = cv2.getRotationMatrix2D(center, 0.0, scale)
        frame = cv2.warpAffine(
            img_cv, M, (target_width, target_height),
            flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
        )
        if logo_cv is not None:
            lw, lh = logo_cv.shape[1], logo_cv.shape[0]
            lx = max(0, min(target_width - lw, logo_coords[0]))
            ly = max(0, min(target_height - lh, logo_coords[1]))
            alpha = (logo_cv[:, :, 3:] / 255.0).astype(np.float32)
            logo_bgr = logo_cv[:, :, :3].astype(np.float32)
            roi = frame[ly:ly+lh, lx:lx+lw].astype(np.float32)
            frame[ly:ly+lh, lx:lx+lw] = (roi * (1.0 - alpha) + logo_bgr * alpha).astype(np.uint8)
        return frame.tobytes()

    # Fallback to PIL
    cw = float(target_width) / scale
    ch = float(target_height) / scale
    left = max(0.0, (float(target_width) - cw) / 2.0)
    top = max(0.0, (float(target_height) - ch) / 2.0)
    box = (left, top, min(float(target_width), left + cw), min(float(target_height), top + ch))
    frame = img_pil.resize((target_width, target_height), resample=Image.Resampling.BICUBIC, box=box)
    if logo_pil:
        frame.paste(logo_pil, logo_coords, mask=logo_pil)
    return frame.tobytes()



def batch_prepare_images(
    image_paths: List[str],
    target_width: int,
    target_height: int,
    temp_dir: str,
    max_workers: int
) -> List[str]:
    """Prepares and normalizes all slide images, eliminating duplicate work and skipping identical dimensions."""
    unique_paths = list(dict.fromkeys(image_paths))
    unique_map: Dict[str, str] = {}
    tasks_to_run = []

    for idx, u_path in enumerate(unique_paths):
        out_target = os.path.join(temp_dir, f"prep_{idx:03d}.jpg")
        tasks_to_run.append((u_path, out_target))

    with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
        future_to_src = {
            executor.submit(downscale_and_normalize_image, src, dst, target_width, target_height): src
            for src, dst in tasks_to_run
        }
        for future in concurrent.futures.as_completed(future_to_src):
            src_orig = future_to_src[future]
            unique_map[src_orig] = future.result()

    return [unique_map[p] for p in image_paths]


# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# 4.5 Unified Frame-Accurate Timeline Calculator
# ----------------------------------------------------------------------
def ease_in_out_sine(progress: float) -> float:
    """Returns the same smooth frame-progress curve used by the preview."""
    progress = max(0.0, min(1.0, progress))
    return -(math.cos(math.pi * progress) - 1.0) / 2.0


def zoom_scale_for_frame(
    frame_index: int,
    frame_count: int,
    direction: str,
    intensity: float
) -> float:
    """Computes a stable floating-point scale for one zero-based clip frame."""
    progress = 0.0 if frame_count <= 1 else max(
        0.0, min(1.0, frame_index / float(frame_count - 1))
    )
    eased = ease_in_out_sine(progress)
    intensity = max(0.0, intensity)
    if direction == "out":
        return max(1.0, 1.0 + intensity - intensity * eased)
    return max(1.0, 1.0 + intensity * eased)


def zoompan_filter(
    frame_count: int,
    direction: str,
    intensity: float,
    width: int,
    height: int,
    fps: int
) -> str:
    """Builds a centered, ultra-smooth and stable FFmpeg zoompan expression.
    
    Eliminates jitter, shudder, and vibration by supersampling into a high-resolution
    buffer (2.5x target dimensions) before applying zoompan, ensuring subpixel coordinate
    rounding errors remain imperceptible when downscaled back to target resolution.
    """
    if intensity > 1.0:
        intensity = intensity / 100.0
    intensity = max(0.0, intensity)

    progress = f"clip(on/{max(1, frame_count - 1)},0,1)"
    eased = f"(0.5-0.5*cos(PI*{progress}))"
    if direction == "out":
        zoom_expr = f"1+{intensity:.8f}-{intensity:.8f}*{eased}"
    else:
        zoom_expr = f"1+{intensity:.8f}*{eased}"

    # Supersampling factor: 2.5x of target resolution eliminates integer crop snap jitter
    upscale_factor = 2.5
    hi_width = int(math.ceil(width * upscale_factor))
    hi_height = int(math.ceil(height * upscale_factor))
    if hi_width % 2:
        hi_width += 1
    if hi_height % 2:
        hi_height += 1
    return (
        f"scale={hi_width}:{hi_height}:flags=lanczos,"
        f"zoompan=z='{zoom_expr}':"
        f"x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':"
        f"d=1:s={width}x{height}:fps={fps},setsar=1,format=yuv420p,"
        f"tpad=stop_mode=clone:stop_duration={frame_count / float(fps):.6f}"
    )


def is_zoom_enabled(motion_settings: Optional[Dict]) -> bool:
    """Treats zoom as an independent toggle from the legacy transitions switch."""
    return bool(motion_settings and motion_settings.get("zoomEnabled", False))


def clip_zoom_directions(
    count: int,
    slide_timings: Optional[List[Dict]],
    default_direction: str = "random"
) -> List[str]:
    """Resolves stable per-clip directions while enforcing alternation when random."""
    directions = []
    previous = None
    for index in range(count):
        timing = slide_timings[index] if slide_timings and index < len(slide_timings) else {}
        stored = timing.get("zoomDirection")
        seed = timing.get("zoomSeed")
        if seed is None:
            seed = index + 1
        if stored in ("in", "out"):
            direction = stored
        elif default_direction in ("in", "out"):
            direction = default_direction
        else:
            direction = "in" if random.Random(int(seed)).random() < 0.5 else "out"
            if direction == previous:
                direction = "out" if direction == "in" else "in"

        directions.append(direction)
        previous = direction
    return directions


def compute_unified_timeline(
    durations: List[float],
    target_total_duration: Optional[float] = None,
    fps: int = 30,
    audio_sample_rate: int = 44100,
    slide_timings: Optional[List[Dict]] = None
) -> Dict:
    """
    Computes a strictly quantized, frame-accurate timeline shared identically
    by both single-video and batch+zip pipelines. Eliminates any floating-point drift,
    different fps rounding, or last-frame padding disparities.
    """
    num_slides = len(durations)
    if num_slides == 0:
        return {
            "durations": [],
            "frame_counts": [],
            "clip_timings": [],
            "total_duration": 0.0,
            "total_frames": 0,
        }

    has_timeline = slide_timings is not None and len(slide_timings) == num_slides
    if slide_timings is not None and not has_timeline:
        raise ValueError("Timeline timing count does not match the clip count.")

    # Quantize absolute clip boundaries instead of redistributing duration error
    # into the final clip.
    frame_counts = []
    start_frames = []
    end_frames = []
    current_frame = 0
    for index, duration in enumerate(durations):
        if has_timeline:
            timing = slide_timings[index]
            if timing.get("startTime") is None or timing.get("endTime") is None:
                raise ValueError(f"Timeline boundaries are missing for clip {index + 1}.")
            start_frame = max(0, int(round(float(timing["startTime"]) * fps)))
            end_frame = max(start_frame + 1, int(round(float(timing["endTime"]) * fps)))
        else:
            start_frame = current_frame
            end_frame = start_frame + max(1, int(round(float(duration) * fps)))
        start_frames.append(start_frame)
        end_frames.append(end_frame)
        frame_counts.append(end_frame - start_frame)
        current_frame = end_frame

    if not has_timeline and target_total_duration and target_total_duration > 0:
        target_total_frames = max(sum(frame_counts), int(round(target_total_duration * fps)))
        frame_counts[-1] += target_total_frames - sum(frame_counts)
        end_frames[-1] = start_frames[-1] + frame_counts[-1]

    total_frames = max(end_frames, default=0)
    final_total_dur = total_frames / float(fps)

    # 3. Audio sample alignment: 44100 / 30 = exactly 1470 samples per video frame
    samples_per_frame = audio_sample_rate // fps if (audio_sample_rate % fps == 0) else (audio_sample_rate / fps)

    unified_durations = []
    clip_timings = []
    for i in range(num_slides):
        f_count = frame_counts[i]
        start_frame = start_frames[i]
        end_frame = end_frames[i]

        st_sec = start_frame / float(fps)
        et_sec = end_frame / float(fps)
        dur_sec = f_count / float(fps)

        start_sample = int(round(start_frame * samples_per_frame))
        sample_count = int(round(f_count * samples_per_frame))

        unified_durations.append(dur_sec)
        clip_timings.append({
            "index": i,
            "start_frame": start_frame,
            "end_frame": end_frame,
            "frame_count": f_count,
            "start_time": st_sec,
            "end_time": et_sec,
            "duration": dur_sec,
            "start_sample": start_sample,
            "sample_count": sample_count,
        })

    return {
        "durations": unified_durations,
        "frame_counts": frame_counts,
        "clip_timings": clip_timings,
        "total_duration": final_total_dur,
        "total_frames": total_frames,
    }


# ----------------------------------------------------------------------
# 5. Execute Native FFmpeg Video Compilation
# ----------------------------------------------------------------------
def render_video_native(
    image_paths: List[str],
    durations: List[float],
    output_video_path: str,
    audio_path: Optional[str] = None,
    target_width: int = 1920,
    target_height: int = 1080,
    motion_settings: Optional[Dict] = None,
    logo_settings: Optional[Dict] = None,
    target_total_duration: Optional[float] = None,
    slide_timings: Optional[List[Dict]] = None,
    progress_start: float = 5.0,
    progress_end: float = 95.0,
) -> None:
    """
    Stitches normalized images into a synchronized MP4 video using native FFmpeg.
    Optimized for maximum speed with 4-core parallel worker pool and Intel Quick Sync Video (QSV).
    Zero re-encode concat demuxer assembles the final video in under 2 seconds.
    Monotonic progress reports from 0% to 100% without redundant loadings or pauses.
    """
    ffmpeg_exe = get_ffmpeg_executable()
    temp_dir = tempfile.mkdtemp(prefix="vtt_sync_")
    cpu_cores = os.cpu_count() or 4
    max_workers = min(cpu_cores, 4)
    threads_per_worker = max(1, cpu_cores // max_workers)

    try:
        # Step A: Deduplicated parallel image pre-processing with dimension caching
        print(f"[Progress] 3.0% - Pre-processing {len(image_paths)} images to {target_width}x{target_height}...", flush=True)
        normalized_paths = batch_prepare_images(
            image_paths, target_width, target_height, temp_dir, max_workers
        )

        motion_enabled = bool(
            motion_settings
            and (
                motion_settings.get("enabled", False)
                or motion_settings.get("zoomEnabled", False)
            )
        )

        # Check logo watermark settings
        has_logo = False
        logo_path = None
        logo_pos = "top-right"
        logo_scale_pct = 15.0
        logo_opacity = 0.9
        logo_margin = 24
        logo_custom_x = 50.0
        logo_custom_y = 50.0

        if logo_settings and logo_settings.get("enabled", False):
            cand_path = logo_settings.get("path") or logo_settings.get("file")
            if cand_path and os.path.exists(cand_path):
                has_logo = True
                logo_path = cand_path
                logo_pos = logo_settings.get("position", "top-right")
                logo_scale_pct = float(logo_settings.get("scale", 15))
                logo_opacity = max(0.05, min(1.0, float(logo_settings.get("opacity", 0.9))))
                logo_margin = int(logo_settings.get("margin", 24))
                logo_custom_x = float(logo_settings.get("customX", 50))
                logo_custom_y = float(logo_settings.get("customY", 50))
                print(f"[*] Logo Watermark Active: {logo_path} (Pos={logo_pos}, Scale={logo_scale_pct}%, Opacity={logo_opacity}, Margin={logo_margin}px)")

        # Preprocess logo once in memory if active to avoid per-frame resizing overhead
        preprocessed_logo = None
        if has_logo and logo_path:
            preprocessed_logo = prepare_preprocessed_logo(
                logo_path, target_width, logo_scale_pct, logo_opacity, temp_dir
            )

        def get_logo_overlay_expr():
            if logo_pos == "top-left":
                return f"x={logo_margin}:y={logo_margin}"
            elif logo_pos == "bottom-right":
                return f"x=W-w-{logo_margin}:y=H-h-{logo_margin}"
            elif logo_pos == "bottom-left":
                return f"x={logo_margin}:y=H-h-{logo_margin}"
            elif logo_pos == "custom":
                return f"x=(W-w)*{logo_custom_x/100:.3f}:y=(H-h)*{logo_custom_y/100:.3f}"
            else: # top-right (default)
                return f"x=W-w-{logo_margin}:y={logo_margin}"

        # Step B: Unified frame-accurate timeline calculation
        fps = 30
        timeline = compute_unified_timeline(
            durations,
            target_total_duration,
            fps=fps,
            slide_timings=slide_timings,
        )
        durations = timeline["durations"]
        final_total_dur = timeline["total_duration"]
        total_frames = timeline["total_frames"]
        clip_timings = timeline["clip_timings"]

        motion_options = motion_settings or {}
        zoom_enabled = is_zoom_enabled(motion_options)
        zoom_pct = float(
            motion_options.get("zoomIntensity", DEFAULT_ZOOM_INTENSITY)
        ) / 100.0
        zoom_dir = motion_options.get("zoomDirection", "random")
        directions = clip_zoom_directions(
            len(normalized_paths), slide_timings, zoom_dir
        )
        effective_zoom_pct = max(0.0, zoom_pct) if zoom_enabled else 0.0

        segments = []
        cursor_frame = 0
        for idx, clip in enumerate(clip_timings):
            if clip["start_frame"] < cursor_frame:
                raise ValueError(
                    f"Timeline clips overlap at clip {idx + 1}; export cannot preserve both boundaries."
                )
            if clip["start_frame"] > cursor_frame:
                segments.append({
                    "kind": "gap",
                    "frame_count": clip["start_frame"] - cursor_frame,
                })
            segments.append({
                "kind": "slide",
                "index": idx,
                "frame_count": clip["frame_count"],
            })
            cursor_frame = clip["end_frame"]

        progress_reporter = FFmpegProgressReporter(
            total_frames, progress_start, progress_end
        )

        enc_name, enc_args = get_hardware_encoder(ffmpeg_exe)

        def render_motion_chunk(segment_index: int, segment: Dict, zoom_pct_val: float) -> str:
            frame_count = segment["frame_count"]
            duration = frame_count / float(fps)
            chunk_path = os.path.join(
                temp_dir, f"chunk_{segment_index:04d}.mp4"
            )

            if enc_name == "libx264":
                chunk_enc_params = [
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-tune", "stillimage",
                    "-crf", "22",
                    "-threads", str(threads_per_worker),
                ]
            else:
                chunk_enc_params = enc_args

            if segment["kind"] == "gap":
                cmd = [
                    ffmpeg_exe, "-y",
                    "-threads", str(threads_per_worker),
                    "-f", "lavfi",
                    "-i", f"color=c=black:s={target_width}x{target_height}:r={fps}:d={duration:.6f}",
                    "-r", str(fps),
                    *chunk_enc_params,
                    "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                    "-t", f"{duration:.6f}",
                    "-movflags", "+faststart",
                    chunk_path,
                ]
                subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
                progress_reporter.add_frames(frame_count)
                return chunk_path

            slide_index = segment["index"]
            img_path = normalized_paths[slide_index]

            # 1. FAST PATH FOR STATIC SLIDES (Zoom Disabled)
            # Hardware encoded via single-image loop in ~0.04s per segment
            if not zoom_enabled or zoom_pct_val <= 0.0001:
                inputs = [
                    "-loop", "1",
                    "-framerate", "1",
                    "-t", f"{duration:.6f}",
                    "-i", img_path,
                ]
                if preprocessed_logo:
                    cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        *inputs,
                        "-i", preprocessed_logo,
                        "-filter_complex", f"[0:v]setsar=1,format=yuv420p[base_v];[base_v][1:v]overlay={get_logo_overlay_expr()}:format=auto[v_out]",
                        "-map", "[v_out]",
                        "-r", str(fps),
                        *chunk_enc_params,
                        "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                        "-t", f"{duration:.6f}",
                        "-movflags", "+faststart",
                        chunk_path,
                    ]
                else:
                    cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        *inputs,
                        "-vf", "setsar=1,format=yuv420p",
                        "-map", "0:v:0",
                        "-r", str(fps),
                        *chunk_enc_params,
                        "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                        "-t", f"{duration:.6f}",
                        "-movflags", "+faststart",
                        chunk_path,
                    ]
                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                if res.returncode != 0:
                    raise RuntimeError(f"FFmpeg static segment {segment_index + 1} failed: {res.stderr.decode('utf-8', errors='ignore')}")
                progress_reporter.add_frames(frame_count)
                return chunk_path

            # 2. SUB-PIXEL CONTINUOUS KEN BURNS ZOOM PATH (Zoom Enabled)
            # Rendered with OpenCV SIMD affine transformation in RAM and piped to FFmpeg stdin
            img_cv = _IMAGE_CACHE.get(img_path)
            if img_cv is None and HAS_CV2:
                try:
                    img_data = np.fromfile(img_path, dtype=np.uint8)
                    img_cv = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
                except Exception:
                    img_cv = None

            if img_cv is None:
                with Image.open(img_path) as src_im:
                    slide_img = src_im.convert("RGB")
            else:
                slide_img = None

            logo_cv = None
            logo_im = None
            logo_pos_coords = (0, 0)
            if preprocessed_logo and os.path.exists(preprocessed_logo):
                try:
                    if HAS_CV2:
                        l_data = np.fromfile(preprocessed_logo, dtype=np.uint8)
                        logo_cv = cv2.imdecode(l_data, cv2.IMREAD_UNCHANGED)
                    logo_im = Image.open(preprocessed_logo).convert("RGBA")
                    lw = logo_cv.shape[1] if logo_cv is not None else logo_im.size[0]
                    lh = logo_cv.shape[0] if logo_cv is not None else logo_im.size[1]
                    if logo_pos == "top-left":
                        logo_pos_coords = (logo_margin, logo_margin)
                    elif logo_pos == "bottom-right":
                        logo_pos_coords = (target_width - lw - logo_margin, target_height - lh - logo_margin)
                    elif logo_pos == "bottom-left":
                        logo_pos_coords = (logo_margin, target_height - lh - logo_margin)
                    elif logo_pos == "custom":
                        logo_pos_coords = (
                            int((target_width - lw) * (logo_custom_x / 100.0)),
                            int((target_height - lh) * (logo_custom_y / 100.0)),
                        )
                    else: # top-right
                        logo_pos_coords = (target_width - lw - logo_margin, logo_margin)
                except Exception:
                    logo_cv = None
                    logo_im = None

            pix_format = "bgr24" if (HAS_CV2 and img_cv is not None) else "rgb24"
            cmd = [
                ffmpeg_exe, "-y",
                "-threads", str(threads_per_worker),
                "-f", "rawvideo",
                "-pix_fmt", pix_format,
                "-s", f"{target_width}x{target_height}",
                "-r", str(fps),
                "-i", "pipe:0",
                "-frames:v", str(frame_count),
                "-t", f"{duration:.6f}",
                "-r", str(fps),
                *chunk_enc_params,
                "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                "-movflags", "+faststart",
                chunk_path,
            ]
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            direction = directions[slide_index]
            stream_frames_decoupled(
                lambda f: render_zoomed_frame(
                    img_cv, slide_img, f, frame_count, direction, zoom_pct_val,
                    target_width, target_height, logo_cv, logo_im, logo_pos_coords
                ),
                frame_count,
                proc.stdin,
                max_workers=1,
                queue_size=24,
                on_frame_rendered=progress_reporter.add_frames,
            )
            proc.stdin.close()
            err_out = proc.stderr.read() if proc.stderr else b""
            if proc.stderr:
                proc.stderr.close()
            proc.wait()
            if proc.returncode != 0:
                if enc_name != "libx264":
                    sys.stderr.write(
                        f"Warning: Hardware encoder '{enc_name}' failed on chunk {segment_index + 1}. "
                        "Retrying chunk with CPU libx264 fallback...\n"
                    )
                    cpu_cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        "-f", "rawvideo",
                        "-pix_fmt", pix_format,
                        "-s", f"{target_width}x{target_height}",
                        "-r", str(fps),
                        "-i", "pipe:0",
                        "-frames:v", str(frame_count),
                        "-t", f"{duration:.6f}",
                        "-r", str(fps),
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-tune", "stillimage",
                        "-crf", "22",
                        "-pix_fmt", "yuv420p",
                        "-movflags", "+faststart",
                        chunk_path,
                    ]
                    cpu_proc = subprocess.Popen(
                        cpu_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
                    )
                    stream_frames_decoupled(
                        lambda f: render_zoomed_frame(
                            img_cv, slide_img, f, frame_count, direction, zoom_pct_val,
                            target_width, target_height, logo_cv, logo_im, logo_pos_coords
                        ),
                        frame_count,
                        cpu_proc.stdin,
                        max_workers=1,
                        queue_size=24,
                    )
                    cpu_proc.stdin.close()
                    cpu_err = cpu_proc.stderr.read() if cpu_proc.stderr else b""
                    if cpu_proc.stderr:
                        cpu_proc.stderr.close()
                    cpu_proc.wait()
                    if cpu_proc.returncode != 0:
                        raise RuntimeError(
                            f"FFmpeg CPU fallback zoom chunk {segment_index + 1} failed: {cpu_err.decode('utf-8', errors='ignore')}"
                        )
                    return chunk_path
                else:
                    raise RuntimeError(
                        f"FFmpeg subpixel zoom chunk {segment_index + 1} failed: {err_out.decode('utf-8', errors='ignore')}"
                    )
            return chunk_path

        motion_desc = "smooth Ken Burns zoom" if zoom_enabled else "high-speed static"
        print(
            f"[*] Parallel Segment Engine: rendering {len(segments)} segments across {max_workers} worker cores "
            f"({motion_desc}, encoder={enc_name})...",
            flush=True,
        )
        chunk_paths = [None] * len(segments)
        with concurrent.futures.ThreadPoolExecutor(
            max_workers=max_workers
        ) as executor:
            future_to_index = {
                executor.submit(render_motion_chunk, index, segment, effective_zoom_pct): index
                for index, segment in enumerate(segments)
            }
            for future in concurrent.futures.as_completed(future_to_index):
                chunk_paths[future_to_index[future]] = future.result()

        progress_reporter.emit_stage(96.0, "Assembling timeline segments with zero re-encode...")

        concat_list_path = os.path.join(temp_dir, "segments_concat.txt")
        with open(concat_list_path, "w", encoding="utf-8") as concat_file:
            for chunk_path in chunk_paths:
                escaped_path = chunk_path.replace("\\", "/").replace("'", "'\\''")
                concat_file.write(f"file '{escaped_path}'\n")

        concat_cmd = [
            ffmpeg_exe,
            "-y",
            "-fflags", "+genpts",
            "-f", "concat",
            "-safe", "0",
            "-i", concat_list_path,
        ]
        if audio_path and os.path.exists(audio_path):
            concat_cmd.extend([
                "-i", audio_path,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-c:v", "copy",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-af", f"apad=whole_dur={final_total_dur:.3f}",
            ])
        else:
            concat_cmd.extend([
                "-map", "0:v:0",
                "-c:v", "copy",
            ])
        concat_cmd.extend([
            "-t", f"{final_total_dur:.3f}",
            "-movflags", "+faststart",
            output_video_path,
        ])
        result = subprocess.run(
            concat_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"FFmpeg motion chunk assembly failed: {result.stderr}"
            )
        progress_reporter.emit_stage(99.0, "Finalizing MP4 container...")
        file_size_mb = os.path.getsize(output_video_path) / (1024 * 1024)
        progress_reporter.emit_stage(100.0, f"Video generated: {output_video_path} ({file_size_mb:.2f} MB)")
        return

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ----------------------------------------------------------------------
# 6. Execute Native FFmpeg Clips ZIP Export (Individual Chunks)
# ----------------------------------------------------------------------
def render_clips_zip_native(
    image_paths: List[str],
    durations: List[float],
    output_zip_path: str,
    slide_timings: Optional[List[Dict]] = None,
    audio_path: Optional[str] = None,
    target_width: int = 1920,
    target_height: int = 1080,
    motion_settings: Optional[Dict] = None,
    logo_settings: Optional[Dict] = None,
    target_total_duration: Optional[float] = None,
) -> None:
    """
    Renders every slide as an individual synchronized video clip according to its
    exact timeline timing matching the final rendered video, and packages all video chunks
    into a high-speed ZIP archive.
    """
    import wave

    ffmpeg_exe = get_ffmpeg_executable()
    temp_dir = tempfile.mkdtemp(prefix="vtt_clips_work_")
    clips_dir = os.path.join(temp_dir, "clips")
    os.makedirs(clips_dir, exist_ok=True)
    cpu_cores = os.cpu_count() or 4
    max_workers = min(cpu_cores, 4)
    threads_per_worker = max(1, cpu_cores // max_workers)

    try:
        # Step A: Deduplicated parallel image pre-processing with dimension caching
        print(f"[Progress] 3.0% - Pre-processing {len(image_paths)} slide images for individual clip rendering ({max_workers} workers)...", flush=True)
        normalized_paths = batch_prepare_images(
            image_paths, target_width, target_height, temp_dir, max_workers
        )

        # Step B: Unified frame-accurate timeline calculation (identical to render_video_native)
        fps = 30
        timeline = compute_unified_timeline(
            durations,
            target_total_duration,
            fps=fps,
            audio_sample_rate=44100,
            slide_timings=slide_timings,
        )
        durations = timeline["durations"]
        final_total_dur = timeline["total_duration"]
        clip_timings = timeline["clip_timings"]
        frame_counts = timeline["frame_counts"]
        clip_progress = FFmpegProgressReporter(
            sum(frame_counts),
            5.0,
            95.0,
        )

        motion_enabled = bool(
            motion_settings
            and (
                motion_settings.get("enabled", False)
                or motion_settings.get("zoomEnabled", False)
            )
        )
        zoom_enabled = is_zoom_enabled(motion_settings)
        zoom_pct = (
            float(motion_settings.get("zoomIntensity", DEFAULT_ZOOM_INTENSITY)) / 100.0
            if motion_enabled else 0.0
        )
        zoom_dir = motion_settings.get("zoomDirection", "random") if motion_settings else "random"
        effective_zoom_pct = max(0.0, zoom_pct)
        directions = clip_zoom_directions(len(normalized_paths), slide_timings, zoom_dir)

        # Check logo watermark settings
        has_logo = False
        logo_path = None
        logo_pos = "top-right"
        logo_scale_pct = 15.0
        logo_opacity = 0.9
        logo_margin = 24
        logo_custom_x = 50.0
        logo_custom_y = 50.0

        if logo_settings and logo_settings.get("enabled", False):
            cand_path = logo_settings.get("path") or logo_settings.get("file")
            if cand_path and os.path.exists(cand_path):
                has_logo = True
                logo_path = cand_path
                logo_pos = logo_settings.get("position", "top-right")
                logo_scale_pct = float(logo_settings.get("scale", 15))
                logo_opacity = max(0.05, min(1.0, float(logo_settings.get("opacity", 0.9))))
                logo_margin = int(logo_settings.get("margin", 24))
                logo_custom_x = float(logo_settings.get("customX", 50))
                logo_custom_y = float(logo_settings.get("customY", 50))

        # Preprocess logo once in memory if active
        preprocessed_logo = None
        if has_logo and logo_path:
            preprocessed_logo = prepare_preprocessed_logo(
                logo_path, target_width, logo_scale_pct, logo_opacity, temp_dir
            )

        def get_logo_overlay_expr():
            if logo_pos == "top-left":
                return f"x={logo_margin}:y={logo_margin}"
            elif logo_pos == "bottom-right":
                return f"x=W-w-{logo_margin}:y=H-h-{logo_margin}"
            elif logo_pos == "bottom-left":
                return f"x={logo_margin}:y=H-h-{logo_margin}"
            elif logo_pos == "custom":
                return f"x=(W-w)*{logo_custom_x/100:.3f}:y=(H-h)*{logo_custom_y/100:.3f}"
            else:
                return f"x=W-w-{logo_margin}:y={logo_margin}"

        # Step C: Sample-Accurate In-Memory Audio Slicing (Zero intermediate disk files)
        has_audio_file = bool(audio_path and os.path.exists(audio_path))
        if has_audio_file:
            print("[*] Direct in-memory seek slicing active for master voiceover track...")
        else:
            print("[*] Synthesizing synchronized audio in memory (anullsrc)...")

        enc_name, enc_args = get_hardware_encoder(ffmpeg_exe)
        generated_clips = []

        def render_single_clip(idx: int) -> str:
            c_info = clip_timings[idx]
            st = c_info["start_time"]
            et = c_info["end_time"]
            dur = c_info["duration"]
            f_count = c_info["frame_count"]
            img_p = normalized_paths[idx]

            clip_filename = f"clip_{idx+1:03d}_{st:.2f}s-{et:.2f}s.mp4"
            clip_out = os.path.join(clips_dir, clip_filename)

            if enc_name == "libx264":
                chunk_enc_params = [
                    "-c:v", "libx264",
                    "-preset", "ultrafast",
                    "-tune", "stillimage",
                    "-crf", "22",
                    "-threads", str(threads_per_worker),
                ]
            else:
                chunk_enc_params = enc_args

            # In-memory direct audio slicing: zero disk read/write intermediate files
            if has_audio_file:
                audio_inputs = ["-ss", f"{st:.6f}", "-t", f"{dur:.6f}", "-i", audio_path]
                audio_filter = f"apad=whole_dur={dur:.6f}"
            else:
                audio_inputs = ["-f", "lavfi", "-t", f"{dur:.6f}", "-i", "anullsrc=r=44100:cl=stereo"]
                audio_filter = "anull"

            # 1. FAST PATH FOR STATIC SLIDES (Zoom Disabled)
            if not zoom_enabled or effective_zoom_pct <= 0.0001:
                if preprocessed_logo:
                    inputs = [
                        "-loop", "1",
                        "-framerate", "1",
                        "-t", f"{dur:.6f}",
                        "-i", img_p,
                        "-i", preprocessed_logo,
                        *audio_inputs,
                    ]
                    filter_str = f"[0:v]setsar=1,format=yuv420p[base_v];[base_v][1:v]overlay={get_logo_overlay_expr()}:format=auto[v_out]"
                    cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        *inputs,
                        "-filter_complex", filter_str,
                        "-map", "[v_out]",
                        "-map", "2:a:0",
                        "-af", audio_filter,
                        "-r", "30",
                        *chunk_enc_params,
                        "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-ar", "44100",
                        "-t", f"{dur:.6f}",
                        "-movflags", "+faststart",
                        clip_out,
                    ]
                else:
                    inputs = [
                        "-loop", "1",
                        "-framerate", "1",
                        "-t", f"{dur:.6f}",
                        "-i", img_p,
                        *audio_inputs,
                    ]
                    cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        *inputs,
                        "-vf", "setsar=1,format=yuv420p",
                        "-map", "0:v:0",
                        "-map", "1:a:0",
                        "-af", audio_filter,
                        "-r", "30",
                        *chunk_enc_params,
                        "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-ar", "44100",
                        "-t", f"{dur:.6f}",
                        "-movflags", "+faststart",
                        clip_out,
                    ]
                res = subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
                if res.returncode != 0:
                    raise RuntimeError(f"FFmpeg static clip {idx + 1} failed: {res.stderr.decode('utf-8', errors='ignore')}")
                clip_progress.add_frames(f_count)
                return clip_out

            # 2. SUB-PIXEL CONTINUOUS ZOOM PATH (Zoom Enabled)
            img_cv = _IMAGE_CACHE.get(img_p)
            if img_cv is None and HAS_CV2:
                try:
                    img_data = np.fromfile(img_p, dtype=np.uint8)
                    img_cv = cv2.imdecode(img_data, cv2.IMREAD_COLOR)
                except Exception:
                    img_cv = None

            if img_cv is None:
                with Image.open(img_p) as src_im:
                    slide_img = src_im.convert("RGB")
            else:
                slide_img = None

            logo_cv = None
            logo_im = None
            logo_pos_coords = (0, 0)
            if preprocessed_logo and os.path.exists(preprocessed_logo):
                try:
                    if HAS_CV2:
                        l_data = np.fromfile(preprocessed_logo, dtype=np.uint8)
                        logo_cv = cv2.imdecode(l_data, cv2.IMREAD_UNCHANGED)
                    logo_im = Image.open(preprocessed_logo).convert("RGBA")
                    lw = logo_cv.shape[1] if logo_cv is not None else logo_im.size[0]
                    lh = logo_cv.shape[0] if logo_cv is not None else logo_im.size[1]
                    if logo_pos == "top-left":
                        logo_pos_coords = (logo_margin, logo_margin)
                    elif logo_pos == "bottom-right":
                        logo_pos_coords = (target_width - lw - logo_margin, target_height - lh - logo_margin)
                    elif logo_pos == "bottom-left":
                        logo_pos_coords = (logo_margin, target_height - lh - logo_margin)
                    elif logo_pos == "custom":
                        logo_pos_coords = (
                            int((target_width - lw) * (logo_custom_x / 100.0)),
                            int((target_height - lh) * (logo_custom_y / 100.0)),
                        )
                    else: # top-right
                        logo_pos_coords = (target_width - lw - logo_margin, logo_margin)
                except Exception:
                    logo_cv = None
                    logo_im = None

            pix_format = "bgr24" if (HAS_CV2 and img_cv is not None) else "rgb24"
            cmd = [
                ffmpeg_exe, "-y",
                "-threads", str(threads_per_worker),
                "-f", "rawvideo",
                "-pix_fmt", pix_format,
                "-s", f"{target_width}x{target_height}",
                "-r", str(fps),
                "-i", "pipe:0",
                *audio_inputs,
                "-map", "0:v:0",
                "-map", "1:a:0",
                "-af", audio_filter,
                "-frames:v", str(f_count),
                "-t", f"{dur:.6f}",
                "-r", "30",
                *chunk_enc_params,
                "-pix_fmt", "nv12" if enc_name == "h264_qsv" else "yuv420p",
                "-c:a", "aac",
                "-b:a", "192k",
                "-ar", "44100",
                "-movflags", "+faststart",
                clip_out,
            ]
            proc = subprocess.Popen(
                cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            direction = directions[idx]
            stream_frames_decoupled(
                lambda f: render_zoomed_frame(
                    img_cv, slide_img, f, f_count, direction, effective_zoom_pct,
                    target_width, target_height, logo_cv, logo_im, logo_pos_coords
                ),
                f_count,
                proc.stdin,
                max_workers=1,
                queue_size=24,
                on_frame_rendered=clip_progress.add_frames,
            )
            proc.stdin.close()
            err_out = proc.stderr.read() if proc.stderr else b""
            if proc.stderr:
                proc.stderr.close()
            proc.wait()
            if proc.returncode != 0:
                if enc_name != "libx264":
                    sys.stderr.write(
                        f"Warning: Hardware encoder '{enc_name}' failed on clip {idx + 1}. "
                        "Retrying clip with CPU libx264 fallback...\n"
                    )
                    cpu_cmd = [
                        ffmpeg_exe, "-y",
                        "-threads", str(threads_per_worker),
                        "-f", "rawvideo",
                        "-pix_fmt", pix_format,
                        "-s", f"{target_width}x{target_height}",
                        "-r", "30",
                        "-i", "pipe:0",
                        "-ss", f"{start_time:.3f}",
                        "-t", f"{clip_duration:.3f}",
                        "-i", audio_path,
                        "-frames:v", str(f_count),
                        "-r", "30",
                        "-c:v", "libx264",
                        "-preset", "ultrafast",
                        "-tune", "stillimage",
                        "-crf", "22",
                        "-pix_fmt", "yuv420p",
                        "-c:a", "aac",
                        "-b:a", "192k",
                        "-ar", "44100",
                        "-movflags", "+faststart",
                        clip_out,
                    ]
                    cpu_proc = subprocess.Popen(
                        cpu_cmd, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
                    )
                    stream_frames_decoupled(
                        lambda f: render_zoomed_frame(
                            img_cv, slide_img, f, f_count, direction, effective_zoom_pct,
                            target_width, target_height, logo_cv, logo_im, logo_pos_coords
                        ),
                        f_count,
                        cpu_proc.stdin,
                        max_workers=1,
                        queue_size=24,
                    )
                    cpu_proc.stdin.close()
                    cpu_err = cpu_proc.stderr.read() if cpu_proc.stderr else b""
                    if cpu_proc.stderr:
                        cpu_proc.stderr.close()
                    cpu_proc.wait()
                    if cpu_proc.returncode != 0:
                        raise RuntimeError(
                            f"FFmpeg CPU fallback zoom clip {idx + 1} failed: {cpu_err.decode('utf-8', errors='ignore')}"
                        )
                    return clip_out
                else:
                    raise RuntimeError(
                        f"FFmpeg subpixel zoom clip {idx + 1} failed: {err_out.decode('utf-8', errors='ignore')}"
                    )
            return clip_out

        print(f"[*] Rendering {len(normalized_paths)} video chunks in parallel with 4-core worker pool ({max_workers} workers, encoder={enc_name})...", flush=True)
        with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
            future_to_idx = {executor.submit(render_single_clip, i): i for i in range(len(normalized_paths))}
            for f in concurrent.futures.as_completed(future_to_idx):
                clip_path = f.result()
                generated_clips.append(clip_path)

        generated_clips.sort()
        print(f"[*] Successfully rendered {len(generated_clips)} individual video clips. Archiving into ZIP...", flush=True)
        clip_progress.emit_stage(96.0, f"Archiving {len(generated_clips)} video clips into ZIP package...")

        zip_output_dir = os.path.dirname(os.path.abspath(output_zip_path))
        if zip_output_dir and not os.path.exists(zip_output_dir):
            os.makedirs(zip_output_dir, exist_ok=True)

        with zipfile.ZipFile(output_zip_path, "w", compression=zipfile.ZIP_STORED) as zip_f:
            for clip_p in generated_clips:
                arc_name = os.path.basename(clip_p)
                zip_f.write(clip_p, arcname=arc_name)

        clip_progress.emit_stage(100.0, "Export complete.")
        zip_size_mb = os.path.getsize(output_zip_path) / (1024 * 1024)
        print(f"[+] Success! Clips ZIP archive created: {output_zip_path} ({zip_size_mb:.2f} MB, {len(generated_clips)} clips)")
        return

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


# ----------------------------------------------------------------------
# CLI Entry Point
# ----------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="Fast VTT-to-Slideshow Synchronized Video Generator using native FFmpeg."
    )
    parser.add_argument("--vtt", help="Path to .vtt subtitle file")
    parser.add_argument("--script", help="Path to text script file (paragraphs delimited by \\n\\n)")
    parser.add_argument("--images", nargs="+", help="List of slide image files in order")
    parser.add_argument("--audio", help="Optional path to voiceover audio track (.wav, .mp3)")
    parser.add_argument("--manifest", help="Optional JSON manifest file with pre-calculated slide timings")
    parser.add_argument("--output", default="output.mp4", help="Output MP4 or ZIP filename (default: output.mp4)")
    parser.add_argument("--export-mode", choices=["single", "clips_zip", "both"], default="single", help="Export mode: 'single' (unified MP4), 'clips_zip' (ZIP of individual clips), or 'both' (ZIP containing clips and unified video)")
    parser.add_argument("--slide-timings", help="Optional JSON string of slide timings [{startTime, endTime, duration}]")
    parser.add_argument("--resolution", choices=["720p", "1080p"], default="1080p", help="Target resolution")
    parser.add_argument("--motion", help="Optional JSON string of motion settings")
    parser.add_argument("--zoom", type=float, help=f"Optional zoom percentage (default: {DEFAULT_ZOOM_INTENSITY} for 102%% scale)")
    parser.add_argument("--zoom-direction", choices=["random", "in", "out"], default="random", help="Zoom direction: 'random' (alternating 100%% <-> 102%%), 'in' (100%% -> 102%%), or 'out' (102%% -> 100%%)")
    parser.add_argument("--transition", choices=["dissolve", "fadein", "fadeout", "wipe-left", "wipe-right", "wipe-random"], help="Optional transition type")
    parser.add_argument("--logo", help="Optional path to logo watermark image (.png, .jpg)")
    parser.add_argument("--logo-settings", help="Optional JSON string of logo watermark settings")
    parser.add_argument("--total-duration", type=float, help="Explicit total duration in seconds to enforce exact timeline length")

    args = parser.parse_args()
    width = 1280 if args.resolution == "720p" else 1920
    height = 720 if args.resolution == "720p" else 1080

    # Parse motion settings if provided
    motion_data = None
    if args.motion:
        try:
            motion_data = json.loads(args.motion)
        except Exception:
            pass
    elif args.zoom or args.transition or (args.zoom_direction and args.zoom_direction != "random"):
        motion_data = {
            "enabled": True,
            "zoomEnabled": args.zoom is not None,
            "zoomIntensity": args.zoom if args.zoom is not None else DEFAULT_ZOOM_INTENSITY,
            "zoomDirection": args.zoom_direction or "random",
            "transitionEnabled": args.transition is not None,
            "transitionType": args.transition or "dissolve",
            "transitionDuration": 0.6,
        }

    # Parse logo settings if provided
    logo_data = None
    if args.logo_settings:
        try:
            logo_data = json.loads(args.logo_settings)
        except Exception:
            pass
    elif args.logo:
        logo_data = {
            "enabled": True,
            "path": args.logo,
            "position": "top-right",
            "scale": 15,
            "opacity": 0.9,
            "margin": 24,
        }

    # Mode 1: Manifest-driven execution (from Web API or pipeline)
    if args.manifest:
        with open(args.manifest, "r", encoding="utf-8") as f:
            manifest_data = json.load(f)
        slides = manifest_data.get("slides", [])
        image_paths = [s["image"] for s in slides]
        durations = [float(s["duration"]) for s in slides]
        slide_timings = manifest_data.get("slideTimings")
        if not slide_timings:
            slide_timings = []
            cursor = 0.0
            for idx, slide in enumerate(slides):
                start = float(slide.get("startTime", cursor))
                end = float(slide.get("endTime", start + durations[idx]))
                slide_timings.append({
                    "startTime": start,
                    "endTime": end,
                    "duration": end - start,
                    "zoomSeed": slide.get("zoomSeed"),
                    "zoomDirection": slide.get("zoomDirection"),
                })
                cursor = end
        audio_file = args.audio or manifest_data.get("audio")
        effective_motion = motion_data or manifest_data.get("motion")
        effective_logo = logo_data or manifest_data.get("logo") or manifest_data.get("logoSettings")
        target_dur = args.total_duration or manifest_data.get("totalDuration") or sum(durations)

        effective_mode = args.export_mode
        if effective_mode == "single" and manifest_data.get("exportMode"):
            effective_mode = manifest_data.get("exportMode")
        if args.output.lower().endswith(".zip") or effective_mode == "both":
            effective_mode = "clips_zip"

        if effective_mode == "clips_zip":
            render_clips_zip_native(
                image_paths,
                durations,
                args.output,
                slide_timings,
                audio_file,
                width,
                height,
                effective_motion,
                effective_logo,
                target_dur,
            )
        else:
            render_video_native(
                image_paths,
                durations,
                args.output,
                audio_file,
                width,
                height,
                effective_motion,
                effective_logo,
                target_dur,
                slide_timings,
            )
        return

    # Mode 2: Direct file inputs
    if not (args.vtt and args.script and args.images):
        parser.error("Either --manifest OR (--vtt, --script, and --images) must be provided.")

    with open(args.vtt, "r", encoding="utf-8") as f:
        vtt_content = f.read()

    with open(args.script, "r", encoding="utf-8") as f:
        script_content = f.read()

    cues = parse_vtt(vtt_content)
    paragraphs = parse_script(script_content)

    if len(args.images) != len(paragraphs):
        print(f"[!] Warning: Count mismatch! You have {len(args.images)} images for {len(paragraphs)} paragraphs.")

    matches = match_script_to_vtt(paragraphs, cues)
    num_slides = min(len(args.images), len(matches))
    selected_images = args.images[:num_slides]
    durations = [m['duration'] for m in matches[:num_slides]]
    if args.slide_timings:
        slide_timings = json.loads(args.slide_timings)
    else:
        slide_timings = [
            {
                "startTime": m.get('startTime', m.get('start', 0.0)),
                "endTime": m.get('endTime', m.get('end', 0.0)),
                "duration": m.get('duration', durations[idx]),
            }
            for idx, m in enumerate(matches[:num_slides])
        ]

    target_dur = args.total_duration or sum(durations)
    effective_mode = args.export_mode
    if args.output.lower().endswith(".zip") or effective_mode == "both":
        effective_mode = "clips_zip"

    if effective_mode == "clips_zip":
        render_clips_zip_native(
            selected_images,
            durations,
            args.output,
            slide_timings,
            args.audio,
            width,
            height,
            motion_data,
            logo_data,
            target_dur,
        )
    else:
        render_video_native(
            selected_images,
            durations,
            args.output,
            args.audio,
            width,
            height,
            motion_data,
            logo_data,
            target_dur,
            slide_timings,
        )


if __name__ == "__main__":
    main()
