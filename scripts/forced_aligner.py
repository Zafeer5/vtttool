#!/usr/bin/env python3
"""
Forced Alignment Engine for Video Slideshow Generation
======================================================
Takes:
  1. Audio voiceover (MP3, WAV, M4A, etc.)
  2. User-provided script paragraphs (1 paragraph = 1 visual slide)
Performs:
  1. High-speed Whisper ASR with word-level timestamps (faster-whisper INT8 / openai-whisper)
  2. English phonetic & text normalization
  3. Monotonic forced alignment of script paragraphs against spoken words
  4. Precise start and end timestamp extraction:
     - Slide N starts when Paragraph N's opening 3 to 4 words are spoken
     - Slide N remains on screen continuously until Paragraph N+1's opening 3 to 4 words begin
     - Final slide remains active until voiceover audio concludes
  5. Outputs clean paragraph VTT, SRT, JSON timeline, and Premiere Pro CSV markers
"""

import argparse
import json
import math
import os
import re
import shutil
import sys
from typing import List, Dict, Any, Optional, Tuple

# Force UTF-8 on Windows stdout/stderr
if sys.platform.startswith('win'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass


def setup_ffmpeg_path():
    """Ensure ffmpeg executable is discovered in PATH, using imageio_ffmpeg if needed."""
    if shutil.which("ffmpeg"):
        return
    try:
        import imageio_ffmpeg
        ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
        if ffmpeg_exe and os.path.exists(ffmpeg_exe):
            ffmpeg_dir = os.path.dirname(ffmpeg_exe)
            target_name = "ffmpeg.exe" if sys.platform.startswith("win") else "ffmpeg"
            target_path = os.path.join(ffmpeg_dir, target_name)
            if not os.path.exists(target_path) and os.path.basename(ffmpeg_exe) != target_name:
                try:
                    shutil.copy2(ffmpeg_exe, target_path)
                except Exception:
                    pass
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
    except Exception as e:
        sys.stderr.write(f"Warning: Could not configure imageio_ffmpeg: {e}\n")


def format_seconds_to_vtt_timestamp(total_seconds: float) -> str:
    """Formats seconds into WebVTT timestamp: HH:MM:SS.mmm."""
    if total_seconds < 0 or math.isnan(total_seconds):
        total_seconds = 0.0
    hours = int(total_seconds // 3600)
    minutes = int((total_seconds % 3600) // 60)
    seconds = total_seconds % 60
    sec_int = int(seconds)
    sec_frac = int(round((seconds - sec_int) * 1000))
    if sec_frac >= 1000:
        sec_int += 1
        sec_frac -= 1000
    return f"{hours:02d}:{minutes:02d}:{sec_int:02d}.{sec_frac:03d}"


def format_seconds_to_srt_timestamp(total_seconds: float) -> str:
    """Formats seconds into SRT timestamp: HH:MM:SS,mmm."""
    vtt = format_seconds_to_vtt_timestamp(total_seconds)
    return vtt.replace('.', ',')


# ----------------------------------------------------------------------
# ----------------------------------------------------------------------
# Clean English Phonetic Normalization
# ----------------------------------------------------------------------
def normalize_single_word(word: str) -> str:
    """Converts a single word into its canonical token for fast English matching."""
    if not word:
        return ""
    return re.sub(r'[^a-zA-Z0-9]', '', word).lower()


def levenshtein_dist(s1: str, s2: str) -> int:
    """Calculates Levenshtein edit distance between two strings."""
    if s1 == s2:
        return 0
    if not s1:
        return len(s2)
    if not s2:
        return len(s1)
    prev = list(range(len(s2) + 1))
    for i, c1 in enumerate(s1):
        curr = [i + 1] * (len(s2) + 1)
        for j, c2 in enumerate(s2):
            cost = 0 if c1 == c2 else 1
            curr[j + 1] = min(curr[j] + 1, prev[j + 1] + 1, prev[j] + cost)
        prev = curr
    return prev[len(s2)]


def is_fuzzy_word_match(w1: str, w2: str) -> bool:
    """Checks if two words match phonetically, accounting for typos & colloquial variations."""
    if not w1 or not w2:
        return False
    n1 = normalize_single_word(w1)
    n2 = normalize_single_word(w2)
    if n1 == n2:
        return True
    if not n1 or not n2:
        return False

    # Substring match if long enough
    if len(n1) >= 4 and len(n2) >= 4:
        if n1 in n2 or n2 in n1:
            return True

    min_len = min(len(n1), len(n2))
    if min_len >= 3 and levenshtein_dist(n1, n2) <= 1:
        return True
    if min_len >= 6 and levenshtein_dist(n1, n2) <= 2:
        return True
    return False


# ----------------------------------------------------------------------
# Script Parsing & Cleaning
# ----------------------------------------------------------------------
def parse_script_into_paragraphs(raw_script: str) -> List[Dict[str, Any]]:
    """
    Splits user-provided script into clean paragraph blocks.
    Removes headers like '[Paragraph 1]', 'Slide 1:', 'Scene 1:', bullet points, etc.
    """
    if not raw_script or not raw_script.strip():
        return []

    normalized = raw_script.replace('\r\n', '\n').replace('\r', '\n').strip()
    # Split by double newline or blank lines
    chunks = re.split(r'\n\s*\n+', normalized)
    # If no double newline, try single newline
    if len(chunks) <= 1 and '\n' in normalized:
        chunks = [c.strip() for c in normalized.split('\n') if c.strip()]

    paragraphs = []
    for idx, chunk in enumerate(chunks):
        text = chunk.strip()
        if not text:
            continue
        # Clean leading labels like [Paragraph 1], Slide 1:, 1., etc.
        text = re.sub(r'^(?:\[?(?:paragraph|slide|scene|part)\s*\d+\]?:?\s*|\d+[.)]\s*)', '', text, flags=re.I).strip()
        if not text:
            continue

        # Extract words
        raw_words = text.split()
        clean_words = [re.sub(r'^[^\w\d\u0600-\u06FF\u0900-\u097F]+|[^\w\d\u0600-\u06FF\u0900-\u097F]+$', '', w).strip() for w in raw_words]
        clean_words = [w for w in clean_words if w]

        paragraphs.append({
            "index": len(paragraphs),
            "id": f"p-{len(paragraphs) + 1}",
            "text": text,
            "words": clean_words,
            "opening4": clean_words[:4],
            "opening3": clean_words[:3],
            "closing3": clean_words[-3:] if len(clean_words) >= 3 else clean_words,
            "wordCount": len(clean_words),
        })

    return paragraphs


# ----------------------------------------------------------------------
# Audio Transcription & Word-Level ASR
# ----------------------------------------------------------------------
def transcribe_audio_words(
    audio_path: str,
    model_name: str = "large-v3-turbo",
    language: Optional[str] = None,
    initial_prompt: Optional[str] = None
) -> Tuple[List[Dict[str, Any]], float, str]:
    """
    Transcribes audio into a flat chronological stream of word timestamps.
    Uses faster-whisper (CTranslate2 INT8) with fallback to openai-whisper.
    """
    setup_ffmpeg_path()
    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Aliases
    model_clean = (model_name or "large-v3-turbo").lower().strip()
    fw_model_name = "turbo" if model_clean in ["turbo", "large-turbo", "large-v3-turbo"] else model_clean
    ow_model_name = "large-v3-turbo" if model_clean in ["turbo", "large-turbo", "large-v3-turbo"] else model_clean

    actual_lang = "ur" if language in ["ur-Latn", "ur_Latn"] else ("hi" if language in ["hi-Latn"] else language)
    if actual_lang in ["auto", "mixed", "all", ""]:
        actual_lang = None

    all_words: List[Dict[str, Any]] = []
    audio_duration = 0.0
    detected_lang = language or "en"

    # Attempt faster-whisper
    try:
        from faster_whisper import WhisperModel
        import multiprocessing

        threads = min(4, multiprocessing.cpu_count())
        model = WhisperModel(fw_model_name, device="cpu", compute_type="int8", cpu_threads=threads)
        beam_size = 2 if fw_model_name in ["turbo", "large-v3-turbo", "large-v3"] else 1

        segments, info = model.transcribe(
            audio_path,
            beam_size=beam_size,
            word_timestamps=True,
            language=actual_lang,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=400, speech_pad_ms=250),
            initial_prompt=initial_prompt[-500:] if initial_prompt else None,
        )

        detected_lang = info.language or actual_lang or "en"
        audio_duration = info.duration or 0.0

        for seg in segments:
            if seg.words:
                for w in seg.words:
                    word_txt = w.word.strip()
                    if word_txt:
                        all_words.append({
                            "word": word_txt,
                            "start": round(w.start, 3),
                            "end": round(w.end, 3),
                            "prob": round(getattr(w, 'probability', 0.95), 3),
                        })
            else:
                word_txt = seg.text.strip()
                if word_txt:
                    all_words.append({
                        "word": word_txt,
                        "start": round(seg.start, 3),
                        "end": round(seg.end, 3),
                        "prob": 0.85,
                    })

    except Exception as fw_err:
        sys.stderr.write(f"faster-whisper notice: {fw_err}, switching to openai-whisper\n")
        import whisper
        import torch

        threads = min(4, torch.get_num_threads())
        torch.set_num_threads(threads)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = whisper.load_model(ow_model_name, device=device)

        transcribe_opts = {
            "word_timestamps": True,
            "fp16": (device == "cuda"),
            "beam_size": 2 if ow_model_name in ["turbo", "large-v3-turbo"] else 1,
            "temperature": 0.0,
        }
        if actual_lang:
            transcribe_opts["language"] = actual_lang
        if initial_prompt:
            transcribe_opts["initial_prompt"] = initial_prompt[-500:]

        res = model.transcribe(audio_path, **transcribe_opts)
        detected_lang = res.get("language", actual_lang or "en")
        raw_segments = res.get("segments", [])

        for seg in raw_segments:
            seg_words = seg.get("words", [])
            for w in seg_words:
                word_txt = w.get("word", "").strip()
                if word_txt:
                    all_words.append({
                        "word": word_txt,
                        "start": round(w.get("start", 0.0), 3),
                        "end": round(w.get("end", 0.0), 3),
                        "prob": round(w.get("probability", 0.95), 3),
                    })

    if all_words:
        audio_duration = max(audio_duration, all_words[-1]["end"])

    return all_words, audio_duration, detected_lang


# ----------------------------------------------------------------------
# Core Monotonic Forced Alignment Algorithm
# ----------------------------------------------------------------------
def force_align_paragraphs(
    paragraphs: List[Dict[str, Any]],
    spoken_words: List[Dict[str, Any]],
    total_audio_duration: float
) -> Dict[str, Any]:
    """
    Force-aligns user paragraphs to the spoken word stream.
    Strict Rule:
    - Finds the first 3 to 4 starting words of Paragraph N in the spoken word stream.
    - Slide N starts at that timestamp.
    - Slide N remains on screen continuously until Slide N+1's first 3 to 4 words start.
    - Slide N-1 ends exactly when Slide N starts.
    - Final slide ends when the audio concludes.
    """
    num_p = len(paragraphs)
    if num_p == 0:
        return {
            "alignedParagraphs": [],
            "averageConfidence": 0.0,
            "matchedCount": 0,
            "totalCount": 0,
        }

    raw_matches: List[Dict[str, Any]] = []
    current_word_idx = 0

    for i in range(num_p):
        p = paragraphs[i]
        opening4 = p.get("opening4", [])
        opening3 = p.get("opening3", [])
        has4 = len(opening4) >= 4
        has3 = len(opening3) >= 3

        matched_time: Optional[float] = None
        matched_speech_end: Optional[float] = None
        confidence_score = 0.0
        confidence_label = "fallback"
        matched_snippet = ""
        matched_word_pos = current_word_idx

        if i == 0:
            # Slide 1 always begins cleanly at 0.000s so video playback starts immediately
            matched_time = 0.0
            confidence_score = 100.0
            confidence_label = "exact"
            matched_snippet = " ".join(opening4) if opening4 else "Slide 1"

            # Check where opening words appear in spoken words to advance current_word_idx
            if spoken_words and has4:
                for k in range(0, min(15, len(spoken_words) - 3)):
                    m_count = sum(1 for m in range(4) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening4[m]))
                    if m_count >= 3:
                        current_word_idx = k + 4
                        break
        else:
            # 1. Search forward: 4 consecutive opening words
            if spoken_words and has4:
                for k in range(current_word_idx, len(spoken_words) - 3):
                    m_count = sum(1 for m in range(4) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening4[m]))
                    if m_count == 4:
                        matched_time = spoken_words[k]["start"]
                        confidence_score = 98.0
                        confidence_label = "exact"
                        matched_snippet = " ".join(s["word"] for s in spoken_words[k:k+4])
                        matched_word_pos = k + 4
                        break

            # 2. Search forward: 3 consecutive opening words
            if matched_time is None and spoken_words and has3:
                for k in range(current_word_idx, len(spoken_words) - 2):
                    m_count = sum(1 for m in range(3) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening3[m]))
                    if m_count == 3:
                        matched_time = spoken_words[k]["start"]
                        confidence_score = 92.0
                        confidence_label = "high"
                        matched_snippet = " ".join(s["word"] for s in spoken_words[k:k+3])
                        matched_word_pos = k + 3
                        break

            # 3. Search forward: 4 opening words with 1 drop (where 1st word MUST match)
            if matched_time is None and spoken_words and has4:
                for k in range(current_word_idx, len(spoken_words) - 3):
                    if not is_fuzzy_word_match(spoken_words[k]["word"], opening4[0]):
                        continue
                    m_count = 1 + sum(1 for m in range(1, 4) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening4[m]))
                    if m_count >= 3 and (spoken_words[k + 3]["end"] - spoken_words[k]["start"]) <= 3.5:
                        matched_time = spoken_words[k]["start"]
                        confidence_score = 85.0
                        confidence_label = "high"
                        matched_snippet = " ".join(s["word"] for s in spoken_words[k:k+4])
                        matched_word_pos = k + 4
                        break

            # 4. Backward recovery search (if slight speaker pause or timeline drift)
            if matched_time is None and spoken_words and current_word_idx > 0:
                for k in range(0, current_word_idx):
                    if has4 and k <= len(spoken_words) - 4:
                        m_count = sum(1 for m in range(4) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening4[m]))
                        if m_count == 4:
                            matched_time = spoken_words[k]["start"]
                            confidence_score = 80.0
                            confidence_label = "fuzzy"
                            matched_snippet = " ".join(s["word"] for s in spoken_words[k:k+4])
                            matched_word_pos = k + 4
                            break
                    elif has3 and k <= len(spoken_words) - 3:
                        m_count = sum(1 for m in range(3) if is_fuzzy_word_match(spoken_words[k + m]["word"], opening3[m]))
                        if m_count == 3:
                            matched_time = spoken_words[k]["start"]
                            confidence_score = 75.0
                            confidence_label = "fuzzy"
                            matched_snippet = " ".join(s["word"] for s in spoken_words[k:k+3])
                            matched_word_pos = k + 3
                            break

            if matched_time is not None:
                current_word_idx = min(matched_word_pos, len(spoken_words))

        raw_matches.append({
            "index": i,
            "paragraph": p,
            "startTime": round(matched_time, 3) if matched_time is not None else -1.0,
            "confidenceScore": confidence_score,
            "confidence": confidence_label,
            "matchedSnippet": matched_snippet or (" ".join(opening4) if opening4 else ""),
            "triggerPhrase": " ".join(opening4) if opening4 else "",
        })

    # Multi-pass Anchor & Speech-Velocity Interpolation for unanchored (-1) slides
    for i in range(num_p):
        if raw_matches[i]["startTime"] < 0:
            prev_anchor = i - 1
            while prev_anchor >= 0 and raw_matches[prev_anchor]["startTime"] < 0:
                prev_anchor -= 1
            prev_time = raw_matches[prev_anchor]["startTime"] if prev_anchor >= 0 else 0.0

            next_anchor = i + 1
            while next_anchor < num_p and raw_matches[next_anchor]["startTime"] < 0:
                next_anchor += 1
            next_time = (
                raw_matches[next_anchor]["startTime"]
                if next_anchor < num_p
                else max(total_audio_duration, prev_time + (num_p - prev_anchor) * 4.0)
            )

            # Sum word counts in this gap
            total_words_in_gap = sum(max(1, paragraphs[k]["wordCount"]) for k in range(max(0, prev_anchor), next_anchor))
            accumulated = sum(max(1, paragraphs[k]["wordCount"]) for k in range(max(0, prev_anchor), i))

            duration_gap = max(1.5 * (next_anchor - max(0, prev_anchor)), next_time - prev_time)
            interpolated = prev_time + duration_gap * (accumulated / max(1, total_words_in_gap))

            # Snap to closest speech pause in spoken words
            best_time = interpolated
            min_diff = 1.5
            for sw in spoken_words:
                diff = abs(sw["start"] - interpolated)
                if diff < min_diff and sw["start"] > prev_time + 0.5 and sw["start"] < next_time - 0.5:
                    min_diff = diff
                    best_time = sw["start"]

            # Guarantee strictly advancing order
            prev_t = raw_matches[i - 1]["startTime"] if i > 0 else 0.0
            if best_time <= prev_t + 0.4:
                best_time = prev_t + 1.5

            raw_matches[i]["startTime"] = round(best_time, 3)
            raw_matches[i]["confidenceScore"] = 50.0
            raw_matches[i]["confidence"] = "fallback"

    # Enforce continuous, gapless holding duration:
    # Slide N remains on screen continuously until Slide N+1 begins!
    final_aligned: List[Dict[str, Any]] = []
    matched_count = 0

    for i in range(num_p):
        rm = raw_matches[i]
        st = rm["startTime"]

        if rm["confidence"] != "fallback":
            matched_count += 1

        if i < num_p - 1:
            et = raw_matches[i + 1]["startTime"]
        else:
            et = max(st + 2.5, total_audio_duration)

        dur = max(0.5, round(et - st, 3))
        score = rm["confidenceScore"]
        status = (
            "exact" if score >= 95
            else "high_confidence" if score >= 85
            else "medium_confidence" if score >= 70
            else "low_confidence_flagged"
        )

        warning = None
        if status == "low_confidence_flagged":
            warning = f"Slide {i + 1}: Opening words '{rm['triggerPhrase']}' were estimated via speech tempo interpolation."

        final_aligned.append({
            "index": i,
            "id": f"slide-{i + 1}",
            "text": rm["paragraph"]["text"],
            "startTime": round(st, 3),
            "endTime": round(et, 3),
            "duration": dur,
            "confidenceScore": round(score, 1),
            "confidence": rm["confidence"],
            "status": status,
            "matchedSnippet": rm["matchedSnippet"],
            "triggerPhrase": rm["triggerPhrase"],
            "wordCount": rm["paragraph"]["wordCount"],
            "warning": warning,
        })

    avg_conf = round(sum(f["confidenceScore"] for f in final_aligned) / max(1, len(final_aligned)), 1)

    return {
        "alignedParagraphs": final_aligned,
        "averageConfidence": avg_conf,
        "matchedCount": matched_count,
        "totalCount": num_p,
    }


# ----------------------------------------------------------------------
# Export Generators (VTT, SRT, JSON Timeline, Premiere CSV)
# ----------------------------------------------------------------------
def generate_paragraph_vtt(aligned_paragraphs: List[Dict[str, Any]]) -> str:
    """Generates standards-compliant WebVTT subtitle track for paragraph blocks."""
    lines = ["WEBVTT", ""]
    for p in aligned_paragraphs:
        s_str = format_seconds_to_vtt_timestamp(p["startTime"])
        e_str = format_seconds_to_vtt_timestamp(p["endTime"])
        lines.append(f"{p['index'] + 1}")
        lines.append(f"{s_str} --> {e_str}")
        lines.append(p["text"])
        lines.append("")
    return "\n".join(lines)


def generate_paragraph_srt(aligned_paragraphs: List[Dict[str, Any]]) -> str:
    """Generates standards-compliant SubRip (.srt) subtitle track for paragraph blocks."""
    lines = []
    for p in aligned_paragraphs:
        s_str = format_seconds_to_srt_timestamp(p["startTime"])
        e_str = format_seconds_to_srt_timestamp(p["endTime"])
        lines.append(f"{p['index'] + 1}")
        lines.append(f"{s_str} --> {e_str}")
        lines.append(p["text"])
        lines.append("")
    return "\n".join(lines)


def generate_premiere_csv_markers(aligned_paragraphs: List[Dict[str, Any]]) -> str:
    """Generates Adobe Premiere Pro and After Effects marker import CSV format."""
    lines = ["Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type"]
    for p in aligned_paragraphs:
        s_str = format_seconds_to_vtt_timestamp(p["startTime"])
        e_str = format_seconds_to_vtt_timestamp(p["endTime"])
        dur_str = format_seconds_to_vtt_timestamp(p["duration"])
        desc = p["text"].replace('\t', ' ').replace('\n', ' ')
        lines.append(f"Slide {p['index'] + 1}\t{desc}\t{s_str}\t{e_str}\t{dur_str}\tComment")
    return "\n".join(lines)


# ----------------------------------------------------------------------
# Main Runner & CLI
# ----------------------------------------------------------------------
def run_forced_alignment(
    audio_path: str,
    script_content: str,
    language: Optional[str] = None,
    model_name: str = "large-v3-turbo",
    level: str = "word"
) -> Dict[str, Any]:
    """
    Main programmatic API for forced alignment.
    Takes audio file path + raw script text, returns complete alignment structure.
    """
    paragraphs = parse_script_into_paragraphs(script_content)
    if not paragraphs:
        raise ValueError("Script is empty or contains no valid paragraphs.")

    spoken_words, audio_duration, detected_lang = transcribe_audio_words(
        audio_path=audio_path,
        model_name=model_name,
        language=language,
        initial_prompt=paragraphs[0]["text"] if paragraphs else None
    )

    alignment = force_align_paragraphs(paragraphs, spoken_words, audio_duration)
    aligned_paragraphs = alignment["alignedParagraphs"]

    # Generate standard exports
    vtt_content = generate_paragraph_vtt(aligned_paragraphs)
    srt_content = generate_paragraph_srt(aligned_paragraphs)
    premiere_csv = generate_premiere_csv_markers(aligned_paragraphs)

    # Word-level cues for Verifier UI
    word_cues = []
    for idx, sw in enumerate(spoken_words):
        word_cues.append({
            "id": f"word-{idx + 1}",
            "startTime": sw["start"],
            "endTime": sw["end"],
            "duration": round(sw["end"] - sw["start"], 3),
            "text": sw["word"],
            "cleanText": sw["word"],
            "words": [{"word": sw["word"], "start": sw["start"], "end": sw["end"]}],
            "rawHeader": f"{format_seconds_to_vtt_timestamp(sw['start'])} --> {format_seconds_to_vtt_timestamp(sw['end'])}"
        })

    return {
        "success": True,
        "paragraphs": aligned_paragraphs,
        "paragraphCount": len(aligned_paragraphs),
        "matchedCount": alignment["matchedCount"],
        "averageConfidence": alignment["averageConfidence"],
        "audioDuration": round(audio_duration, 3),
        "detectedLanguage": detected_lang,
        "vtt": vtt_content,
        "srt": srt_content,
        "premiereMarkersCsv": premiere_csv,
        "cues": word_cues,
        "words": spoken_words,
        "wordCount": len(spoken_words),
    }


def main():
    parser = argparse.ArgumentParser(description="Voiceover-to-Paragraph Forced Alignment Engine")
    parser.add_argument("--audio", required=True, help="Path to input voiceover audio file")
    parser.add_argument("--script", required=True, help="Script text or path to script text file")
    parser.add_argument("--language", default=None, help="Language code (ur, hi, en, auto, mixed)")
    parser.add_argument("--model", default="large-v3-turbo", help="Whisper model name (large-v3-turbo, turbo, base, tiny)")
    parser.add_argument("--level", default="word", choices=["word", "sentence"], help="Word or sentence level cues")
    parser.add_argument("--output", default=None, help="Path to output JSON file")
    parser.add_argument("--vtt-output", default=None, help="Path to output .vtt subtitle file")
    parser.add_argument("--srt-output", default=None, help="Path to output .srt subtitle file")
    parser.add_argument("--csv-output", default=None, help="Path to output Premiere Pro markers .csv file")

    args = parser.parse_args()

    try:
        script_text = args.script
        if os.path.exists(args.script):
            with open(args.script, "r", encoding="utf-8") as f:
                script_text = f.read()

        res = run_forced_alignment(
            audio_path=args.audio,
            script_content=script_text,
            language=args.language,
            model_name=args.model,
            level=args.level
        )

        if args.vtt_output:
            with open(args.vtt_output, "w", encoding="utf-8") as f:
                f.write(res["vtt"])

        if args.srt_output:
            with open(args.srt_output, "w", encoding="utf-8") as f:
                f.write(res["srt"])

        if args.csv_output:
            with open(args.csv_output, "w", encoding="utf-8") as f:
                f.write(res["premiereMarkersCsv"])

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(res, f, ensure_ascii=False, indent=2)
            print(f"Alignment completed: {res['paragraphCount']} paragraphs aligned. Average confidence: {res['averageConfidence']}%")
        else:
            sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")

    except Exception as e:
        sys.stderr.write(f"Forced alignment error: {e}\n")
        err_res = {"success": False, "error": str(e)}
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(err_res, f)
        sys.exit(1)


if __name__ == "__main__":
    main()
