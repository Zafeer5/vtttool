'use client';

import React, { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import {
  Mic,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Eye,
  Clock,
  Download,
  Play,
  Pause,
  FileAudio,
  Sparkles,
  Zap,
  Globe,
  Sliders,
  Check,
  ChevronDown,
  ChevronUp,
  Terminal,
  XCircle,
  Copy,
  Layers,
  RotateCcw,
  ClipboardPaste,
} from 'lucide-react';
import { VttCue, ParallelTranscripts } from '../lib/types';
import { formatSecondsToTimestamp, parseVtt, ensureWebVttFormat, SAMPLE_ENGLISH_VTT } from '../lib/vtt-parser';

interface VoiceoverUploaderProps {
  cues: VttCue[];
  rawVttContent: string;
  voiceoverFile: File | null;
  voiceoverUrl: string | null;
  scriptText?: string;
  parallelTranscripts?: ParallelTranscripts | null;
  onVoiceoverLoaded: (
    file: File | null,
    vttContent: string,
    cues: VttCue[],
    audioDuration: number,
    alignmentData?: any,
    parallelTranscripts?: ParallelTranscripts
  ) => void;
  onVoiceoverCleared: () => void;
  onCuesUpdated?: (updatedCues: VttCue[], updatedVtt: string) => void;
}

interface ProgressData {
  stage: 'idle' | 'uploading' | 'preprocessing' | 'loading_model' | 'transcribing' | 'word_timestamps' | 'multi_script' | 'ready';
  percent: number;
  message: string;
  detail?: string;
  currentTime: number;
  totalDuration: number;
  chunkIndex: number;
  liveText: string;
  elapsedSeconds: number;
  etaSeconds: number | null;
  logs: string[];
}

const STAGES = [
  { id: 'uploading', label: 'Audio Resampling' },
  { id: 'loading_model', label: 'Whisper Large-v3-Turbo' },
  { id: 'transcribing', label: 'Speech Recognition' },
  { id: 'word_timestamps', label: 'Word Alignment' },
  { id: 'multi_script', label: '3-Script Sync' },
];

export const VoiceoverUploader: React.FC<VoiceoverUploaderProps> = ({
  cues,
  rawVttContent,
  voiceoverFile,
  voiceoverUrl,
  scriptText,
  parallelTranscripts: parentParallelTranscripts,
  onVoiceoverLoaded,
  onVoiceoverCleared,
  onCuesUpdated,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Real-time progress state
  const [progress, setProgress] = useState<ProgressData>({
    stage: 'idle',
    percent: 0,
    message: '',
    detail: '',
    currentTime: 0,
    totalDuration: 0,
    chunkIndex: 0,
    liveText: '',
    elapsedSeconds: 0,
    etaSeconds: null,
    logs: [],
  });

  const [showLogs, setShowLogs] = useState(false);
  const [copiedLogs, setCopiedLogs] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Audio player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentAudioTime, setCurrentAudioTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Transcription Settings (English Only - Ultra Fast)
  const [model, setModel] = useState<string>('small.en');
  const [transcriptionLevel, setTranscriptionLevel] = useState<'chunk' | 'word' | 'sentence'>('chunk');
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [detectedLang, setDetectedLang] = useState<string | null>('en');
  const [showPreviewModal, setShowPreviewModal] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Subtitle Input Method: 'transcribe' (whisper) or 'paste' (paste/import VTT/SRT directly)
  const [inputMethod, setInputMethod] = useState<'transcribe' | 'paste'>('transcribe');
  const [pastedVttText, setPastedVttText] = useState<string>(rawVttContent || '');
  const [pastedVttError, setPastedVttError] = useState<string | null>(null);
  const [justAppliedPastedVtt, setJustAppliedPastedVtt] = useState(false);
  const subtitleFileInputRef = useRef<HTMLInputElement>(null);
  const optionalAudioInputRef = useRef<HTMLInputElement>(null);

  // Sync internal pastedVttText if rawVttContent changes externally
  useEffect(() => {
    if (rawVttContent && !pastedVttText) {
      setPastedVttText(rawVttContent);
    }
  }, [rawVttContent]);

  // Live parsed cues for pasted text
  const livePastedCues = React.useMemo(() => {
    if (!pastedVttText.trim()) return [];
    try {
      return parseVtt(pastedVttText);
    } catch {
      return [];
    }
  }, [pastedVttText]);

  const livePastedDuration = livePastedCues.length > 0 ? livePastedCues[livePastedCues.length - 1].endTime : 0;

  const handleApplyPastedVtt = () => {
    setPastedVttError(null);
    if (!pastedVttText.trim()) {
      setPastedVttError('Please paste WebVTT or SRT subtitle text, or load a sample file.');
      return;
    }
    const parsed = parseVtt(pastedVttText);
    if (parsed.length === 0) {
      setPastedVttError('No valid timestamped cues found. Ensure timestamps match 00:00:00.000 --> 00:00:04.000 or SRT format.');
      return;
    }
    const formattedVtt = ensureWebVttFormat(pastedVttText);
    const dur = stagedFile && audioDuration > 0
      ? audioDuration
      : (parsed[parsed.length - 1]?.endTime || 0);

    setJustAppliedPastedVtt(true);
    setTimeout(() => setJustAppliedPastedVtt(false), 2500);

    onVoiceoverLoaded(stagedFile, formattedVtt, parsed, dur);
  };

  const handleSubtitleFileUpload = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPastedVttError(null);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content || !content.trim()) {
        setPastedVttError('The selected subtitle file is empty.');
        return;
      }
      setPastedVttText(content);
    };
    reader.onerror = () => {
      setPastedVttError('Failed to read subtitle file.');
    };
    reader.readAsText(file);
    if (subtitleFileInputRef.current) {
      subtitleFileInputRef.current.value = '';
    }
  };

  const handleOptionalAudioSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStagedFile(file);
    setError(null);
    if (optionalAudioInputRef.current) {
      optionalAudioInputRef.current.value = '';
    }
  };

  const isWordLevel = React.useMemo(() => {
    if (cues.length === 0) return transcriptionLevel === 'word';
    const sample = cues.slice(0, 30);
    const avgWords =
      sample.reduce((acc, c) => acc + (c.cleanText || c.text || '').split(/\s+/).filter(Boolean).length, 0) /
      sample.length;
    return avgWords < 2.2;
  }, [cues, transcriptionLevel]);

  // Audio playback event listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentAudioTime(audio.currentTime);
    const onLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setAudioDuration(audio.duration);
      }
    };
    const onEnded = () => setIsPlaying(false);

    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('loadedmetadata', onLoadedMetadata);
    audio.addEventListener('ended', onEnded);

    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('loadedmetadata', onLoadedMetadata);
      audio.removeEventListener('ended', onEnded);
    };
  }, [voiceoverUrl]);

  const toggleAudioPlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {});
    }
  };

  const handleAudioSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentAudioTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  // Autoscroll live activity log
  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [progress.logs]);

  // Elapsed time ticker
  useEffect(() => {
    let ticker: any = null;
    if (isTranscribing) {
      ticker = setInterval(() => {
        setProgress((prev) => ({
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 1,
        }));
      }, 1000);
    }
    return () => {
      if (ticker) clearInterval(ticker);
    };
  }, [isTranscribing]);

  const handleCancelTranscription = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsTranscribing(false);
    setProgress((prev) => ({
      ...prev,
      stage: 'idle',
      message: 'Transcription cancelled by user.',
    }));
  };

  const copyActivityLogs = () => {
    if (progress.logs.length === 0) return;
    navigator.clipboard.writeText(progress.logs.join('\n'));
    setCopiedLogs(true);
    setTimeout(() => setCopiedLogs(false), 2000);
  };

  // REAL-TIME STREAMING TRANSCRIPTION PROCESSOR
  const processAudioFile = async (file: File) => {
    setError(null);
    const validExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.aac', '.flac'];
    const nameLower = file.name.toLowerCase();
    const isValid = validExtensions.some((ext) => nameLower.endsWith(ext)) || file.type.startsWith('audio/');

    if (!isValid) {
      setError('Please upload a valid voiceover audio file (.wav, .mp3, etc.).');
      return;
    }

    if (file.size === 0) {
      setError('The uploaded file is empty.');
      return;
    }

    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const initialLog = `[00:00] Starting fast transcription for ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)...`;

    setIsTranscribing(true);
    setProgress({
      stage: 'uploading',
      percent: 5,
      message: 'Uploading voiceover audio to AI pipeline...',
      detail: `${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`,
      currentTime: 0,
      totalDuration: 0,
      chunkIndex: 0,
      liveText: '',
      elapsedSeconds: 0,
      etaSeconds: null,
      logs: [initialLog],
    });

    const startTime = Date.now();

    try {
      const formData = new FormData();
      formData.append('audio', file);
      formData.append('model', model);
      formData.append('language', 'en');
      formData.append('level', transcriptionLevel);
      if (scriptText) {
        formData.append('script', scriptText);
      }

      const response = await fetch('/api/transcribe', {
        method: 'POST',
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        let errText = `Server error (${response.status})`;
        try {
          const errData = await response.json();
          if (errData?.error) errText = errData.error;
        } catch {}
        throw new Error(errText);
      }

      if (!response.body) {
        throw new Error('No streaming response body received from server.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let resultData: any = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;

          const payloadStr = trimmed.replace(/^data:\s*/, '');

          // 1. PROGRESS EVENT
          if (payloadStr.startsWith('PROGRESS:')) {
            try {
              const pData = JSON.parse(payloadStr.replace('PROGRESS:', ''));
              const elapsedSec = Math.max(1, (Date.now() - startTime) / 1000);

              let etaSec: number | null = null;
              if (pData.currentTime && pData.totalDuration && pData.currentTime > 0) {
                const speedRate = pData.currentTime / elapsedSec; // audio secs per real sec
                const remainingAudio = Math.max(0, pData.totalDuration - pData.currentTime);
                etaSec = speedRate > 0 ? Math.round(remainingAudio / speedRate) : null;
              }

              setProgress((prev) => {
                const newLogs = [...prev.logs];
                const timeTag = `[${String(Math.floor(elapsedSec / 60)).padStart(2, '0')}:${String(Math.floor(elapsedSec % 60)).padStart(2, '0')}]`;
                if (pData.detail && !newLogs.includes(`${timeTag} ${pData.detail}`)) {
                  newLogs.push(`${timeTag} ${pData.detail}`);
                }

                return {
                  ...prev,
                  stage: pData.stage || prev.stage,
                  percent: pData.percent !== undefined ? pData.percent : prev.percent,
                  message: pData.message || prev.message,
                  detail: pData.detail || prev.detail,
                  currentTime: pData.currentTime || prev.currentTime,
                  totalDuration: pData.totalDuration || prev.totalDuration,
                  chunkIndex: pData.chunkIndex || prev.chunkIndex,
                  liveText: pData.text || prev.liveText,
                  etaSeconds: etaSec,
                  logs: newLogs.slice(-100),
                };
              });
            } catch (e) {
              console.warn('Could not parse progress JSON:', e);
            }
          }

          // 2. RESULT EVENT
          else if (payloadStr.startsWith('RESULT:')) {
            try {
              resultData = JSON.parse(payloadStr.replace('RESULT:', ''));
            } catch (e) {
              console.warn('Could not parse result JSON:', e);
            }
          }

          // 3. LOG EVENT
          else if (payloadStr.startsWith('LOG:')) {
            try {
              const lData = JSON.parse(payloadStr.replace('LOG:', ''));
              if (lData.message) {
                setProgress((prev) => ({
                  ...prev,
                  logs: [...prev.logs, lData.message].slice(-100),
                }));
              }
            } catch {}
          }

          // 4. ERROR EVENT
          else if (payloadStr.startsWith('ERROR:')) {
            try {
              const errObj = JSON.parse(payloadStr.replace('ERROR:', ''));
              throw new Error(errObj.error || 'Transcription failed.');
            } catch (e: any) {
              throw new Error(e.message || 'Error occurred during transcription.');
            }
          }
        }
      }

      if (!resultData || !resultData.success) {
        throw new Error(resultData?.error || 'Transcription did not return a valid result.');
      }

      // Final completion state
      setProgress((prev) => ({
        ...prev,
        stage: 'ready',
        percent: 100,
        message: 'Transcription and 3-script synchronization completed!',
      }));

      if (resultData.detectedLanguage) {
        setDetectedLang(resultData.detectedLanguage);
      }

      const wordCuesList: VttCue[] = resultData.wordCues || resultData.cues || [];
      const sentenceCuesList: VttCue[] = resultData.sentenceCues || [];
      const wordVttStr: string = resultData.wordVtt || resultData.vtt || '';
      const sentenceVttStr: string = resultData.sentenceVtt || resultData.vtt || '';

      const parsedCues: VttCue[] =
        resultData.cues ||
        (transcriptionLevel === 'word' && wordCuesList.length > 0 ? wordCuesList : sentenceCuesList);
      const vttContent: string =
        resultData.vtt ||
        (transcriptionLevel === 'word' && wordVttStr ? wordVttStr : sentenceVttStr);
      const totalDur: number = resultData.audioDuration || 0;

      if (parsedCues.length === 0) {
        throw new Error('No speech detected in audio file. Please check audio volume.');
      }

      onVoiceoverLoaded(file, vttContent, parsedCues, totalDur, resultData, resultData.threeTranscripts);
    } catch (err: any) {
      if (abortController.signal.aborted) {
        return;
      }
      console.warn('Transcription error:', err);
      setError(err.message || 'Error occurred while transcribing audio.');
    } finally {
      setIsTranscribing(false);
      abortControllerRef.current = null;
    }
  };

  const handleSelectAudioFile = (file: File) => {
    setError(null);
    const validExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.aac', '.flac'];
    const nameLower = file.name.toLowerCase();
    const isValid = validExtensions.some((ext) => nameLower.endsWith(ext)) || file.type.startsWith('audio/');

    if (!isValid) {
      setError('Please upload a valid voiceover audio file (.wav, .mp3, .m4a, .aac, .flac).');
      return;
    }

    if (file.size === 0) {
      setError('The uploaded file is empty.');
      return;
    }

    setStagedFile(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleSelectAudioFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleSelectAudioFile(e.target.files[0]);
    }
  };

  const handleStartTranscription = () => {
    if (!stagedFile) {
      setError('Please select or upload an audio file first.');
      return;
    }
    processAudioFile(stagedFile);
  };

  const handleDownloadVtt = () => {
    if (!rawVttContent) return;
    const blob = new Blob([rawVttContent], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const baseName = voiceoverFile ? voiceoverFile.name.replace(/\.[^/.]+$/, '') : 'transcription';
    link.href = url;
    link.download = `${baseName}.vtt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const totalDuration = cues.length > 0 ? cues[cues.length - 1].endTime : audioDuration;

  // Active stage determination
  const activeStageIndex = React.useMemo(() => {
    const s = progress.stage;
    if (s === 'uploading' || s === 'preprocessing') return 0;
    if (s === 'loading_model') return 1;
    if (s === 'transcribing') return 2;
    if (s === 'word_timestamps') return 3;
    if (s === 'multi_script') return 4;
    if (s === 'ready') return 5;
    return -1;
  }, [progress.stage]);

  return (
    <div className="flex flex-col h-full rounded-2xl bg-white border border-gray-200 p-5 shadow-sm space-y-4">
      {voiceoverUrl && (
        <audio ref={audioRef} src={voiceoverUrl} preload="metadata" className="hidden" />
      )}

      {/* Card Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-200">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold font-mono text-gray-900 flex items-center gap-2">
              Voiceover Upload &amp; Precision Timing
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                High-Speed Whisper EN
              </span>
            </h2>
            <p className="text-[11px] text-gray-500 font-sans">
              Pure English speech recognition with 3–4 word phrase chunking &amp; pause detection
            </p>
          </div>
        </div>

        {cues.length > 0 && !isTranscribing && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5" />
            {cues.length} {transcriptionLevel === 'chunk' ? 'Phrases' : transcriptionLevel === 'word' ? 'Words' : 'Sentences'} Ready
          </span>
        )}
      </div>

      {/* INPUT METHOD SELECTOR TABS: Transcribe Audio vs Paste VTT / SRT */}
      {!isTranscribing && (
        <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-gray-100 border border-gray-200">
          <button
            type="button"
            onClick={() => setInputMethod('transcribe')}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              inputMethod === 'transcribe'
                ? 'bg-white text-gray-900 shadow-xs border border-gray-200 ring-1 ring-gray-900/5'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            <Mic className={`w-4 h-4 ${inputMethod === 'transcribe' ? 'text-red-600' : 'text-gray-400'}`} />
            <span>Transcribe Audio (Whisper AI)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setInputMethod('paste');
              if (!pastedVttText && rawVttContent) {
                setPastedVttText(rawVttContent);
              }
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-mono font-bold flex items-center justify-center gap-2 transition-all cursor-pointer ${
              inputMethod === 'paste'
                ? 'bg-white text-gray-900 shadow-xs border border-gray-200 ring-1 ring-gray-900/5'
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            <ClipboardPaste className={`w-4 h-4 ${inputMethod === 'paste' ? 'text-blue-600' : 'text-gray-400'}`} />
            <span>Paste VTT / SRT Subtitles</span>
            {cues.length > 0 && inputMethod === 'transcribe' && (
              <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-semibold">
                {cues.length} cues
              </span>
            )}
          </button>
        </div>
      )}

      {/* TRANSCRIPTION CONTROLS (Only when Transcribe mode is selected and cues not yet loaded) */}
      {inputMethod === 'transcribe' && cues.length === 0 && !isTranscribing && (
        <div className="p-4 rounded-2xl bg-gray-50/90 border border-gray-200 shadow-2xs space-y-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-red-600" />
              <span className="text-xs font-mono font-bold text-gray-900">
                High-Speed English Settings:
              </span>
            </div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-blue-50 text-blue-700 border border-blue-200">
            <Globe className="w-3 h-3 text-blue-600" />
            <span>Language: English (Locked 100% Accuracy)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 font-mono text-xs">
          {/* 1. Model Selection */}
          <div className="space-y-1.5">
            <label htmlFor="model-select" className="block text-[11px] font-bold text-gray-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                <span>1. Whisper Model <span className="text-red-500">*</span></span>
              </span>
              <span className="text-[10px] text-purple-600 font-semibold">Faster-Whisper INT8</span>
            </label>
            <div className="relative">
              <select
                id="model-select"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                disabled={isTranscribing}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl bg-white border border-gray-300 hover:border-gray-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-xs font-mono font-semibold text-gray-900 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
              >
                <option value="small.en">Small.en — Recommended (Ultra-Fast CPU, 99%+ Accuracy)</option>
                <option value="base.en">Base.en — Blazing Fast (Instant in 1–2s)</option>
                <option value="tiny.en">Tiny.en — Micro Instant (Sub-second)</option>
                <option value="large-v3-turbo">Large-v3-Turbo — Maximum Depth</option>
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
            <p className="text-[10px] text-gray-500 font-sans">
              Pure English models bypass multilingual overhead for 2x–5x speedup with zero hallucination loops.
            </p>
          </div>

          {/* 2. Transcription Granularity Mode */}
          <div className="space-y-1.5">
            <label htmlFor="mode-select" className="block text-[11px] font-bold text-gray-700 flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-600" />
                <span>2. Transcription Granularity <span className="text-red-500">*</span></span>
              </span>
              <span className="text-[10px] text-emerald-600 font-bold">Recommended: 3–4 Words</span>
            </label>
            <div className="relative">
              <select
                id="mode-select"
                value={transcriptionLevel}
                onChange={(e) => setTranscriptionLevel(e.target.value as 'chunk' | 'word' | 'sentence')}
                disabled={isTranscribing}
                className="w-full appearance-none px-3.5 py-2.5 rounded-xl bg-white border border-gray-300 hover:border-gray-400 focus:border-red-500 focus:ring-2 focus:ring-red-500/20 text-xs font-mono font-semibold text-gray-900 shadow-2xs transition-all cursor-pointer disabled:opacity-60"
              >
                <option value="chunk">3–4 Words (Recommended) — Natural Phrases + Pause Detection</option>
                <option value="word">Word by Word — Individual Token Timestamps</option>
                <option value="sentence">Sentence by Sentence — Complete Clauses</option>
              </select>
              <ChevronDown className="w-4 h-4 text-gray-400 pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
            <p className="text-[10px] text-gray-500 font-sans">
              {transcriptionLevel === 'chunk' && 'Groups 3–4 words per cue. Automatically breaks on sentence ends and silences to precisely capture next start timing.'}
              {transcriptionLevel === 'word' && 'Outputs an individual cue for every spoken word.'}
              {transcriptionLevel === 'sentence' && 'Outputs complete sentences separated by major punctuation and silence.'}
            </p>
          </div>
        </div>
      </div>
    )}

      {/* REBUILT REAL-TIME SATISFYING PROGRESS EXPERIENCE */}
      {isTranscribing && (
        <div className="p-5 rounded-2xl bg-gradient-to-br from-gray-900 to-gray-950 text-white border border-gray-800 shadow-xl space-y-4 font-mono animate-fadeIn">
          {/* Top Row: Current Stage & Live Percentage */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
              <span className="text-sm font-bold tracking-wide text-gray-100">
                {progress.message || 'Transcribing Speech...'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xl sm:text-2xl font-black text-red-500">
                {progress.percent.toFixed(1)}%
              </span>
              <button
                type="button"
                onClick={handleCancelTranscription}
                className="p-1 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors cursor-pointer"
                title="Cancel transcription"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* 5-Step Visual Stage Progress Pills */}
          <div className="grid grid-cols-5 gap-1.5 text-[10px]">
            {STAGES.map((stg, sIdx) => {
              const isDone = activeStageIndex > sIdx;
              const isCurrent = activeStageIndex === sIdx;

              return (
                <div
                  key={stg.id}
                  className={`p-1.5 rounded-lg border text-center transition-all ${
                    isCurrent
                      ? 'bg-red-600/30 border-red-500 text-white font-bold ring-1 ring-red-500 shadow-xs'
                      : isDone
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                      : 'bg-gray-800/40 border-gray-800 text-gray-500'
                  }`}
                >
                  <span className="truncate block">{stg.label}</span>
                </div>
              );
            })}
          </div>

          {/* Smooth Continuous Animated Progress Bar */}
          <div className="space-y-1.5">
            <div className="h-3 w-full bg-gray-800 rounded-full overflow-hidden p-0.5 border border-gray-700">
              <div
                className="h-full bg-gradient-to-r from-red-600 via-rose-500 to-amber-400 rounded-full transition-all duration-300 shadow-[0_0_12px_rgba(239,68,68,0.5)]"
                style={{ width: `${Math.max(4, Math.min(100, progress.percent))}%` }}
              />
            </div>

            {/* Metrics Bar: Processed Time, Elapsed, ETA */}
            <div className="flex flex-wrap items-center justify-between text-[11px] text-gray-400 pt-0.5">
              <div className="flex items-center gap-3">
                {progress.totalDuration > 0 && (
                  <span>
                    Audio: <span className="text-white font-bold">{formatSecondsToTimestamp(progress.currentTime)}</span> / {formatSecondsToTimestamp(progress.totalDuration)}
                  </span>
                )}
                {progress.chunkIndex > 0 && (
                  <span className="hidden sm:inline">
                    Chunk: <span className="text-white font-bold">#{progress.chunkIndex}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <span>
                  Elapsed: <span className="text-white">{formatSecondsToTimestamp(progress.elapsedSeconds)}</span>
                </span>
                {progress.etaSeconds !== null && progress.etaSeconds > 0 && (
                  <span className="text-amber-400 font-bold">
                    ETA: ~{progress.etaSeconds}s remaining
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Live Recognized Spoken Text Marquee Preview */}
          {progress.liveText && (
            <div className="p-3 rounded-xl bg-gray-900 border border-gray-800 space-y-1">
              <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">
                Currently Recognizing Speech:
              </div>
              <p
                className="text-xs sm:text-sm text-gray-200 line-clamp-2 leading-relaxed font-sans italic"
                dir="auto"
              >
                &ldquo;{progress.liveText}&rdquo;
              </p>
            </div>
          )}

          {/* Collapsible Live Activity Log Terminal */}
          <div className="border border-gray-800 rounded-xl overflow-hidden bg-black/60">
            <div
              onClick={() => setShowLogs((prev) => !prev)}
              className="px-3 py-2 bg-gray-900/90 hover:bg-gray-850 flex items-center justify-between cursor-pointer text-xs select-none"
            >
              <div className="flex items-center gap-2 text-gray-300">
                <Terminal className="w-3.5 h-3.5 text-red-500" />
                <span className="font-bold">Live Activity Log</span>
                <span className="text-[10px] text-gray-500">({progress.logs.length} events)</span>
              </div>

              <div className="flex items-center gap-2">
                {showLogs && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyActivityLogs();
                    }}
                    className="p-1 rounded text-gray-400 hover:text-white transition-colors cursor-pointer"
                    title="Copy logs"
                  >
                    {copiedLogs ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
                {showLogs ? <ChevronUp className="w-3.5 h-3.5 text-gray-400" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-400" />}
              </div>
            </div>

            {showLogs && (
              <div
                ref={logsContainerRef}
                className="p-3 max-h-40 overflow-y-auto font-mono text-[11px] text-gray-300 space-y-1 select-text"
              >
                {progress.logs.map((log, lIdx) => (
                  <div key={lIdx} className="leading-relaxed truncate">
                    {log}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* UPLOAD DROPZONE & STAGED AUDIO (When in transcribe mode and no cues loaded yet) */}
      {inputMethod === 'transcribe' && cues.length === 0 && !isTranscribing && (
        <div className="space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
            className="hidden"
            onChange={handleFileChange}
          />

          {!stagedFile ? (
            /* Drag and Dropzone when no file has been selected yet */
            <div className="space-y-2">
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
                  isDragging
                    ? 'border-red-500 bg-red-50/50 scale-[1.01]'
                    : 'border-gray-300 hover:border-red-400 bg-gray-50/50 hover:bg-gray-50'
                }`}
              >
                <div className="max-w-md mx-auto space-y-2 flex flex-col items-center">
                  <div className="p-3.5 rounded-2xl bg-red-50 text-red-600 border border-red-200">
                    <UploadCloud className="w-7 h-7" />
                  </div>
                  <div>
                    <p className="text-sm font-bold font-mono text-gray-900">
                      Click to select audio or drag and drop
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5 font-sans">
                      Audio files (.wav, .mp3, .m4a, .aac, .flac)
                    </p>
                  </div>
                  <div className="pt-1">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-mono font-bold bg-white text-gray-700 border border-gray-200 shadow-2xs">
                      Step 1: Select audio file &bull; Step 2: Click Start Transcription
                    </span>
                  </div>
                </div>
              </div>

              {/* Quick shortcut to Paste VTT / SRT directly */}
              <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-gray-500 pt-1">
                <span>Already have a subtitle file?</span>
                <button
                  type="button"
                  onClick={() => {
                    setInputMethod('paste');
                    if (!pastedVttText && rawVttContent) setPastedVttText(rawVttContent);
                  }}
                  className="text-blue-600 hover:text-blue-700 font-bold underline cursor-pointer flex items-center gap-1"
                >
                  <ClipboardPaste className="w-3.5 h-3.5" />
                  <span>Paste VTT / SRT directly &rarr;</span>
                </button>
              </div>
            </div>
          ) : (
            /* Staged Audio File Preview Card & Manual "Start Transcription" Button */
            <div className="p-5 rounded-2xl bg-gradient-to-br from-red-50/40 via-white to-amber-50/20 border-2 border-red-200/90 shadow-sm space-y-4 font-mono animate-fadeIn">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3.5 min-w-0">
                  <div className="p-3 rounded-2xl bg-red-600 text-white shadow-xs shrink-0">
                    <FileAudio className="w-6 h-6" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-gray-900 truncate block">
                        {stagedFile.name}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700 uppercase">
                        {(stagedFile.name.split('.').pop() || 'audio')}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500 font-sans mt-0.5">
                      Audio file loaded &bull; {(stagedFile.size / (1024 * 1024)).toFixed(2)} MB &bull; Language: <strong className="text-gray-800 font-mono">English (Strict)</strong>
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setStagedFile(null);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 transition-colors cursor-pointer shrink-0"
                  title="Pick a different audio file"
                >
                  Change Audio
                </button>
              </div>

              {/* Start Transcription and Paste VTT options */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={handleStartTranscription}
                  className="w-full py-4 px-6 rounded-2xl font-mono font-bold text-sm sm:text-base bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-500 hover:to-rose-500 active:scale-[0.99] text-white shadow-lg hover:shadow-red-500/30 flex items-center justify-center gap-3 transition-all cursor-pointer group"
                >
                  <Play className="w-5 h-5 fill-current text-white group-hover:scale-110 transition-transform" />
                  <span>Start Transcription (English &bull; {transcriptionLevel === 'chunk' ? '3-4 Word Phrases' : transcriptionLevel === 'word' ? 'Word by Word' : 'Sentence'})</span>
                </button>

                <div className="flex items-center justify-between text-[11px] text-gray-500 font-sans px-1">
                  <span>⚡ Whisper {model} Engine &bull; INT8</span>
                  <button
                    type="button"
                    onClick={() => {
                      setInputMethod('paste');
                      if (!pastedVttText && rawVttContent) setPastedVttText(rawVttContent);
                    }}
                    className="text-blue-600 hover:text-blue-700 font-mono font-bold underline cursor-pointer flex items-center gap-1"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    <span>Or Paste VTT / SRT for this audio</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PASTE VTT / SRT SUBTITLES PANEL */}
      {inputMethod === 'paste' && !isTranscribing && (
        <div className="space-y-4 font-mono animate-fadeIn">
          <div className="p-4 rounded-2xl bg-gradient-to-br from-blue-50/40 via-white to-gray-50 border border-blue-200/70 shadow-2xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-blue-100/70 text-blue-700 border border-blue-200">
                  <ClipboardPaste className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-xs sm:text-sm font-bold text-gray-900">
                    Paste Subtitle Text or Upload .VTT / .SRT
                  </h3>
                  <p className="text-[11px] text-gray-500 font-sans">
                    Provide pre-timed subtitles directly with sub-second accuracy (skips Whisper transcription)
                  </p>
                </div>
              </div>

              {/* Action buttons on toolbar */}
              <div className="flex items-center gap-2">
                <input
                  ref={subtitleFileInputRef}
                  type="file"
                  accept=".vtt,.srt,.txt"
                  className="hidden"
                  onChange={handleSubtitleFileUpload}
                />
                <button
                  type="button"
                  onClick={() => subtitleFileInputRef.current?.click()}
                  className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-xs font-semibold text-gray-700 shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Upload .vtt or .srt file from your computer"
                >
                  <UploadCloud className="w-3.5 h-3.5 text-blue-600" />
                  <span>Upload File</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setPastedVttText(SAMPLE_ENGLISH_VTT);
                    setPastedVttError(null);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-xs font-semibold text-purple-700 shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Load sample English WebVTT for testing"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  <span>Sample VTT</span>
                </button>

                {pastedVttText && (
                  <button
                    type="button"
                    onClick={() => {
                      setPastedVttText('');
                      setPastedVttError(null);
                    }}
                    className="p-1.5 rounded-xl text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    title="Clear text"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Error banner if any */}
            {pastedVttError && (
              <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{pastedVttError}</span>
              </div>
            )}

            {/* Code Textarea */}
            <div className="relative">
              <textarea
                value={pastedVttText}
                onChange={(e) => {
                  setPastedVttText(e.target.value);
                  setPastedVttError(null);
                }}
                rows={11}
                placeholder={`Paste your WebVTT (.vtt) or SubRip (.srt) subtitle text here:\n\nWEBVTT\n\n1\n00:00:00.000 --> 00:00:03.200\nIn this video we will discuss an important key to success.\n\n2\n00:00:03.200 --> 00:00:06.500\nHow positive thinking can change your daily life completely.`}
                className="w-full p-3.5 rounded-xl bg-gray-900 text-gray-100 font-mono text-xs leading-relaxed border border-gray-800 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 shadow-inner resize-y placeholder:text-gray-600 outline-none"
                spellCheck={false}
              />
            </div>

            {/* Status bar under textarea */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
              <div className="flex items-center gap-2">
                {livePastedCues.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 font-bold text-[11px]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{livePastedCues.length} Cues Detected</span>
                    <span className="text-emerald-500">&bull;</span>
                    <span>Total Duration: {formatSecondsToTimestamp(livePastedDuration)}</span>
                  </span>
                ) : (
                  <span className="text-[11px] text-gray-500 font-sans">
                    Supports WebVTT (.vtt) and SubRip (.srt) formats with sub-second timestamps.
                  </span>
                )}
              </div>

              <div className="text-[11px] text-gray-400">
                {pastedVttText.length} characters
              </div>
            </div>
          </div>

          {/* Optional Audio File Section */}
          <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileAudio className="w-4 h-4 text-gray-600" />
                <span className="text-xs font-bold text-gray-800">
                  Voiceover Audio File (Optional):
                </span>
              </div>
              {stagedFile && (
                <button
                  type="button"
                  onClick={() => {
                    setStagedFile(null);
                    if (optionalAudioInputRef.current) optionalAudioInputRef.current.value = '';
                  }}
                  className="text-[11px] text-red-600 hover:underline cursor-pointer"
                >
                  Remove audio
                </button>
              )}
            </div>

            <input
              ref={optionalAudioInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.m4a,.ogg,.aac,.flac"
              className="hidden"
              onChange={handleOptionalAudioSelect}
            />

            {stagedFile ? (
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-white border border-gray-200 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="font-bold text-gray-900 truncate">{stagedFile.name}</span>
                  <span className="text-gray-500 text-[10px]">
                    ({(stagedFile.size / (1024 * 1024)).toFixed(2)} MB)
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => optionalAudioInputRef.current?.click()}
                  className="px-2.5 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700 text-[10px] font-bold cursor-pointer transition-colors"
                >
                  Change Audio
                </button>
              </div>
            ) : (
              <div
                onClick={() => optionalAudioInputRef.current?.click()}
                className="p-3 rounded-lg border border-dashed border-gray-300 hover:border-gray-400 bg-white hover:bg-gray-50 text-center cursor-pointer transition-colors"
              >
                <p className="text-xs text-gray-600 font-bold">
                  Click to attach voiceover audio (.mp3, .wav)
                </p>
                <p className="text-[10px] text-gray-400 mt-0.5">
                  Optional: Enables synchronized audio playback in browser and soundtrack in rendered video.
                </p>
              </div>
            )}
          </div>

          {/* Action buttons: Apply Subtitles and optional Cancel */}
          <div className="flex flex-col sm:flex-row items-center gap-3 pt-1">
            {cues.length > 0 && (
              <button
                type="button"
                onClick={() => setInputMethod('transcribe')}
                className="w-full sm:w-auto py-3.5 px-5 rounded-xl border border-gray-300 hover:bg-gray-100 text-xs font-mono font-semibold text-gray-700 transition-colors cursor-pointer"
              >
                Cancel &amp; Return to Subtitles
              </button>
            )}

            <button
              type="button"
              onClick={handleApplyPastedVtt}
              disabled={livePastedCues.length === 0}
              className={`flex-1 w-full py-4 px-6 rounded-2xl font-mono font-bold text-sm sm:text-base flex items-center justify-center gap-3 transition-all cursor-pointer shadow-lg active:scale-[0.99] ${
                livePastedCues.length > 0
                  ? 'bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-500 hover:to-teal-500 text-white shadow-emerald-500/20'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed shadow-none'
              }`}
            >
              {justAppliedPastedVtt ? (
                <>
                  <Check className="w-5 h-5 text-white" />
                  <span>Subtitles Applied Successfully!</span>
                </>
              ) : (
                <>
                  <ClipboardPaste className="w-5 h-5" />
                  <span>
                    Apply Subtitles ({livePastedCues.length > 0 ? `${livePastedCues.length} Cues` : 'Paste Subtitles Above'})
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* VOICEOVER LOADED: FILE DETAILS & ENGLISH WEBVTT */}
      {cues.length > 0 && !isTranscribing && inputMethod === 'transcribe' ? (
        /* VOICEOVER LOADED: FILE DETAILS & ENGLISH WEBVTT */
        <div className="space-y-4">
          {/* File Card & Audio Player */}
          <div className="p-4 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="truncate flex items-center gap-2.5">
                <FileAudio className="w-5 h-5 text-red-600 shrink-0" />
                <div className="truncate">
                  <span className="text-xs font-mono font-bold text-gray-900 truncate block">
                    {voiceoverFile ? voiceoverFile.name : 'Custom Subtitles (.VTT / .SRT)'}
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {formatSecondsToTimestamp(totalDuration)} &bull; {cues.length} speech segments
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleDownloadVtt}
                  className="p-1.5 rounded-lg text-gray-500 hover:text-gray-900 hover:bg-white transition-colors cursor-pointer border border-transparent hover:border-gray-200"
                  title="Export .VTT subtitle file"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStagedFile(null);
                    onVoiceoverCleared();
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                  title="Remove voiceover and start over"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Audio scrubber or attach audio notice */}
            {voiceoverUrl ? (
              <div className="flex items-center gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={toggleAudioPlayback}
                  className="p-2 rounded-full bg-gray-900 text-white hover:bg-black transition-colors shrink-0 cursor-pointer shadow-xs"
                >
                  {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max={totalDuration || 1}
                  step="0.05"
                  value={currentAudioTime}
                  onChange={handleAudioSeek}
                  className="w-full h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-600"
                />
                <span className="font-mono text-[11px] text-gray-600 shrink-0">
                  {formatSecondsToTimestamp(currentAudioTime)} / {formatSecondsToTimestamp(totalDuration)}
                </span>
              </div>
            ) : (
              <div className="p-2 rounded-lg bg-white border border-dashed border-gray-300 flex items-center justify-between text-xs font-mono">
                <span className="text-gray-500 text-[11px]">Subtitles loaded without audio file</span>
                <button
                  type="button"
                  onClick={() => optionalAudioInputRef.current?.click()}
                  className="px-2.5 py-1 rounded bg-red-50 hover:bg-red-100 text-red-700 font-bold text-[10px] cursor-pointer transition-colors"
                >
                  + Attach Audio (.mp3/.wav)
                </button>
              </div>
            )}
          </div>

          {/* SUBTITLE TIMINGS LIST (VTT STYLE) WITH LIVE PLAYBACK HIGHLIGHT */}
          <div className="space-y-2 pt-2 border-t border-gray-100">
            <div className="flex items-center justify-between text-xs font-mono text-gray-500">
              <span className="font-bold text-gray-800 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-red-600" />
                <span>Subtitle Timings List ({cues.length} cues):</span>
              </span>
              <span className="text-[10px] text-gray-400">
                Click any cue to seek audio
              </span>
            </div>

            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white max-h-60 overflow-y-auto divide-y divide-gray-100 font-mono text-xs shadow-inner">
              {cues.slice(0, 200).map((cueItem, cIdx) => {
                const isActive = currentAudioTime >= cueItem.startTime && currentAudioTime < cueItem.endTime;
                return (
                  <div
                    key={cueItem.id || cIdx}
                    onClick={() => {
                      if (audioRef.current) {
                        audioRef.current.currentTime = cueItem.startTime;
                        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                      }
                    }}
                    className={`flex items-center justify-between px-3.5 py-2 transition-colors cursor-pointer text-xs ${
                      isActive
                        ? 'bg-amber-100 text-amber-950 font-bold border-l-4 border-amber-500'
                        : 'hover:bg-gray-50 text-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="text-[10px] text-gray-400 w-6 shrink-0">#{cIdx + 1}</span>
                      <span className="truncate">
                        {cueItem.cleanText || cueItem.text}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-gray-500 shrink-0">
                      <span className="text-red-600 font-mono">
                        {formatSecondsToTimestamp(cueItem.startTime)} &rarr; {formatSecondsToTimestamp(cueItem.endTime)}
                      </span>
                      <span className="px-1.5 py-0.2 rounded bg-gray-100 text-gray-600 text-[10px]">
                        {cueItem.duration.toFixed(2)}s
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setStagedFile(null);
                onVoiceoverCleared();
              }}
              className="py-2 px-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-xs font-mono font-semibold text-gray-700 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              title="Upload and transcribe a new audio file"
            >
              <RotateCcw className="w-3.5 h-3.5 text-gray-500" />
              <span className="hidden sm:inline">New Voiceover</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setInputMethod('paste');
                setPastedVttText(rawVttContent);
              }}
              className="py-2 px-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-xs font-mono font-semibold text-gray-800 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              title="Paste new or updated VTT/SRT subtitles directly"
            >
              <ClipboardPaste className="w-3.5 h-3.5 text-blue-600" />
              <span>Paste / Edit VTT</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPreviewModal(true)}
              className="flex-1 py-2 px-3 rounded-xl bg-white border border-gray-200 hover:bg-gray-100 text-xs font-mono font-semibold text-gray-800 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Eye className="w-3.5 h-3.5 text-gray-500" />
              <span>Full VTT Inspector ({cues.length} {isWordLevel ? 'words' : 'cues'})</span>
            </button>
            <button
              type="button"
              onClick={handleDownloadVtt}
              className="px-4 py-2 rounded-xl bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-mono font-bold shadow-2xs flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Download Word-level VTT"
            >
              <Download className="w-3.5 h-3.5 text-red-600" />
              <span>Export VTT</span>
            </button>
          </div>
        </div>
      ) : null}

      {error && (
        <div className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs font-mono text-red-700 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{error}</span>
        </div>
      )}

      {/* Inspect Raw VTT Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl border border-gray-200 shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden font-mono text-xs">
            <div className="px-5 py-3.5 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="font-bold text-gray-900 text-sm">
                Transcribed {isWordLevel ? 'Spoken Words' : 'Voiceover Sentences'} ({cues.length})
              </h3>
              <button
                onClick={() => setShowPreviewModal(false)}
                className="text-gray-400 hover:text-gray-700 text-base cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {cues.map((c, idx) => (
                <div key={c.id || idx} className="p-2.5 rounded-xl bg-gray-50 border border-gray-200 space-y-1">
                  <div className="flex items-center justify-between text-[10px] text-gray-500 font-bold">
                    <span className="px-1.5 py-0.5 rounded bg-gray-200/80 text-gray-700">
                      {isWordLevel ? 'Word' : 'Sentence'} #{idx + 1}
                    </span>
                    <span className="text-red-600">{formatSecondsToTimestamp(c.startTime)} &rarr; {formatSecondsToTimestamp(c.endTime)}</span>
                  </div>
                  <div className="text-gray-900 text-xs leading-relaxed font-sans">
                    {c.cleanText}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 text-xs font-bold rounded-xl bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 cursor-pointer shadow-xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
