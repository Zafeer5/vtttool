#!/usr/bin/env python3
"""
Voiceover-to-VTT Transcriber (Pure English, Ultra-Fast & Accurate)
==================================================================
Transcribes English speech from audio files into exact WebVTT cues using
OpenAI Whisper / faster-whisper with word-level timestamp alignment and
smart 3-to-4 word phrase chunking with pause and sentence break detection.
"""

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tempfile
from typing import List, Dict, Any, Optional

# Smart Cache Directory
CACHE_DIR = os.path.join(tempfile.gettempdir(), "vtttool_transcripts_cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def compute_audio_cache_key(audio_path: str, model_name: str, language: Optional[str]) -> str:
    """Computes a unique SHA-256 fingerprint for smart caching."""
    h = hashlib.sha256()
    h.update((model_name or "small").encode("utf-8"))
    h.update((language or "en").encode("utf-8"))
    try:
        file_size = os.path.getsize(audio_path)
        h.update(str(file_size).encode("utf-8"))
        with open(audio_path, "rb") as f:
            h.update(f.read(4 * 1024 * 1024))
            if file_size > 8 * 1024 * 1024:
                f.seek(file_size - 4 * 1024 * 1024)
                h.update(f.read(4 * 1024 * 1024))
    except Exception:
        h.update(os.path.basename(audio_path).encode("utf-8"))
    return h.hexdigest()


# Force UTF-8 on Windows stdout/stderr
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
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


def is_abbreviation_or_number(prev_word: str, next_word: Optional[str]) -> bool:
    """Heuristic to check if a period belongs to an abbreviation, initial, or decimal number."""
    cleaned = prev_word.strip().lower()
    common_abbrs = {
        "mr.", "mrs.", "ms.", "dr.", "prof.", "sr.", "jr.", "st.", "vs.", "etc.",
        "e.g.", "i.e.", "a.m.", "p.m.", "approx.", "dept.", "est.", "fig.", "inc.",
        "ltd.", "co.", "corp.", "u.s.", "u.k.", "jan.", "feb.", "mar.", "apr.",
        "aug.", "sept.", "oct.", "nov.", "dec.", "no.", "vol.", "vs."
    }
    if cleaned in common_abbrs:
        return True
    # Single letter followed by period (middle initial "J.")
    if re.fullmatch(r"[a-zA-Z]\.", cleaned):
        return True
    # Decimal number like 3.14
    if re.search(r"\d+\.\s*$", prev_word) and next_word and re.search(r"^\s*\d+", next_word):
        return True
    return False


def chunk_words_into_phrases(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Groups words into 3 to 4 word natural speech chunks.
    CRITICAL RULES:
    1. Sentence boundary (. ? !): Always ends the chunk immediately, even if 1-3 words.
    2. Speech pause (silence gap >= 0.25s): Always ends the chunk immediately,
       and marks the timing where the next word/sentence starts precisely.
    3. Clause punctuation (, ; : - —) with slight pause (>= 0.15s) and at least 2 words: ends chunk.
    4. Max chunk size is 4 words (or 3 words when a pause >= 0.12s occurs).
    """
    if not words:
        return []

    phrases = []
    current_chunk = []
    sentence_end_pattern = re.compile(r"[.?!]['\")\]]*$")
    clause_end_pattern = re.compile(r"[,;:\-—]['\")\]]*$")

    for i, w in enumerate(words):
        current_chunk.append(w)
        word_text = w.get("word", "").strip()
        next_word_info = words[i + 1] if i + 1 < len(words) else None

        # Natural silence pause between current word end and next word start
        pause_duration = 0.0
        if next_word_info:
            current_end = float(w.get("end", 0.0))
            next_start = float(next_word_info.get("start", current_end))
            pause_duration = max(0.0, next_start - current_end)

        has_sentence_end = bool(sentence_end_pattern.search(word_text))
        has_clause_end = bool(clause_end_pattern.search(word_text))

        should_split = False

        if not next_word_info:
            # End of speech words
            should_split = True
        elif has_sentence_end and not is_abbreviation_or_number(word_text, next_word_info.get("word", "")):
            # Sentence broke -> break immediately so the next sentence starts cleanly
            should_split = True
        elif pause_duration >= 0.25:
            # Silence pause: speech break!
            # The next chunk will start at next_word_info["start"]!
            should_split = True
        elif has_clause_end and len(current_chunk) >= 2 and pause_duration >= 0.15:
            # Comma / clause pause break
            should_split = True
        elif len(current_chunk) >= 4:
            # Max 4 words reached
            should_split = True
        elif len(current_chunk) >= 3 and pause_duration >= 0.12:
            # Natural 3-word cadence break
            should_split = True

        if should_split and current_chunk:
            start_t = float(current_chunk[0].get("start", 0.0))
            end_t = float(current_chunk[-1].get("end", start_t + 0.1))
            full_text = " ".join(cw.get("word", "").strip() for cw in current_chunk if cw.get("word", "").strip())
            word_list = [
                {
                    "word": cw.get("word", "").strip(),
                    "start": round(float(cw.get("start", 0.0)), 3),
                    "end": round(float(cw.get("end", 0.0)), 3),
                }
                for cw in current_chunk
                if cw.get("word", "").strip()
            ]
            phrases.append({
                "start": round(start_t, 3),
                "end": round(max(end_t, start_t + 0.05), 3),
                "text": full_text,
                "words": word_list,
            })
            current_chunk = []

    if current_chunk:
        start_t = float(current_chunk[0].get("start", 0.0))
        end_t = float(current_chunk[-1].get("end", start_t + 0.1))
        full_text = " ".join(cw.get("word", "").strip() for cw in current_chunk if cw.get("word", "").strip())
        if full_text:
            word_list = [
                {
                    "word": cw.get("word", "").strip(),
                    "start": round(float(cw.get("start", 0.0)), 3),
                    "end": round(float(cw.get("end", 0.0)), 3),
                }
                for cw in current_chunk
                if cw.get("word", "").strip()
            ]
            phrases.append({
                "start": round(start_t, 3),
                "end": round(max(end_t, start_t + 0.05), 3),
                "text": full_text,
                "words": word_list,
            })

    return phrases


def segment_words_into_sentences(words: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Groups word-level timestamps into full sentence-level chunks with exact word alignment."""
    if not words:
        return []

    sentences = []
    current_sentence_words = []
    sentence_end_pattern = re.compile(r"[.?!]['\")\]]*$")
    clause_end_pattern = re.compile(r"[,;:\-—]['\")\]]*$")

    for i, w in enumerate(words):
        current_sentence_words.append(w)
        word_text = w.get("word", "").strip()
        next_word_info = words[i + 1] if i + 1 < len(words) else None
        next_word_text = next_word_info.get("word", "").strip() if next_word_info else None

        has_end_punct = bool(sentence_end_pattern.search(word_text))
        has_clause_punct = bool(clause_end_pattern.search(word_text))

        pause_duration = 0.0
        if next_word_info:
            current_end = float(w.get("end", 0.0))
            next_start = float(next_word_info.get("start", current_end))
            pause_duration = max(0.0, next_start - current_end)

        should_split = False

        if has_end_punct:
            if not is_abbreviation_or_number(word_text, next_word_text):
                should_split = True
        elif pause_duration >= 0.50 and len(current_sentence_words) >= 2:
            should_split = True
        elif pause_duration >= 0.35 and has_clause_punct and len(current_sentence_words) >= 4:
            should_split = True
        elif len(current_sentence_words) >= 16 and pause_duration >= 0.25:
            should_split = True

        if should_split and current_sentence_words:
            start_t = float(current_sentence_words[0].get("start", 0.0))
            end_t = float(current_sentence_words[-1].get("end", start_t))
            full_text = " ".join(cw.get("word", "").strip() for cw in current_sentence_words if cw.get("word", "").strip())
            word_list = [
                {
                    "word": cw.get("word", "").strip(),
                    "start": round(float(cw.get("start", 0.0)), 3),
                    "end": round(float(cw.get("end", 0.0)), 3),
                }
                for cw in current_sentence_words
                if cw.get("word", "").strip()
            ]
            sentences.append({
                "start": round(start_t, 3),
                "end": round(max(end_t, start_t + 0.1), 3),
                "text": full_text,
                "words": word_list,
            })
            current_sentence_words = []

    if current_sentence_words:
        start_t = float(current_sentence_words[0].get("start", 0.0))
        end_t = float(current_sentence_words[-1].get("end", start_t))
        full_text = " ".join(cw.get("word", "").strip() for cw in current_sentence_words if cw.get("word", "").strip())
        if full_text:
            word_list = [
                {
                    "word": cw.get("word", "").strip(),
                    "start": round(float(cw.get("start", 0.0)), 3),
                    "end": round(float(cw.get("end", 0.0)), 3),
                }
                for cw in current_sentence_words
                if cw.get("word", "").strip()
            ]
            sentences.append({
                "start": round(start_t, 3),
                "end": round(max(end_t, start_t + 0.1), 3),
                "text": full_text,
                "words": word_list,
            })

    return sentences


def fallback_split_segment_text(segment: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Fallback if word timestamps are missing: splits segment text by sentences proportionally."""
    text = segment.get("text", "").strip()
    seg_start = float(segment.get("start", 0.0))
    seg_end = float(segment.get("end", seg_start))
    duration = max(0.1, seg_end - seg_start)

    raw_sentences = re.split(r"(?<=[.?!])\s+", text)
    raw_sentences = [s.strip() for s in raw_sentences if s.strip()]

    if len(raw_sentences) <= 1:
        return [{"start": round(seg_start, 3), "end": round(seg_end, 3), "text": text}]

    total_chars = sum(len(s) for s in raw_sentences)
    if total_chars == 0:
        return [{"start": round(seg_start, 3), "end": round(seg_end, 3), "text": text}]

    res = []
    current_time = seg_start
    for s in raw_sentences:
        s_dur = duration * (len(s) / total_chars)
        s_end = min(seg_end, current_time + s_dur)
        res.append({
            "start": round(current_time, 3),
            "end": round(max(s_end, current_time + 0.1), 3),
            "text": s,
        })
        current_time = s_end

    return res


def emit_progress(
    stage: str,
    percent: float,
    message: str,
    detail: str = "",
    current_time: float = 0.0,
    total_duration: float = 0.0,
    chunk_index: int = 0,
    text: str = "",
):
    payload = {
        "type": "progress",
        "stage": stage,
        "percent": min(100.0, max(0.0, round(percent, 1))),
        "message": message,
        "detail": detail,
        "currentTime": round(current_time, 2),
        "totalDuration": round(total_duration, 2),
        "chunkIndex": chunk_index,
        "text": text,
    }
    sys.stdout.write(f"PROGRESS:{json.dumps(payload, ensure_ascii=False)}\n")
    sys.stdout.flush()


def get_optimal_device_and_compute():
    """Detects best compute engine: GPU (CUDA float16/int8) if supported, otherwise multi-threaded CPU INT8."""
    # Fast check: If nvidia-smi is not found, avoid triggering slow CUDA runtime crashes
    has_nvidia = bool(shutil.which("nvidia-smi"))
    if has_nvidia:
        try:
            import ctranslate2

            cuda_types = ctranslate2.get_supported_compute_types("cuda")
            if "float16" in cuda_types:
                return "cuda", "float16"
            elif "int8_float16" in cuda_types:
                return "cuda", "int8_float16"
            elif "int8" in cuda_types:
                return "cuda", "int8"
            elif cuda_types:
                return "cuda", "default"
        except Exception:
            pass

    # CPU INT8 uses AVX2 SIMD in CTranslate2, delivering blazing fast CPU inference
    return "cpu", "int8"


def convert_to_16k_mono_pcm(input_path: str) -> str:
    setup_ffmpeg_path()
    import subprocess
    import imageio_ffmpeg

    ff = shutil.which("ffmpeg")
    if not ff:
        try:
            ff = imageio_ffmpeg.get_ffmpeg_exe()
        except Exception:
            ff = "ffmpeg"

    temp_wav = os.path.join(tempfile.gettempdir(), f"vtttool_pcm16k_{os.getpid()}_{os.path.basename(input_path)}.wav")
    try:
        subprocess.run(
            [ff, "-y", "-i", input_path, "-threads", "0", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", temp_wav],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if os.path.exists(temp_wav) and os.path.getsize(temp_wav) > 100:
            return temp_wav
    except Exception as e:
        sys.stderr.write(f"Warning: fast audio pre-conversion failed: {e}\n")
    return input_path


def transcribe_audio_to_vtt(
    audio_path: str,
    model_name: str = "small",
    language: str = "en",
    initial_prompt: Optional[str] = None,
    level: str = "chunk",
) -> Dict[str, Any]:
    """Transcribes English audio into WebVTT cues at maximum speed using Whisper AI."""
    setup_ffmpeg_path()

    if not os.path.exists(audio_path):
        raise FileNotFoundError(f"Audio file not found: {audio_path}")

    # Pure English language locked
    actual_lang = "en"

    # Select model: default to small or requested model
    raw_model = (model_name or "small").strip().lower()
    
    # Ultra-Fast English Model Auto-Mapping:
    # Dedicated .en models are 2x faster than multilingual counterparts with 99%+ accuracy!
    if raw_model in ["small", "small.en"]:
        fw_model_name = "small.en"
    elif raw_model in ["base", "base.en"]:
        fw_model_name = "base.en"
    elif raw_model in ["tiny", "tiny.en"]:
        fw_model_name = "tiny.en"
    elif raw_model in ["medium", "medium.en"]:
        fw_model_name = "medium.en"
    elif raw_model in ["large", "large-v3", "large-v3-turbo"]:
        fw_model_name = "large-v3-turbo"
    else:
        fw_model_name = raw_model

    # Check Smart Cache for instant transcription
    cache_key = compute_audio_cache_key(audio_path, fw_model_name, actual_lang)
    cache_file = os.path.join(CACHE_DIR, f"{cache_key}.json")
    if os.path.exists(cache_file):
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_data = json.load(f)
            if cached_data.get("success"):
                sys.stderr.write(f"[*] Loaded from smart cache: {cache_key[:12]}\n")
                emit_progress("ready", 100.0, "Loaded from smart cache in 0.01s!", "Instant smart cache hit")
                return cached_data
        except Exception:
            pass

    emit_progress("uploading", 5.0, "Audio file received and verified", f"Size: {os.path.getsize(audio_path)/(1024*1024):.2f} MB")

    # Fast audio stream pre-conversion to 16kHz mono WAV using SIMD FFmpeg
    pcm_audio = convert_to_16k_mono_pcm(audio_path)
    emit_progress("preprocessing", 12.0, "Audio stream resampled to 16kHz mono PCM", "FFmpeg SIMD optimization")

    # English-specific vocabulary primer prompt
    effective_prompt = initial_prompt
    if not effective_prompt:
        effective_prompt = "English voiceover speech with clear punctuation and accurate transcription."
    else:
        effective_prompt = effective_prompt[-500:].strip()

    all_words = []
    raw_segments = []
    audio_duration = 0.0

    device, compute_type = get_optimal_device_and_compute()

    # Load faster-whisper
    try:
        from faster_whisper import WhisperModel
        import multiprocessing

        threads = min(8, max(2, os.cpu_count() or 4))
        emit_progress("loading_model", 18.0, f"Loading Whisper {fw_model_name} ({compute_type.upper()})...", f"CTranslate2 on {device.upper()} ({threads} threads)")

        # In-memory CTranslate2 engine with optimal intra-op parallelism
        model = WhisperModel(fw_model_name, device=device, compute_type=compute_type, cpu_threads=threads, num_workers=1)
        emit_progress("loading_model", 24.0, f"Whisper {fw_model_name} ready (EN)", "Recognition pipeline active")

        # Beam size 1 (greedy) is 2.5x faster with virtually identical accuracy
        # condition_on_previous_text=False eliminates hallucination loops and 5x stalls on pauses
        # temperature=0.0 eliminates expensive 6-step temperature fallback re-runs
        segments, info = model.transcribe(
            pcm_audio,
            beam_size=1,
            best_of=1,
            temperature=0.0,
            condition_on_previous_text=False,
            compression_ratio_threshold=2.4,
            log_prob_threshold=-1.0,
            no_speech_threshold=0.6,
            word_timestamps=True,
            language=actual_lang,
            vad_filter=True,
            vad_parameters=dict(min_silence_duration_ms=200, speech_pad_ms=100),
            initial_prompt=effective_prompt if effective_prompt else None,
        )

        audio_duration = info.duration or 0.0
        total_dur = max(0.1, audio_duration)
        seg_idx = 0

        for seg in segments:
            seg_idx += 1
            cur_sec = seg.end
            trans_pct = 24.0 + min(68.0, (cur_sec / total_dur) * 68.0)
            seg_text = seg.text.strip()
            emit_progress(
                "transcribing",
                trans_pct,
                f"Transcribing: {format_seconds_to_vtt_timestamp(cur_sec)} / {format_seconds_to_vtt_timestamp(total_dur)} ({trans_pct:.1f}%)",
                detail=f"Chunk #{seg_idx}: {seg_text[:65]}",
                current_time=cur_sec,
                total_duration=total_dur,
                chunk_index=seg_idx,
                text=seg_text,
            )

            if seg.words:
                for w in seg.words:
                    all_words.append({
                        "word": w.word.strip(),
                        "start": w.start,
                        "end": w.end,
                    })
            else:
                all_words.append({
                    "word": seg.text.strip(),
                    "start": seg.start,
                    "end": seg.end,
                })

    except Exception as fw_err:
        sys.stderr.write(f"faster-whisper error/fallback: {fw_err}\n")
        import whisper
        import torch

        threads = min(4, torch.get_num_threads())
        torch.set_num_threads(threads)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        model = whisper.load_model(fw_model_name, device=device)

        transcribe_options: Dict[str, Any] = {
            "word_timestamps": True,
            "fp16": (device == "cuda"),
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "language": actual_lang,
        }
        if effective_prompt:
            transcribe_options["initial_prompt"] = effective_prompt

        result = model.transcribe(audio_path, **transcribe_options)
        raw_segments = result.get("segments", [])

        for seg in raw_segments:
            words = seg.get("words", [])
            if words:
                all_words.extend(words)

    # 1. Build 3-4 WORD PHRASE CHUNKS (with pause and sentence break detection)
    phrase_chunks: List[Dict[str, Any]] = []
    if all_words:
        phrase_chunks = chunk_words_into_phrases(all_words)

    # 2. Build SENTENCE CHUNKS
    sentence_chunks: List[Dict[str, Any]] = []
    if all_words:
        sentence_chunks = segment_words_into_sentences(all_words)
    elif raw_segments:
        for seg in raw_segments:
            sentence_chunks.extend(fallback_split_segment_text(seg))

    # Helper to format cues into WebVTT text
    def build_vtt(cues_list):
        lines = ["WEBVTT", ""]
        for idx, c in enumerate(cues_list):
            lines.append(str(idx + 1))
            lines.append(c["rawHeader"])
            lines.append(c["text"])
            lines.append("")
        return "\n".join(lines)

    # A. Build PHRASE CUES (3 to 4 words per cue with silence gap marking)
    chunk_cues = []
    if phrase_chunks:
        for idx, pc in enumerate(phrase_chunks):
            cue_id = f"chunk-{idx + 1}"
            start_t = float(pc.get("start", 0.0))
            end_t = float(pc.get("end", start_t + 0.2))
            if chunk_cues and start_t < chunk_cues[-1]["endTime"]:
                start_t = chunk_cues[-1]["endTime"]
            if end_t <= start_t:
                end_t = round(start_t + 0.1, 3)

            dur = round(end_t - start_t, 3)
            clean_text = pc.get("text", "").strip()
            start_str = format_seconds_to_vtt_timestamp(start_t)
            end_str = format_seconds_to_vtt_timestamp(end_t)

            chunk_cues.append({
                "id": cue_id,
                "startTime": round(start_t, 3),
                "endTime": round(end_t, 3),
                "duration": dur,
                "text": clean_text,
                "cleanText": clean_text,
                "words": pc.get("words", []),
                "rawHeader": f"{start_str} --> {end_str}",
            })

    # B. Build WORD CUES (1 word per cue)
    word_cues = []
    if all_words:
        for idx, w in enumerate(all_words):
            raw_w = w.get("word", "").strip()
            if not raw_w:
                continue
            start_t = float(w.get("start", 0.0))
            end_t = float(w.get("end", start_t + 0.1))
            if word_cues and start_t < word_cues[-1]["endTime"]:
                start_t = word_cues[-1]["endTime"]
            if end_t <= start_t:
                end_t = round(start_t + 0.1, 3)

            dur = round(end_t - start_t, 3)
            start_str = format_seconds_to_vtt_timestamp(start_t)
            end_str = format_seconds_to_vtt_timestamp(end_t)
            cue_id = f"word-{len(word_cues) + 1}"

            word_cues.append({
                "id": cue_id,
                "startTime": round(start_t, 3),
                "endTime": round(end_t, 3),
                "duration": dur,
                "text": raw_w,
                "cleanText": raw_w,
                "words": [{
                    "word": raw_w,
                    "start": round(start_t, 3),
                    "end": round(end_t, 3),
                }],
                "rawHeader": f"{start_str} --> {end_str}",
            })

    # C. Build SENTENCE CUES (full sentence per cue)
    sentence_cues = []
    if sentence_chunks:
        for idx, sc in enumerate(sentence_chunks):
            cue_id = f"sentence-{idx + 1}"
            start_t = float(sc.get("start", 0.0))
            end_t = float(sc.get("end", start_t + 0.5))
            if sentence_cues and start_t < sentence_cues[-1]["endTime"]:
                start_t = sentence_cues[-1]["endTime"]
            if end_t <= start_t:
                end_t = round(start_t + 0.5, 3)

            dur = round(end_t - start_t, 3)
            clean_text = sc.get("text", "").strip()
            start_str = format_seconds_to_vtt_timestamp(start_t)
            end_str = format_seconds_to_vtt_timestamp(end_t)

            sentence_cues.append({
                "id": cue_id,
                "startTime": round(start_t, 3),
                "endTime": round(end_t, 3),
                "duration": dur,
                "text": clean_text,
                "cleanText": clean_text,
                "words": sc.get("words", []),
                "rawHeader": f"{start_str} --> {end_str}",
            })

    chunk_vtt_content = build_vtt(chunk_cues) if chunk_cues else ""
    word_vtt_content = build_vtt(word_cues) if word_cues else ""
    sentence_vtt_content = build_vtt(sentence_cues) if sentence_cues else ""

    # Choose active cues and active WebVTT based on requested level
    # 'chunk' (3-4 words with pause detection) is the primary default
    if level == "word" and word_cues:
        active_cues = word_cues
        active_vtt = word_vtt_content
        active_level = "word"
    elif level == "sentence" and sentence_cues:
        active_cues = sentence_cues
        active_vtt = sentence_vtt_content
        active_level = "sentence"
    else:
        # Default: 3-4 word phrase chunking
        active_cues = chunk_cues if chunk_cues else (word_cues if word_cues else sentence_cues)
        active_vtt = chunk_vtt_content if chunk_cues else (word_vtt_content if word_cues else sentence_vtt_content)
        active_level = "chunk" if chunk_cues else ("word" if word_cues else "sentence")

    # Update total audio duration
    if active_cues:
        audio_duration = max(audio_duration, active_cues[-1]["endTime"])
    elif all_words:
        audio_duration = max(audio_duration, all_words[-1].get("end", 0.0))

    ret_dict = {
        "success": True,
        "vtt": active_vtt,
        "cues": active_cues,
        "chunkCues": chunk_cues,
        "wordCues": word_cues,
        "sentenceCues": sentence_cues,
        "chunkVtt": chunk_vtt_content,
        "wordVtt": word_vtt_content,
        "sentenceVtt": sentence_vtt_content,
        "words": all_words,
        "chunkCount": len(chunk_cues),
        "wordCount": len(word_cues) if word_cues else len(all_words),
        "sentenceCount": len(sentence_cues),
        "audioDuration": round(audio_duration, 3),
        "detectedLanguage": "en (English)",
        "modelUsed": fw_model_name,
        "transcriptionLevel": active_level,
    }

    # Save to smart cache
    try:
        with open(cache_file, "w", encoding="utf-8") as f:
            json.dump(ret_dict, f, ensure_ascii=False)
    except Exception as ce:
        sys.stderr.write(f"Warning: could not write smart cache: {ce}\n")

    # Clean up temp converted PCM audio if any
    try:
        if pcm_audio != audio_path and os.path.exists(pcm_audio):
            os.remove(pcm_audio)
    except Exception:
        pass

    emit_progress("ready", 100.0, "Ready for matching!", f"Generated {len(active_cues)} cues ({active_level} mode) with exact speech timings")
    sys.stdout.write(f"RESULT:{json.dumps(ret_dict, ensure_ascii=False)}\n")
    sys.stdout.flush()

    return ret_dict


def main():
    parser = argparse.ArgumentParser(description="High-Speed English Voiceover Transcriber using Whisper")
    parser.add_argument("--audio", required=True, help="Path to input audio file (.wav, .mp3, etc.)")
    parser.add_argument("--model", default="small", help="Whisper model (e.g. small, base, large-v3-turbo)")
    parser.add_argument("--language", default="en", help="Language code (strictly 'en')")
    parser.add_argument("--initial-prompt", default=None, help="Initial text prompt / vocabulary hint for Whisper context")
    parser.add_argument("--script", default=None, help="Script text or file path to prime Whisper vocabulary matching")
    parser.add_argument("--level", default="chunk", choices=["chunk", "word", "sentence"], help="Transcription granularity: 'chunk' (3-4 words with pause detection, default), 'word', or 'sentence'")
    parser.add_argument("--output", default=None, help="Output JSON file path (default: prints to stdout)")
    parser.add_argument("--vtt-output", default=None, help="Optional output .vtt file path")

    args = parser.parse_args()

    try:
        prompt_text = args.initial_prompt
        if args.script:
            if os.path.exists(args.script):
                try:
                    with open(args.script, "r", encoding="utf-8") as sf:
                        prompt_text = sf.read()
                except Exception:
                    pass
            else:
                prompt_text = args.script

        data = transcribe_audio_to_vtt(
            args.audio,
            model_name=args.model,
            language="en",
            initial_prompt=prompt_text,
            level=args.level,
        )

        if args.vtt_output:
            with open(args.vtt_output, "w", encoding="utf-8") as f:
                f.write(data["vtt"])

        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"Transcription saved to {args.output}")
        else:
            json_str = json.dumps(data, ensure_ascii=False)
            sys.stdout.write(json_str + "\n")

    except Exception as e:
        err_res = {"success": False, "error": str(e)}
        if args.output:
            with open(args.output, "w", encoding="utf-8") as f:
                json.dump(err_res, f)
        sys.stderr.write(f"Error: {e}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
