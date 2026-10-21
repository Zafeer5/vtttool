'use client';

import React, { useState, useEffect } from 'react';
import { SyncMatch } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';
import {
  X,
  Play,
  Pause,
  Clock,
  Check,
  RotateCcw,
  Sparkles,
  Sliders,
  ArrowRight,
  ImageIcon,
} from 'lucide-react';

interface AdjustSlideModalProps {
  isOpen: boolean;
  slideIndex: number;
  matches: SyncMatch[];
  audioElement: HTMLAudioElement | null;
  onClose: () => void;
  onSave: (updatedMatches: SyncMatch[]) => void;
}

export const AdjustSlideModal: React.FC<AdjustSlideModalProps> = ({
  isOpen,
  slideIndex,
  matches,
  audioElement,
  onClose,
  onSave,
}) => {
  const currentMatch = matches[slideIndex];

  const [startTime, setStartTime] = useState<number>(currentMatch?.startTime ?? 0);
  const [endTime, setEndTime] = useState<number>(currentMatch?.endTime ?? 5);
  const [keepContiguous, setKeepContiguous] = useState<boolean>(true);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playheadTime, setPlayheadTime] = useState<number>(0);

  useEffect(() => {
    if (currentMatch) {
      setStartTime(currentMatch.startTime);
      setEndTime(currentMatch.endTime);
    }
  }, [currentMatch, slideIndex]);

  useEffect(() => {
    if (!audioElement) return;

    let targetEnd: number | null = null;

    if (isPlaying) {
      audioElement.currentTime = startTime;
      targetEnd = endTime;
      audioElement.play().catch(() => setIsPlaying(false));
    } else {
      audioElement.pause();
    }

    const handleTimeUpdate = () => {
      setPlayheadTime(audioElement.currentTime);
      if (targetEnd !== null && audioElement.currentTime >= targetEnd) {
        audioElement.pause();
        setIsPlaying(false);
      }
    };

    audioElement.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      audioElement.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [isPlaying, startTime, endTime, audioElement]);

  if (!isOpen || !currentMatch) return null;

  const duration = Math.max(0.1, Number((endTime - startTime).toFixed(3)));

  const handleNudgeStart = (delta: number) => {
    const minStart = slideIndex > 0 ? (matches[slideIndex - 1]?.startTime ?? 0) + 0.1 : 0;
    const newStart = Math.max(minStart, Math.min(endTime - 0.2, Number((startTime + delta).toFixed(3))));
    setStartTime(newStart);
  };

  const handleNudgeEnd = (delta: number) => {
    const nextLimit = slideIndex < matches.length - 1 ? (matches[slideIndex + 1]?.endTime ?? 9999) - 0.1 : 9999;
    const newEnd = Math.max(startTime + 0.2, Math.min(nextLimit, Number((endTime + delta).toFixed(3))));
    setEndTime(newEnd);
  };

  const handleSnapStartToAudio = () => {
    if (!audioElement) return;
    const t = Number(audioElement.currentTime.toFixed(3));
    if (t < endTime - 0.2) {
      setStartTime(t);
    }
  };

  const handleSnapEndToAudio = () => {
    if (!audioElement) return;
    const t = Number(audioElement.currentTime.toFixed(3));
    if (t > startTime + 0.2) {
      setEndTime(t);
    }
  };

  const handleSave = () => {
    const updated = [...matches];

    // Update current slide
    updated[slideIndex] = {
      ...currentMatch,
      startTime,
      endTime,
      duration,
      confidence: 'exact',
      confidenceScore: 100,
      status: 'exact',
      warning: undefined,
    };

    // If keepContiguous is checked, preserve unbroken continuous timeline
    if (keepContiguous) {
      if (slideIndex > 0 && updated[slideIndex - 1]) {
        updated[slideIndex - 1] = {
          ...updated[slideIndex - 1],
          endTime: startTime,
          duration: Number((startTime - updated[slideIndex - 1].startTime).toFixed(3)),
        };
      }
      if (slideIndex < updated.length - 1 && updated[slideIndex + 1]) {
        updated[slideIndex + 1] = {
          ...updated[slideIndex + 1],
          startTime: endTime,
          duration: Number((updated[slideIndex + 1].endTime - endTime).toFixed(3)),
        };
      }
    }

    onSave(updated);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs font-mono">
      <div className="relative w-full max-w-2xl rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden animate-fadeIn">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/80">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                Fine-Tune Timing • Slide #{slideIndex + 1}
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                  1-Click Adjust
                </span>
              </h3>
              <p className="text-[11px] text-gray-500 font-sans">
                Adjust precise paragraph entry/exit boundaries with zero gaps
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-5">
          {/* Slide & Thumbnail info */}
          <div className="flex items-start gap-4 p-3 rounded-xl bg-gray-50 border border-gray-200">
            <div className="relative aspect-video w-32 rounded-lg bg-gray-900 border border-gray-200 shrink-0 overflow-hidden flex items-center justify-center shadow-xs">
              {currentMatch.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentMatch.image.previewUrl}
                  alt={currentMatch.image.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="flex flex-col items-center gap-1 text-gray-400">
                  <ImageIcon className="w-5 h-5" />
                  <span className="text-[9px]">No Image</span>
                </div>
              )}
              <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-bold text-white border border-white/10">
                #{slideIndex + 1}
              </span>
            </div>

            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-gray-900">
                  {currentMatch.image ? currentMatch.image.name : 'Missing Visual Asset'}
                </span>
              </div>
              <p className="text-xs text-gray-700 leading-relaxed line-clamp-3">
                {currentMatch.paragraph.text}
              </p>
              <div className="text-[11px] text-gray-500 flex items-center gap-1.5">
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">
                  Anchor Words:
                </span>
                <span className="italic">
                  &ldquo;{currentMatch.searchPhrase || currentMatch.triggerSentence}&rdquo;
                </span>
              </div>
            </div>
          </div>

          {/* Quick Audition Player */}
          {audioElement && (
            <div className="flex items-center justify-between p-3 rounded-xl bg-gray-900 text-white shadow-inner">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="p-2.5 rounded-full bg-red-600 hover:bg-red-500 text-white shadow-md transition-all active:scale-95"
                >
                  {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                </button>
                <div className="space-y-0.5">
                  <span className="text-xs font-bold block">
                    {isPlaying ? 'Auditioning Segment...' : 'Audition Audio Segment'}
                  </span>
                  <span className="text-[10px] text-gray-400 block">
                    Playhead: {formatSecondsToTimestamp(playheadTime)} • Range: {formatSecondsToTimestamp(startTime)} &rarr; {formatSecondsToTimestamp(endTime)}
                  </span>
                </div>
              </div>

              <div className="text-xs font-bold px-3 py-1 rounded-lg bg-white/10 border border-white/10">
                Duration: {duration.toFixed(2)}s
              </div>
            </div>
          )}

          {/* Timing Adjusters Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Start Time Column */}
            <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-blue-500" />
                  Start Timestamp (T<sub>in</sub>)
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                  {formatSecondsToTimestamp(startTime)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.05"
                  value={startTime}
                  onChange={(e) => setStartTime(Math.max(0, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Nudge Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeStart(-0.5)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  -0.5s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeStart(-0.1)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  -0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeStart(0.1)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  +0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeStart(0.5)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  +0.5s
                </button>
              </div>

              {audioElement && (
                <button
                  type="button"
                  onClick={handleSnapStartToAudio}
                  className="w-full py-1.5 px-2 text-[11px] font-bold rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 transition-colors flex items-center justify-center gap-1"
                >
                  <span>📍 Snap Start to Audio Time ({playheadTime.toFixed(2)}s)</span>
                </button>
              )}
            </div>

            {/* End Time Column */}
            <div className="p-4 rounded-xl border border-gray-200 bg-white space-y-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-gray-700 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-purple-500" />
                  End Timestamp (T<sub>out</sub>)
                </span>
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 border border-purple-200">
                  {formatSecondsToTimestamp(endTime)}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.05"
                  value={endTime}
                  onChange={(e) => setEndTime(Math.max(startTime + 0.1, Number(e.target.value)))}
                  className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
                />
              </div>

              {/* Nudge Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(-0.5)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  -0.5s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(-0.1)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  -0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(0.1)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  +0.1s
                </button>
                <button
                  type="button"
                  onClick={() => handleNudgeEnd(0.5)}
                  className="flex-1 py-1 text-[11px] font-bold rounded bg-gray-100 hover:bg-gray-200 text-gray-700 transition-colors"
                >
                  +0.5s
                </button>
              </div>

              {audioElement && (
                <button
                  type="button"
                  onClick={handleSnapEndToAudio}
                  className="w-full py-1.5 px-2 text-[11px] font-bold rounded-lg bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200 transition-colors flex items-center justify-center gap-1"
                >
                  <span>📍 Snap End to Audio Time ({playheadTime.toFixed(2)}s)</span>
                </button>
              )}
            </div>
          </div>

          {/* Continuous Timeline Lock Checkbox */}
          <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={keepContiguous}
              onChange={(e) => setKeepContiguous(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>
              <strong>Continuous video timeline:</strong> Automatically sync adjacent slide boundaries so there are zero black-screen gaps.
            </span>
          </label>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-gray-100 bg-gray-50/80">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="flex items-center gap-1.5 px-5 py-2 text-xs font-bold rounded-lg bg-gray-900 hover:bg-gray-800 text-white shadow-sm transition-all"
          >
            <Check className="w-4 h-4 text-emerald-400" />
            <span>Apply &amp; Update Timeline</span>
          </button>
        </div>
      </div>
    </div>
  );
};
