'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  Clock,
  Layers,
  ArrowRight,
  Sparkles,
  Subtitles,
  FileText,
  Check,
  Zap,
  Film,
  CheckCheck,
  ShieldCheck,
  Link2,
  Download,
  Volume2,
  Sliders,
  ChevronDown,
  AlertCircle,
  FileCode,
  ListOrdered,
  RotateCcw,
} from 'lucide-react';
import { VttCue, ScriptParagraph, ImageItem, SyncMatch } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';
import { synchronizeScriptAndVtt, intelligentAutoSync } from '../lib/matcher';
import { WordToFrameConnector } from './WordToFrameConnector';
import { SegmentTimelineBar } from './SegmentTimelineBar';
import { AdjustSlideModal } from './AdjustSlideModal';

interface TranscriptionSyncVerifierProps {
  cues: VttCue[];
  paragraphs: ScriptParagraph[];
  images: ImageItem[];
  voiceoverUrl?: string | null;
  onApplyAndUnlockTimeline: () => void;
  isTimelineUnlocked: boolean;
  onCustomMatchesChange?: (matches: SyncMatch[]) => void;
  customMatches?: SyncMatch[] | null;
}

export const TranscriptionSyncVerifier: React.FC<TranscriptionSyncVerifierProps> = ({
  cues,
  paragraphs,
  images,
  voiceoverUrl,
  onApplyAndUnlockTimeline,
  isTimelineUnlocked,
  onCustomMatchesChange,
  customMatches,
}) => {
  const [activeTab, setActiveTab] = useState<'mapped' | 'sentences' | 'transcription'>('mapped');
  const [isWordLinkerOpen, setIsWordLinkerOpen] = useState<boolean>(false);
  const [adjustingSlideIndex, setAdjustingSlideIndex] = useState<number | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [autoSyncNotice, setAutoSyncNotice] = useState<{ count: number; score: number } | null>(null);
  const [currentAudioTime, setCurrentAudioTime] = useState<number>(0);

  // Audition playback state
  const [auditioningIndex, setAuditioningIndex] = useState<{
    type: 'paragraph' | 'cue' | 'sentence';
    index: number;
    startTime?: number;
    endTime?: number;
  } | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Base synchronization computed from cues + paragraphs
  const syncAnalysis = useMemo(() => {
    return synchronizeScriptAndVtt(paragraphs, cues, images);
  }, [paragraphs, cues, images]);

  // Use customMatches (e.g. from Python forced aligner or user adjustments) if matching paragraph count
  const effectiveMatches: SyncMatch[] = useMemo(() => {
    if (customMatches && customMatches.length === paragraphs.length && paragraphs.length > 0) {
      return customMatches.map((m, idx) => ({
        ...m,
        image: idx < images.length ? images[idx] : m.image,
      }));
    }
    return syncAnalysis.matches;
  }, [customMatches, paragraphs.length, images, syncAnalysis.matches]);

  const effectiveTotalDuration = useMemo(() => {
    if (effectiveMatches.length > 0) {
      return effectiveMatches[effectiveMatches.length - 1].endTime;
    }
    return syncAnalysis.totalDuration;
  }, [effectiveMatches, syncAnalysis.totalDuration]);

  const matchedCount = useMemo(() => {
    return effectiveMatches.filter(
      (m) => (m.confidenceScore ?? 85) >= 60 || m.matchedCue !== null
    ).length;
  }, [effectiveMatches]);

  const averageConfidence = useMemo(() => {
    if (effectiveMatches.length === 0) return 0;
    const total = effectiveMatches.reduce((acc, m) => acc + (m.confidenceScore ?? 85), 0);
    return Math.round(total / effectiveMatches.length);
  }, [effectiveMatches]);

  const { sentences = [] } = syncAnalysis;

  // Check if current cues are word-level (average words per cue < 2.2)
  const isWordLevel = useMemo(() => {
    if (cues.length === 0) return false;
    const sample = cues.slice(0, 30);
    const avgWords =
      sample.reduce(
        (acc, c) => acc + (c.cleanText || c.text || '').split(/\s+/).filter(Boolean).length,
        0
      ) / sample.length;
    return avgWords < 2.2;
  }, [cues]);

  // Compute which cues are paragraph triggers
  const triggerCueIndices = useMemo(() => {
    const map = new Map<number, number>();
    effectiveMatches.forEach((m) => {
      if (m.matchedCue) {
        const cIdx = cues.findIndex(
          (c) => c.startTime === m.matchedCue?.startTime && c.text === m.matchedCue?.text
        );
        if (cIdx !== -1) {
          map.set(cIdx, m.index);
        }
      }
    });
    return map;
  }, [effectiveMatches, cues]);

  // Audio time listener for visualizer playhead
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const handleTime = () => setCurrentAudioTime(audio.currentTime);
    audio.addEventListener('timeupdate', handleTime);
    return () => audio.removeEventListener('timeupdate', handleTime);
  }, []);

  // Audio audition watcher (stops audio when segment concludes)
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let targetEndTime: number | null = null;

    if (auditioningIndex) {
      if (auditioningIndex.type === 'cue') {
        const cue = cues[auditioningIndex.index];
        if (cue) {
          audio.currentTime = cue.startTime;
          targetEndTime = cue.endTime;
          audio.play().catch(() => {});
        }
      } else if (auditioningIndex.type === 'paragraph') {
        const match = effectiveMatches[auditioningIndex.index];
        if (match) {
          audio.currentTime = match.startTime;
          targetEndTime = match.endTime;
          audio.play().catch(() => {});
        }
      } else if (auditioningIndex.type === 'sentence') {
        if (auditioningIndex.startTime !== undefined && auditioningIndex.endTime !== undefined) {
          audio.currentTime = auditioningIndex.startTime;
          targetEndTime = auditioningIndex.endTime;
          audio.play().catch(() => {});
        }
      }
    } else {
      audio.pause();
    }

    const handleTimeUpdate = () => {
      if (targetEndTime !== null && audio.currentTime >= targetEndTime) {
        audio.pause();
        setAuditioningIndex(null);
      }
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [auditioningIndex, cues, effectiveMatches]);

  const toggleAuditionCue = (index: number) => {
    if (auditioningIndex?.type === 'cue' && auditioningIndex.index === index) {
      setAuditioningIndex(null);
    } else {
      setAuditioningIndex({ type: 'cue', index });
    }
  };

  const toggleAuditionParagraph = (index: number) => {
    if (auditioningIndex?.type === 'paragraph' && auditioningIndex.index === index) {
      setAuditioningIndex(null);
    } else {
      setAuditioningIndex({ type: 'paragraph', index });
    }
  };

  const toggleAuditionSentence = (idx: number, startTime?: number, endTime?: number) => {
    if (auditioningIndex?.type === 'sentence' && auditioningIndex.index === idx) {
      setAuditioningIndex(null);
    } else {
      setAuditioningIndex({ type: 'sentence', index: idx, startTime, endTime });
    }
  };

  const handleTriggerIntelligentAutoSync = () => {
    if (effectiveMatches.length === 0 || cues.length === 0) return;
    const result = intelligentAutoSync(effectiveMatches, cues, effectiveTotalDuration);
    onCustomMatchesChange?.(result.optimizedMatches);
    setAutoSyncNotice({ count: result.optimizationsApplied, score: result.confidenceScore });
    setTimeout(() => setAutoSyncNotice(null), 5000);
  };

  // Export File Generators
  const downloadTextFile = (content: string, filename: string, mime: string = 'text/plain;charset=utf-8') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setIsExportMenuOpen(false);
  };

  const handleExportParagraphVtt = () => {
    const lines = ['WEBVTT - Forced Alignment Paragraph Slides', ''];
    effectiveMatches.forEach((m, idx) => {
      const s = formatSecondsToTimestamp(m.startTime, true);
      const e = formatSecondsToTimestamp(m.endTime, true);
      lines.push(`${idx + 1}`);
      lines.push(`${s} --> ${e}`);
      lines.push(m.paragraph.text);
      lines.push('');
    });
    downloadTextFile(lines.join('\n'), 'slideshow-paragraphs.vtt', 'text/vtt;charset=utf-8');
  };

  const handleExportSentenceVtt = () => {
    if (syncAnalysis.sentenceVtt) {
      downloadTextFile(syncAnalysis.sentenceVtt, 'slideshow-sentences.vtt', 'text/vtt;charset=utf-8');
    }
  };

  const handleExportSrt = () => {
    const lines: string[] = [];
    effectiveMatches.forEach((m, idx) => {
      const s = formatSecondsToTimestamp(m.startTime, true).replace('.', ',');
      const e = formatSecondsToTimestamp(m.endTime, true).replace('.', ',');
      lines.push(`${idx + 1}`);
      lines.push(`${s} --> ${e}`);
      lines.push(m.paragraph.text);
      lines.push('');
    });
    downloadTextFile(lines.join('\n'), 'subtitles.srt', 'application/x-subrip;charset=utf-8');
  };

  const handleExportJsonTimeline = () => {
    const data = {
      project: 'VTT Slideshow Timeline',
      generator: 'vtttool-forced-aligner',
      generatedAt: new Date().toISOString(),
      totalDuration: effectiveTotalDuration,
      averageConfidence,
      slideCount: effectiveMatches.length,
      paragraphs: effectiveMatches.map((m) => ({
        slideIndex: m.index,
        slideNumber: m.index + 1,
        startTime: m.startTime,
        endTime: m.endTime,
        duration: m.duration,
        confidenceScore: m.confidenceScore ?? 85,
        status: m.status ?? 'exact',
        triggerAnchorWords: m.triggerSentence || m.searchPhrase,
        paragraphText: m.paragraph.text,
        imageFileName: m.image?.name || null,
        imageSize: m.image?.size || null,
      })),
    };
    downloadTextFile(JSON.stringify(data, null, 2), 'project_timeline.json', 'application/json;charset=utf-8');
  };

  const handleExportPremiereCsv = () => {
    const lines: string[] = ['Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type'];
    effectiveMatches.forEach((m) => {
      const s = formatSecondsToTimestamp(m.startTime, true);
      const e = formatSecondsToTimestamp(m.endTime, true);
      const d = formatSecondsToTimestamp(m.duration, true);
      const cleanDesc = m.paragraph.text.replace(/[\t\r\n]+/g, ' ');
      lines.push(`Slide ${m.index + 1}\t${cleanDesc}\t${s}\t${e}\t${d}\tComment`);
    });
    downloadTextFile(lines.join('\n'), 'premiere_pro_markers.csv', 'text/tab-separated-values;charset=utf-8');
  };

  // Verification checks
  const hasCues = cues.length > 0;
  const hasParagraphs = paragraphs.length > 0;
  const isAllParagraphsMatched = hasParagraphs && matchedCount === paragraphs.length;
  const isImageCountMatched = hasParagraphs && images.length === paragraphs.length;
  const is100PercentPerfect = isAllParagraphsMatched && isImageCountMatched && hasCues;

  if (!hasCues && !hasParagraphs) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm space-y-5 font-sans">
      {voiceoverUrl && <audio ref={audioRef} src={voiceoverUrl} preload="auto" />}

      {/* 1. Header with Verification Status & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-gray-100">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold font-mono text-gray-900 flex items-center gap-2">
              Forced Alignment &amp; Verification
              {is100PercentPerfect ? (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200 flex items-center gap-1">
                  <CheckCheck className="w-3 h-3" />
                  100% Synced
                </span>
              ) : (
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 font-semibold border border-amber-200 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" />
                  {matchedCount}/{paragraphs.length} Synced
                </span>
              )}
            </h3>
          </div>
          <p className="text-[11px] font-mono text-gray-500 mt-0.5">
            Anchor-matched on opening 3–4 words with continuous image holding
          </p>
        </div>

        {/* View Mode Switcher & Export Menu */}
        <div className="flex flex-wrap items-center gap-2">
          {cues.length > 0 && effectiveMatches.length > 0 && (
            <button
              type="button"
              onClick={handleTriggerIntelligentAutoSync}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-bold rounded-lg bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 hover:from-amber-600 hover:to-red-700 text-white shadow-xs transition-all cursor-pointer active:scale-95"
              title="Intelligently calculate word tempo, silence pauses, and snap slide transitions to speech cues"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>⚡ Auto-Snap</span>
            </button>
          )}

          {cues.length > 0 && (
            <button
              type="button"
              onClick={() => setIsWordLinkerOpen(true)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors shadow-2xs cursor-pointer"
              title="Open Timing Linker"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Timing Linker</span>
            </button>
          )}

          {/* Export Center Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsExportMenuOpen(!isExportMenuOpen)}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-mono font-bold rounded-lg bg-gray-900 hover:bg-gray-800 text-white shadow-2xs transition-colors cursor-pointer"
              title="Export Subtitles, Timelines, and Markers"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export</span>
              <ChevronDown className="w-3 h-3 ml-0.5 opacity-80" />
            </button>

            {isExportMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setIsExportMenuOpen(false)}
                />
                <div className="absolute right-0 mt-1.5 w-64 rounded-xl bg-white border border-gray-200 shadow-xl p-1.5 z-40 space-y-1 font-mono text-xs animate-fadeIn">
                  <button
                    onClick={handleExportParagraphVtt}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-gray-800 cursor-pointer"
                  >
                    <FileCode className="w-4 h-4 text-blue-500 shrink-0" />
                    <div>
                      <div className="font-bold">Paragraph WebVTT (.vtt)</div>
                      <div className="text-[10px] text-gray-400 font-sans">1 cue per slide for video players</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportSrt}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-gray-800 cursor-pointer"
                  >
                    <Subtitles className="w-4 h-4 text-emerald-500 shrink-0" />
                    <div>
                      <div className="font-bold">SubRip Subtitles (.srt)</div>
                      <div className="text-[10px] text-gray-400 font-sans">Standard SRT format</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportJsonTimeline}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-gray-800 cursor-pointer"
                  >
                    <FileText className="w-4 h-4 text-purple-500 shrink-0" />
                    <div>
                      <div className="font-bold">Project Timeline (.json)</div>
                      <div className="text-[10px] text-gray-400 font-sans">Full JSON timestamps &amp; images</div>
                    </div>
                  </button>

                  <button
                    onClick={handleExportPremiereCsv}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-gray-800 cursor-pointer"
                  >
                    <Film className="w-4 h-4 text-amber-500 shrink-0" />
                    <div>
                      <div className="font-bold">Premiere Markers (.csv)</div>
                      <div className="text-[10px] text-gray-400 font-sans">Import markers in Premiere/AE</div>
                    </div>
                  </button>

                  {syncAnalysis.sentenceVtt && (
                    <button
                      onClick={handleExportSentenceVtt}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-gray-100 flex items-center gap-2 text-gray-800 cursor-pointer"
                    >
                      <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
                      <div>
                        <div className="font-bold">Sentence WebVTT (.vtt)</div>
                        <div className="text-[10px] text-gray-400 font-sans">Word-timed sentence track</div>
                      </div>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Tab Switcher */}
          <div className="flex items-center rounded-lg bg-gray-100 border border-gray-200 p-0.5 text-xs font-mono">
            <button
              type="button"
              onClick={() => setActiveTab('mapped')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                activeTab === 'mapped'
                  ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Slides ({effectiveMatches.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('sentences')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                activeTab === 'sentences'
                  ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Sparkles className="w-3 h-3 text-amber-500" />
              <span>Sentences ({sentences.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('transcription')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded font-semibold transition-all cursor-pointer ${
                activeTab === 'transcription'
                  ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              <Subtitles className="w-3 h-3" />
              <span>{isWordLevel ? 'Words' : 'Cues'} ({cues.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* 2. BIG STATUS INDICATORS DASHBOARD */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        {/* Paragraphs Detected */}
        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Script Paragraphs
            </span>
            <span className="p-1 rounded-md bg-blue-50 text-blue-600 border border-blue-200">
              <Layers className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-lg font-bold text-gray-900">
            {paragraphs.length} <span className="text-xs font-normal text-gray-500">detected</span>
          </div>
          <span className="text-[10px] text-gray-400 block truncate">
            Anchored on first 3–4 words
          </span>
        </div>

        {/* Images Matched */}
        <div
          className={`p-3.5 rounded-xl border shadow-2xs ${
            isImageCountMatched
              ? 'bg-emerald-50/50 border-emerald-200'
              : 'bg-amber-50/60 border-amber-300'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] uppercase tracking-wider font-semibold text-gray-500">
              Visual Placement
            </span>
            <span
              className={`p-1 rounded-md border ${
                isImageCountMatched
                  ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                  : 'bg-amber-100 text-amber-700 border-amber-300'
              }`}
            >
              {isImageCountMatched ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertTriangle className="w-3.5 h-3.5" />
              )}
            </span>
          </div>
          <div
            className={`text-lg font-bold ${
              isImageCountMatched ? 'text-emerald-800' : 'text-amber-800'
            }`}
          >
            {images.length} / {paragraphs.length}{' '}
            <span className="text-xs font-normal opacity-75">matched</span>
          </div>
          <span
            className={`text-[10px] block truncate font-sans ${
              isImageCountMatched ? 'text-emerald-700' : 'text-amber-700 font-semibold'
            }`}
          >
            {isImageCountMatched
              ? '✓ Perfect 1:1 image placement'
              : images.length < paragraphs.length
              ? `⚠️ Need ${paragraphs.length - images.length} more image(s)`
              : `⚠️ ${images.length - paragraphs.length} extra unassigned image(s)`}
          </span>
        </div>

        {/* Average Confidence */}
        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Average Confidence
            </span>
            <span className="p-1 rounded-md bg-emerald-50 text-emerald-600 border border-emerald-200">
              <Sparkles className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <span>{averageConfidence}%</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-semibold border ${
                averageConfidence >= 85
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : averageConfidence >= 70
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
              }`}
            >
              {averageConfidence >= 85 ? 'High Accuracy' : averageConfidence >= 70 ? 'Good' : 'Flagged'}
            </span>
          </div>
          <span className="text-[10px] text-gray-400 block truncate">
            {effectiveMatches.filter((m) => (m.confidenceScore ?? 85) >= 85).length} of{' '}
            {effectiveMatches.length} slides high match
          </span>
        </div>

        {/* Total Audio Duration */}
        <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 shadow-2xs">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-gray-500 uppercase tracking-wider font-semibold">
              Audio Duration
            </span>
            <span className="p-1 rounded-md bg-gray-100 text-gray-600 border border-gray-200">
              <Clock className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="text-lg font-bold text-gray-900">
            {formatSecondsToTimestamp(effectiveTotalDuration)}
          </div>
          <span className="text-[10px] text-gray-400 block truncate">
            Zero black frames between slides
          </span>
        </div>
      </div>

      {/* Count Mismatch Warning Banner */}
      {!isImageCountMatched && hasParagraphs && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs font-mono text-amber-900 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>
              <strong>Count Mismatch:</strong> You have {paragraphs.length} script paragraphs but{' '}
              {images.length} images uploaded. Please add or remove images in Frame #2 so each paragraph
              has exactly 1 visual slide.
            </span>
          </div>
        </div>
      )}

      {/* 3. VISUAL SEGMENT TIMELINE BAR */}
      <SegmentTimelineBar
        matches={effectiveMatches}
        totalDuration={effectiveTotalDuration}
        currentTime={currentAudioTime}
        onSeek={(time) => {
          if (audioRef.current) {
            audioRef.current.currentTime = time;
            audioRef.current.play().catch(() => {});
          }
        }}
        activeSlideIndex={auditioningIndex?.type === 'paragraph' ? auditioningIndex.index : null}
      />

      {/* Intelligent Auto-Sync Live Notice */}
      {autoSyncNotice && (
        <div className="flex items-center justify-between p-3 rounded-xl bg-gradient-to-r from-amber-50 to-emerald-50 border border-emerald-200 text-xs font-mono text-emerald-900 shadow-2xs">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <span>
              <strong>Intelligent Speech Alignment:</strong> Snapped {autoSyncNotice.count} slide boundaries
              to speech pauses. Alignment confidence: <strong>{autoSyncNotice.score}%</strong>.
            </span>
          </div>
          <span className="text-[10px] uppercase font-bold text-emerald-700 bg-white/80 px-2 py-0.5 rounded border border-emerald-200 shrink-0">
            Active
          </span>
        </div>
      )}

      {/* 4. MAIN CONTENT TABS */}
      {activeTab === 'mapped' ? (
        <div className="space-y-2.5">
          <div className="max-h-[420px] overflow-y-auto space-y-2.5 pr-1">
            {effectiveMatches.map((match, idx) => {
              const isAuditioning =
                auditioningIndex?.type === 'paragraph' && auditioningIndex.index === idx;
              const hasImg = !!match.image;
              const score = match.confidenceScore ?? 85;

              return (
                <div
                  key={idx}
                  className={`rounded-xl border p-3.5 bg-white transition-all ${
                    isAuditioning
                      ? 'border-gray-900 ring-2 ring-gray-900 shadow-md'
                      : !hasImg
                      ? 'border-amber-300 bg-amber-50/20'
                      : score < 70
                      ? 'border-rose-300 bg-rose-50/20'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 items-center">
                    {/* Left: Slide & Thumbnail */}
                    <div className="lg:col-span-3 flex items-center gap-3">
                      <div className="relative aspect-video w-24 sm:w-28 rounded-lg bg-gray-900 border border-gray-200 shrink-0 overflow-hidden flex items-center justify-center shadow-xs group">
                        {match.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={match.image.previewUrl}
                            alt={match.image.name}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                          />
                        ) : (
                          <span className="text-amber-600 text-[9px] font-mono font-bold">No Image</span>
                        )}
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono font-bold text-white border border-white/10">
                          #{idx + 1}
                        </span>
                      </div>

                      <div className="min-w-0 font-mono text-xs">
                        <span className="font-bold text-gray-900 block">Slide #{idx + 1}</span>
                        <span
                          className="text-[10px] text-gray-500 truncate block font-sans"
                          title={match.image?.name || 'Missing'}
                        >
                          {match.image ? match.image.name : 'Image needed'}
                        </span>
                        <span className="text-[9px] text-emerald-700 bg-emerald-50 px-1 py-0.2 rounded border border-emerald-200 inline-block mt-0.5">
                          {(match.endTime - match.startTime).toFixed(2)}s duration
                        </span>
                      </div>
                    </div>

                    {/* Middle: Script Paragraph & Anchor Trigger */}
                    <div className="lg:col-span-6 space-y-1.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="px-1.5 py-0.2 rounded bg-amber-100 text-amber-800 text-[10px] font-mono font-bold shrink-0">
                          🎯 3–4 Anchor Words:
                        </span>
                        <span className="font-bold text-gray-900 text-xs font-sans">
                          &ldquo;{match.searchPhrase || match.triggerSentence}&rdquo;
                        </span>
                      </div>

                      <p className="text-gray-800 text-xs font-sans leading-relaxed line-clamp-2">
                        {match.paragraph.text}
                      </p>

                      {match.matchedTextSnippet ? (
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 bg-gray-50 px-2 py-0.5 rounded border border-gray-200 truncate">
                          <Check className="w-3 h-3 text-emerald-600 shrink-0" />
                          <span className="truncate italic font-sans">
                            ASR Match: &ldquo;{match.matchedTextSnippet}&rdquo;
                          </span>
                        </div>
                      ) : (
                        <div className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          Continuous timeline: synced with speech velocity
                        </div>
                      )}
                    </div>

                    {/* Right: Timestamps, Confidence, & Actions */}
                    <div className="lg:col-span-3 flex flex-col sm:flex-row lg:flex-col items-end justify-center gap-2 pt-1 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                      <div className="flex items-center gap-1.5">
                        <div className="font-mono text-xs font-bold px-2 py-1 rounded bg-gray-100 text-gray-900 border border-gray-200 whitespace-nowrap">
                          {formatSecondsToTimestamp(match.startTime)} &rarr;{' '}
                          {formatSecondsToTimestamp(match.endTime)}
                        </div>

                        <span
                          className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${
                            score >= 90
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : score >= 75
                              ? 'bg-blue-50 text-blue-700 border-blue-200'
                              : 'bg-amber-50 text-amber-700 border-amber-200'
                          }`}
                        >
                          {score}%
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {/* 1-Click Adjust Button */}
                        <button
                          type="button"
                          onClick={() => setAdjustingSlideIndex(idx)}
                          className="flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-semibold rounded-lg bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-200 transition-colors shadow-2xs cursor-pointer active:scale-95"
                          title="1-Click Adjust Paragraph Start/End Boundaries"
                        >
                          <Sliders className="w-3.5 h-3.5 text-gray-600" />
                          <span>Adjust</span>
                        </button>

                        {/* Audition Button */}
                        {voiceoverUrl && (
                          <button
                            type="button"
                            onClick={() => toggleAuditionParagraph(idx)}
                            className="p-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer shadow-2xs shrink-0"
                            title="Listen to this slide segment"
                          >
                            {isAuditioning ? (
                              <Pause className="w-3.5 h-3.5 fill-current text-red-600" />
                            ) : (
                              <Play className="w-3.5 h-3.5 fill-current" />
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Sub-sentences inside this paragraph slide */}
                  {match.sentences && match.sentences.length > 1 && (
                    <div className="mt-2.5 pt-2 border-t border-gray-100 space-y-1">
                      <span className="text-[10px] font-mono text-gray-500 font-semibold block">
                        Sentences in this Slide ({match.sentences.length}):
                      </span>
                      <div className="flex flex-col gap-1">
                        {match.sentences.map((sent, sIdx) => {
                          const isSentAuditioning =
                            auditioningIndex?.type === 'sentence' &&
                            auditioningIndex.index === sent.overallSentenceIndex;
                          return (
                            <div
                              key={sent.id || sIdx}
                              className={`flex items-center justify-between gap-3 p-1.5 rounded-md border text-xs font-mono transition-all ${
                                isSentAuditioning
                                  ? 'bg-red-50/70 border-red-200 text-gray-900'
                                  : 'bg-gray-50 border-gray-200 text-gray-700'
                              }`}
                            >
                              <div className="min-w-0 flex items-center gap-1.5 truncate">
                                <span className="text-[9px] text-gray-400 shrink-0">#{sIdx + 1}</span>
                                <span className="truncate text-xs font-sans">
                                  {sent.cleanText}
                                </span>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700 whitespace-nowrap">
                                  {formatSecondsToTimestamp(sent.startTime)} &rarr;{' '}
                                  {formatSecondsToTimestamp(sent.endTime)}
                                </span>
                                {voiceoverUrl && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      toggleAuditionSentence(
                                        sent.overallSentenceIndex,
                                        sent.startTime,
                                        sent.endTime
                                      )
                                    }
                                    className="p-1 hover:text-gray-900 text-gray-500 cursor-pointer"
                                    title="Listen"
                                  >
                                    {isSentAuditioning ? (
                                      <Pause className="w-3 h-3 fill-current text-red-600" />
                                    ) : (
                                      <Play className="w-3 h-3 fill-current" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === 'sentences' ? (
        /* TAB 2: SENTENCE-BY-SENTENCE TIMINGS */
        <div className="space-y-2">
          <div className="max-h-[380px] overflow-y-auto space-y-1.5 pr-1">
            {sentences.map((sent, idx) => {
              const isAuditioning =
                auditioningIndex?.type === 'sentence' && auditioningIndex.index === idx;

              return (
                <div
                  key={sent.id || idx}
                  className={`p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between gap-3 ${
                    isAuditioning
                      ? 'bg-red-50 border-red-200 shadow-2xs'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-gray-400 w-5 shrink-0">#{idx + 1}</span>
                    <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-gray-700 text-[10px] font-bold shrink-0">
                      Slide #{sent.paragraphIndex + 1}
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700 shrink-0 whitespace-nowrap">
                      {formatSecondsToTimestamp(sent.startTime)} &rarr;{' '}
                      {formatSecondsToTimestamp(sent.endTime)}
                    </span>
                    <p className="text-gray-900 text-xs truncate font-sans">
                      {sent.cleanText}
                    </p>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {voiceoverUrl && (
                      <button
                        type="button"
                        onClick={() => toggleAuditionSentence(idx, sent.startTime, sent.endTime)}
                        className="p-1 rounded bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 cursor-pointer shadow-2xs"
                        title={isAuditioning ? 'Pause' : 'Audition sentence'}
                      >
                        {isAuditioning ? (
                          <Pause className="w-3 h-3 fill-current text-red-600" />
                        ) : (
                          <Play className="w-3 h-3 fill-current" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* TAB 3: RAW SPOKEN WORDS / CUES */
        <div className="space-y-2">
          {isWordLevel ? (
            <div className="max-h-[380px] overflow-y-auto p-3 rounded-lg border border-gray-200 bg-gray-50/50">
              <div className="text-[11px] font-mono text-gray-500 mb-2.5 flex items-center justify-between">
                <span>Click any word to audition. Highlighted badges show where script slides begin.</span>
                <span className="text-[10px] text-gray-400">Total: {cues.length} words</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cues.map((cue, idx) => {
                  const isAuditioning =
                    auditioningIndex?.type === 'cue' && auditioningIndex.index === idx;
                  const isTrigger = triggerCueIndices.has(idx);
                  const triggerSlideNum = triggerCueIndices.get(idx);

                  return (
                    <div
                      key={idx}
                      onClick={() => toggleAuditionCue(idx)}
                      className={`group flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-mono transition-all cursor-pointer ${
                        isAuditioning
                          ? 'bg-red-600 text-white border-red-700 shadow-xs'
                          : isTrigger
                          ? 'bg-blue-50 border-blue-300 text-blue-900 font-bold shadow-2xs ring-1 ring-blue-300'
                          : 'bg-white border-gray-200 hover:border-gray-400 text-gray-800'
                      }`}
                      title={`${cue.cleanText} (${formatSecondsToTimestamp(
                        cue.startTime
                      )}) - Click to listen`}
                    >
                      {isTrigger && (
                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-blue-600 text-white uppercase">
                          Slide #{(triggerSlideNum || 0) + 1}
                        </span>
                      )}
                      <span className="font-sans">
                        {cue.cleanText}
                      </span>
                      <span
                        className={`text-[10px] ${
                          isAuditioning ? 'text-red-100' : 'text-gray-400'
                        }`}
                      >
                        {formatSecondsToTimestamp(cue.startTime)}
                      </span>
                      {voiceoverUrl && (
                        <Volume2
                          className={`w-3 h-3 ${
                            isAuditioning ? 'text-white' : 'text-gray-400 group-hover:text-gray-700'
                          }`}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="max-h-[380px] overflow-y-auto space-y-1.5 pr-1">
              {cues.map((cue, idx) => {
                const isAuditioning =
                  auditioningIndex?.type === 'cue' && auditioningIndex.index === idx;
                const isTrigger = triggerCueIndices.has(idx);
                const triggerSlideNum = triggerCueIndices.get(idx);

                return (
                  <div
                    key={idx}
                    className={`p-2.5 rounded-lg border text-xs font-mono flex items-center justify-between gap-3 ${
                      isAuditioning
                        ? 'bg-red-50 border-red-200'
                        : isTrigger
                        ? 'bg-blue-50/50 border-blue-200'
                        : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] text-gray-400 w-5 shrink-0">#{idx + 1}</span>
                      <span className="px-1.5 py-0.5 rounded bg-white border border-gray-200 text-[10px] text-gray-700 shrink-0 whitespace-nowrap">
                        {formatSecondsToTimestamp(cue.startTime)} &rarr;{' '}
                        {formatSecondsToTimestamp(cue.endTime)}
                      </span>
                      {isTrigger && (
                        <span className="px-1.5 py-0.2 rounded bg-blue-100 text-blue-800 text-[9px] font-bold shrink-0">
                          Slide #{(triggerSlideNum || 0) + 1} Trigger
                        </span>
                      )}
                      <p className="text-gray-900 text-xs truncate font-sans">
                        {cue.cleanText}
                      </p>
                    </div>

                    {voiceoverUrl && (
                      <button
                        type="button"
                        onClick={() => toggleAuditionCue(idx)}
                        className="p-1 rounded bg-white border border-gray-200 hover:bg-gray-100 text-gray-700 cursor-pointer shadow-2xs shrink-0"
                        title={isAuditioning ? 'Pause' : 'Audition cue'}
                      >
                        {isAuditioning ? (
                          <Pause className="w-3 h-3 fill-current text-red-600" />
                        ) : (
                          <Play className="w-3 h-3 fill-current" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 5. ACTION BAR: VERIFY & UNLOCK TIMELINE */}
      <div className="pt-3 border-t border-gray-100 flex items-center justify-between flex-wrap gap-3">
        <div className="text-xs font-mono text-gray-500">
          {isTimelineUnlocked
            ? 'Timeline verified & synchronized. You can now edit visual transitions in Frame #4 below.'
            : 'Review paragraph timing triggers to unlock timeline and video preview.'}
        </div>

        <button
          type="button"
          onClick={onApplyAndUnlockTimeline}
          className="px-5 py-2 text-xs font-mono font-bold rounded-lg bg-gray-900 hover:bg-gray-800 text-white shadow-sm transition-all cursor-pointer flex items-center gap-2 active:scale-95"
        >
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{isTimelineUnlocked ? 'Re-Sync Images to Timeline' : 'Verify & Sync Images to Timeline'}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Word-to-Frame Connector Modal */}
      {isWordLinkerOpen && (
        <WordToFrameConnector
          isOpen={isWordLinkerOpen}
          onClose={() => setIsWordLinkerOpen(false)}
          matches={effectiveMatches}
          cues={cues}
          paragraphs={paragraphs}
          images={images}
          voiceoverUrl={voiceoverUrl}
          totalDuration={effectiveTotalDuration}
          onApplyMatches={(updated) => {
            onCustomMatchesChange?.(updated);
            setIsWordLinkerOpen(false);
          }}
        />
      )}

      {/* 1-Click Adjust Slide Modal */}
      {adjustingSlideIndex !== null && (
        <AdjustSlideModal
          isOpen={adjustingSlideIndex !== null}
          slideIndex={adjustingSlideIndex}
          matches={effectiveMatches}
          audioElement={audioRef.current}
          onClose={() => setAdjustingSlideIndex(null)}
          onSave={(updated) => {
            onCustomMatchesChange?.(updated);
            setAdjustingSlideIndex(null);
          }}
        />
      )}
    </div>
  );
};
