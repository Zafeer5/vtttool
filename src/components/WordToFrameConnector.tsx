'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Link2,
  Play,
  Pause,
  Check,
  Search,
  Sparkles,
  Download,
  X,
  Volume2,
  Layers,
  ChevronRight,
  Clock,
  CheckCircle2,
} from 'lucide-react';
import { SyncMatch, VttCue, ScriptParagraph, ImageItem } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';
import { buildVttFromSentences, syncSlidesFromAlignedSentences, alignScriptSentencesWithWordCues } from '../lib/sentence-aligner';

interface WordToFrameConnectorProps {
  isOpen: boolean;
  onClose: () => void;
  matches: SyncMatch[];
  cues: VttCue[];
  paragraphs: ScriptParagraph[];
  images: ImageItem[];
  voiceoverUrl?: string | null;
  totalDuration: number;
  onApplyMatches: (updatedMatches: SyncMatch[]) => void;
}

export const WordToFrameConnector: React.FC<WordToFrameConnectorProps> = ({
  isOpen,
  onClose,
  matches,
  cues,
  paragraphs,
  images,
  voiceoverUrl,
  totalDuration,
  onApplyMatches,
}) => {
  // Working copy of matches
  const [workingMatches, setWorkingMatches] = useState<SyncMatch[]>([]);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [auditioningWordId, setAuditioningWordId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wordStreamRef = useRef<HTMLDivElement | null>(null);

  // Sync working matches when modal opens
  useEffect(() => {
    if (isOpen) {
      setWorkingMatches(JSON.parse(JSON.stringify(matches)));
      setSelectedSlideIndex(0);
      setCurrentTime(0);
      setIsPlaying(false);
    }
  }, [isOpen, matches]);

  // Audio time update
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
      if (auditioningWordId) {
        const cue = cues.find((c) => c.id === auditioningWordId);
        if (cue && audio.currentTime >= cue.endTime) {
          audio.pause();
          setAuditioningWordId(null);
          setIsPlaying(false);
        }
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      setAuditioningWordId(null);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('ended', handleEnded);
    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [cues, auditioningWordId]);

  // Map each slide start to the closest word cue index
  const slideToWordIndexMap = useMemo(() => {
    const map = new Map<number, number>();
    workingMatches.forEach((m, sIdx) => {
      const matchStart = m.startTime;
      let closestIdx = 0;
      let minDiff = Infinity;
      cues.forEach((c, cIdx) => {
        const diff = Math.abs(c.startTime - matchStart);
        if (diff < minDiff) {
          minDiff = diff;
          closestIdx = cIdx;
        }
      });
      map.set(sIdx, closestIdx);
    });
    return map;
  }, [workingMatches, cues]);

  const wordIndexToSlideMap = useMemo(() => {
    const map = new Map<number, number>();
    slideToWordIndexMap.forEach((cIdx, sIdx) => {
      map.set(cIdx, sIdx);
    });
    return map;
  }, [slideToWordIndexMap]);

  // Link selected slide to a specific word cue
  const handleLinkSlideToWord = (slideIdx: number, cueIdx: number) => {
    if (slideIdx < 0 || slideIdx >= workingMatches.length || cueIdx < 0 || cueIdx >= cues.length) {
      return;
    }

    const targetCue = cues[cueIdx];
    const newStartTime = targetCue.startTime;

    const updated = workingMatches.map((m) => ({ ...m }));

    // Update selected slide
    updated[slideIdx].startTime = newStartTime;
    updated[slideIdx].confidence = 'manual';
    updated[slideIdx].matchedCue = targetCue;
    updated[slideIdx].matchedTextSnippet = targetCue.cleanText;

    if (slideIdx > 0) {
      updated[slideIdx - 1].endTime = newStartTime;
      updated[slideIdx - 1].duration = Math.max(0.1, Number((newStartTime - updated[slideIdx - 1].startTime).toFixed(3)));
    }

    if (slideIdx < updated.length - 1) {
      const nextStart = updated[slideIdx + 1].startTime;
      if (nextStart > newStartTime) {
        updated[slideIdx].endTime = nextStart;
        updated[slideIdx].duration = Math.max(0.1, Number((nextStart - newStartTime).toFixed(3)));
      } else {
        updated[slideIdx + 1].startTime = Number((newStartTime + 2.0).toFixed(3));
        updated[slideIdx].endTime = updated[slideIdx + 1].startTime;
        updated[slideIdx].duration = 2.0;
      }
    } else {
      const endT = totalDuration > newStartTime ? totalDuration : newStartTime + 3.0;
      updated[slideIdx].endTime = endT;
      updated[slideIdx].duration = Math.max(0.1, Number((endT - newStartTime).toFixed(3)));
    }

    setWorkingMatches(updated);

    if (slideIdx < workingMatches.length - 1) {
      setSelectedSlideIndex(slideIdx + 1);
    }
  };

  const handleAuditionWord = (cue: VttCue, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = Math.max(0, cue.startTime - 0.05);
    setAuditioningWordId(cue.id);
    audio.play();
    setIsPlaying(true);
  };

  const handlePlaySlideAudio = (slide: SyncMatch, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;

    audio.currentTime = slide.startTime;
    setAuditioningWordId(null);
    audio.play();
    setIsPlaying(true);
  };

  const togglePlayPause = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      setIsPlaying(false);
    } else {
      audio.play();
      setIsPlaying(true);
    }
  };

  const handleAutoAlign = () => {
    const result = alignScriptSentencesWithWordCues(paragraphs, cues, totalDuration);
    const autoSlides = syncSlidesFromAlignedSentences(paragraphs, result.sentences, images, totalDuration);
    setWorkingMatches(autoSlides);
    setSelectedSlideIndex(0);
  };

  const handleApply = () => {
    onApplyMatches(workingMatches);
    onClose();
  };

  const handleDownloadSentenceVtt = () => {
    const result = alignScriptSentencesWithWordCues(paragraphs, cues, totalDuration);
    const blob = new Blob([result.sentenceVtt], { type: 'text/vtt;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sentence-level-subtitles.vtt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const filteredCues = useMemo(() => {
    if (!searchQuery.trim()) return cues;
    const q = searchQuery.toLowerCase().trim();
    return cues.filter((c) => (c.cleanText || c.text).toLowerCase().includes(q));
  }, [cues, searchQuery]);

  if (!isOpen) return null;

  const activeSlide = workingMatches[selectedSlideIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150">
      {voiceoverUrl && <audio ref={audioRef} src={voiceoverUrl} preload="auto" />}

      <div className="relative flex flex-col w-full max-w-6xl h-[90vh] bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden text-gray-900 font-sans">
        
        {/* HEADER BAR */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50/80">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gray-900 text-white shadow-2xs">
              <Link2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold font-mono text-gray-900">
                  Timing Linker
                </h2>
                <span className="px-2 py-0.5 text-[10px] font-mono font-semibold rounded-full bg-red-50 text-red-700 border border-red-200">
                  Sentence / Word Sync
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleAutoAlign}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 transition-colors shadow-2xs cursor-pointer"
              title="Automatically match script sentences against voiceover"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
              <span>Auto-Align</span>
            </button>

            <button
              onClick={handleDownloadSentenceVtt}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-semibold rounded-lg bg-white hover:bg-gray-100 border border-gray-200 text-gray-700 transition-colors shadow-2xs cursor-pointer"
              title="Download sentence-level WebVTT"
            >
              <Download className="w-3.5 h-3.5 text-purple-600" />
              <span>Export VTT</span>
            </button>

            <button
              onClick={handleApply}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-mono font-bold rounded-lg bg-gray-900 hover:bg-gray-800 text-white transition-all shadow-2xs cursor-pointer"
            >
              <Check className="w-4 h-4 text-emerald-400" />
              <span>Apply Timeline</span>
            </button>

            <button
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* AUDIO SCRUBBER BAR */}
        <div className="flex items-center gap-3 px-5 py-2 bg-gray-50 border-b border-gray-200 text-xs font-mono">
          <button
            onClick={togglePlayPause}
            className="flex items-center justify-center w-7 h-7 rounded-full bg-gray-900 hover:bg-gray-800 text-white transition-colors shadow-2xs cursor-pointer"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-gray-700 min-w-[120px]">
            <Clock className="w-3.5 h-3.5 text-gray-500" />
            <span>{formatSecondsToTimestamp(currentTime)}</span>
            <span className="text-gray-400">/</span>
            <span className="text-gray-500">{formatSecondsToTimestamp(totalDuration)}</span>
          </div>

          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min={0}
              max={totalDuration || 1}
              step={0.01}
              value={currentTime}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setCurrentTime(val);
                if (audioRef.current) {
                  audioRef.current.currentTime = val;
                }
              }}
              className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-red-600"
            />
          </div>

          {activeSlide && (
            <div className="flex items-center gap-2 px-2.5 py-1 rounded bg-white border border-gray-200 text-xs">
              <span className="text-gray-500">Selected:</span>
              <span className="font-bold text-gray-900">
                Slide #{activeSlide.index + 1}
              </span>
              <span className="text-gray-300">|</span>
              <span className="font-mono text-gray-700">
                {formatSecondsToTimestamp(activeSlide.startTime)} &rarr; {formatSecondsToTimestamp(activeSlide.endTime)}
              </span>
            </div>
          )}
        </div>

        {/* MAIN WORKSPACE: 2-COLUMN VIEW */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* LEFT COLUMN: SLIDE FRAMES (42% width) */}
          <div className="w-[42%] flex flex-col border-r border-gray-200 bg-gray-50/50 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-100/70 border-b border-gray-200 font-mono text-xs">
              <div className="flex items-center gap-1.5 text-gray-900 font-bold">
                <Layers className="w-3.5 h-3.5" />
                <span>Slides ({workingMatches.length})</span>
              </div>
              <span className="text-[11px] text-gray-500">Select slide to link word</span>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {workingMatches.map((slide, sIdx) => {
                const isSelected = selectedSlideIndex === sIdx;
                const linkedCueIdx = slideToWordIndexMap.get(sIdx);
                const linkedCue = linkedCueIdx !== undefined ? cues[linkedCueIdx] : null;

                return (
                  <div
                    key={`slide-${sIdx}`}
                    onClick={() => setSelectedSlideIndex(sIdx)}
                    className={`group relative flex flex-col p-2.5 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? 'bg-white border-red-500 ring-1 ring-red-500 shadow-sm'
                        : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    {/* Top Row: Slide header & timestamps */}
                    <div className="flex items-center justify-between mb-1.5 font-mono text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-gray-100 text-gray-800 border border-gray-200">
                          #{sIdx + 1}
                        </span>
                        <span className="text-gray-900 font-semibold whitespace-nowrap">
                          {formatSecondsToTimestamp(slide.startTime)} &rarr; {formatSecondsToTimestamp(slide.endTime)}
                        </span>
                        <span className="text-[10px] text-gray-500">
                          ({slide.duration.toFixed(1)}s)
                        </span>
                      </div>

                      <button
                        onClick={(e) => handlePlaySlideAudio(slide, e)}
                        className="p-1 rounded text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
                        title="Audition slide"
                      >
                        <Volume2 className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    {/* Middle: Image thumbnail & Script Text */}
                    <div className="flex gap-2.5 items-center">
                      {slide.image?.previewUrl ? (
                        <div className="relative w-14 h-10 shrink-0 rounded overflow-hidden border border-gray-200 bg-gray-100">
                          <img
                            src={slide.image.previewUrl}
                            alt={slide.image.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-10 shrink-0 rounded border border-dashed border-gray-300 bg-gray-50 flex items-center justify-center text-[9px] text-gray-400">
                          No Image
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-800 line-clamp-2 leading-relaxed font-sans">
                          {slide.paragraph.text}
                        </p>
                      </div>
                    </div>

                    {/* Bottom: Linked Word */}
                    <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center justify-between text-[11px] font-mono">
                      <div className="flex items-center gap-1 text-gray-500 truncate">
                        <span>Trigger:</span>
                        {linkedCue ? (
                          <span className="font-semibold text-gray-900 bg-gray-100 px-1.5 py-0.2 rounded border border-gray-200 truncate">
                            &ldquo;{linkedCue.cleanText}&rdquo;
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">Auto</span>
                        )}
                      </div>

                      <div className="text-xs shrink-0">
                        {isSelected ? (
                          <span className="text-red-600 font-semibold flex items-center gap-0.5">
                            Click word &rarr;
                          </span>
                        ) : (
                          <span className="text-gray-400 group-hover:text-gray-700 flex items-center gap-0.5">
                            Select <ChevronRight className="w-3 h-3" />
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* RIGHT COLUMN: TRANSCRIBED WORD STREAM (58% width) */}
          <div className="flex-1 flex flex-col bg-white overflow-hidden">
            
            {/* Search Bar */}
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search spoken words..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1 bg-white border border-gray-200 rounded-md text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-red-500 transition-colors font-mono"
                />
              </div>

              <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
                <span>Total Words: <strong className="text-gray-900">{cues.length}</strong></span>
              </div>
            </div>

            {/* Instruction strip */}
            <div className="px-4 py-1.5 bg-red-50/50 border-b border-red-100 text-[11px] font-mono text-red-700">
              Targeting Slide #{selectedSlideIndex + 1}: Click any word below to anchor this slide&rsquo;s start time.
            </div>

            {/* Word Chips Flow */}
            <div
              ref={wordStreamRef}
              className="flex-1 overflow-y-auto p-4"
            >
              <div className="flex flex-wrap gap-1.5">
                {filteredCues.map((cue) => {
                  const globalIdx = cues.findIndex((c) => c.id === cue.id);
                  const boundSlideIdx = wordIndexToSlideMap.get(globalIdx);
                  const isSlideAnchor = boundSlideIdx !== undefined;

                  const isCurrentSpeech = currentTime >= cue.startTime && currentTime <= cue.endTime;
                  const isAuditioning = auditioningWordId === cue.id;

                  return (
                    <div
                      key={cue.id}
                      onClick={() => handleLinkSlideToWord(selectedSlideIndex, globalIdx)}
                      className={`group relative flex items-center gap-1 px-2 py-1 rounded-md border text-xs font-mono transition-all cursor-pointer ${
                        isSlideAnchor
                          ? 'bg-red-50 border-red-300 text-red-900 font-semibold shadow-2xs'
                          : isCurrentSpeech || isAuditioning
                          ? 'bg-amber-100 border-amber-300 text-gray-900 ring-1 ring-amber-400'
                          : 'bg-gray-50 border-gray-200 hover:border-gray-400 text-gray-700'
                      }`}
                      title={`Click to start Slide #${selectedSlideIndex + 1} from "${cue.cleanText}" (${formatSecondsToTimestamp(cue.startTime)})`}
                    >
                      {isSlideAnchor && (
                        <span className="px-1 py-0.2 rounded text-[9px] font-bold bg-red-600 text-white uppercase">
                          #{boundSlideIdx + 1}
                        </span>
                      )}

                      <span className="font-medium font-sans">
                        {cue.cleanText}
                      </span>

                      <span className="text-[10px] text-gray-400">
                        {formatSecondsToTimestamp(cue.startTime)}
                      </span>

                      <button
                        onClick={(e) => handleAuditionWord(cue, e)}
                        className="p-0.5 rounded text-gray-400 hover:text-gray-900 transition-colors cursor-pointer"
                        title="Listen"
                      >
                        <Volume2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Bottom Footer Info */}
            <div className="flex items-center justify-between px-5 py-2.5 bg-gray-50 border-t border-gray-200 text-xs font-mono text-gray-500">
              <div className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Slides automatically hold until the next slide&rsquo;s anchor.</span>
              </div>
              <button
                onClick={handleApply}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-gray-900 hover:bg-gray-800 text-white font-bold text-xs transition-colors shadow-2xs cursor-pointer"
              >
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>Done &amp; Apply</span>
              </button>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
};
