'use client';

import React, { useState, useRef } from 'react';
import {
  Sliders,
  Clock,
  ImageIcon,
  Sparkles,
  Play,
  Pause,
  Trash2,
  Subtitles,
  FileText,
  AlertTriangle,
  Lock,
  Unlock,
} from 'lucide-react';
import { SyncMatch, ImageItem, MotionSettings, ZoomDirection } from '@/lib/types';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';

interface SlideInspectorProps {
  slide: SyncMatch | null;
  slideIndex: number;
  totalSlides: number;
  voiceoverUrl?: string | null;
  motionSettings: MotionSettings;
  onUpdateSlideTiming: (index: number, newStart: number, newEnd: number) => void;
  onUpdateSlideDuration: (index: number, newDuration: number) => void;
  onUpdateSlideImage: (index: number, image: ImageItem | null) => void;
  onUpdateSlideZoomDirection?: (index: number, dir: Exclude<ZoomDirection, 'random'>) => void;
  onConfirmSlideTiming?: (index: number) => void;
}

export const SlideInspector: React.FC<SlideInspectorProps> = ({
  slide,
  slideIndex,
  totalSlides,
  voiceoverUrl,
  motionSettings: _motionSettings,
  onUpdateSlideTiming,
  onUpdateSlideDuration,
  onUpdateSlideImage,
  onUpdateSlideZoomDirection,
  onConfirmSlideTiming,
}) => {
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const slideAudioRef = useRef<HTMLAudioElement | null>(null);

  // Play slide speech slice
  const handleToggleAudio = () => {
    if (!voiceoverUrl || !slide) return;

    if (isPlayingAudio) {
      if (slideAudioRef.current) slideAudioRef.current.pause();
      setIsPlayingAudio(false);
      return;
    }

    if (!slideAudioRef.current) {
      slideAudioRef.current = new Audio(voiceoverUrl);
    } else if (slideAudioRef.current.src !== voiceoverUrl) {
      slideAudioRef.current.src = voiceoverUrl;
    }

    const audio = slideAudioRef.current;
    audio.currentTime = slide.startTime;
    audio.play().catch(() => {});
    setIsPlayingAudio(true);

    const onTimeUpdate = () => {
      if (audio.currentTime >= slide.endTime || audio.paused) {
        audio.pause();
        setIsPlayingAudio(false);
        audio.removeEventListener('timeupdate', onTimeUpdate);
      }
    };
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.onended = () => setIsPlayingAudio(false);
  };

  if (!slide) {
    return (
      <div className="flex flex-col h-full bg-white border-l border-slate-200 p-4 text-center justify-center text-slate-500 space-y-2 select-none">
        <Sliders className="w-8 h-8 mx-auto text-slate-300" />
        <p className="text-xs font-semibold text-slate-700">No Slide Selected</p>
        <p className="text-[11px] text-slate-400">Click any slide card or timeline block to inspect its timing &amp; visual properties</p>
      </div>
    );
  }

  const isConfirmed = slide.isManualEdit || slide.status === 'confirmed';
  const startFrame = Math.round(slide.startTime * 30);
  const endFrame = Math.round(slide.endTime * 30);
  const frameCount = Math.max(1, endFrame - startFrame);

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 text-slate-900 select-none min-w-0">
      {/* HEADER */}
      <div className="h-10 px-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-900">
            Slide {slideIndex + 1} <span className="text-slate-400 font-normal">of {totalSlides}</span>
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold capitalize ${
              isConfirmed
                ? 'bg-orange-50 text-orange-700 border border-orange-200'
                : slide.status === 'needs_review'
                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                : 'bg-slate-100 text-slate-600'
            }`}
          >
            {isConfirmed ? 'Confirmed' : slide.status || 'Auto'}
          </span>
        </div>

        {/* Lock / Confirm Toggle */}
        {onConfirmSlideTiming && (
          <button
            type="button"
            onClick={() => onConfirmSlideTiming(slideIndex)}
            className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition cursor-pointer ${
              isConfirmed
                ? 'bg-orange-50 text-orange-700 border border-orange-200'
                : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200'
            }`}
            title={isConfirmed ? "Timing confirmed (won't be overwritten)" : 'Click to lock timing'}
          >
            {isConfirmed ? <Lock className="w-3 h-3 text-orange-600" /> : <Unlock className="w-3 h-3" />}
            <span>{isConfirmed ? 'Locked' : 'Lock'}</span>
          </button>
        )}
      </div>

      {/* INSPECTOR BODY */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 min-h-0 bg-white">
        {/* 1. VISUAL ASSET */}
        <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-orange-600" />
              <span>Visual Image</span>
            </span>
            {slide.image && (
              <button
                type="button"
                onClick={() => onUpdateSlideImage(slideIndex, null)}
                className="text-[10px] text-rose-600 hover:text-rose-700 flex items-center gap-1 transition cursor-pointer font-medium"
                title="Remove assigned image"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-200 bg-slate-100 flex items-center justify-center">
            {slide.image ? (
              <>
                <img src={slide.image.previewUrl} alt={slide.image.name} className="w-full h-full object-cover" />
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[9px] truncate max-w-[85%]">
                  {slide.image.name}
                </span>
              </>
            ) : (
              <div className="text-center p-3 text-amber-600 space-y-1">
                <AlertTriangle className="w-5 h-5 mx-auto opacity-70" />
                <p className="text-[11px] font-semibold">Missing Image</p>
                <p className="text-[10px] text-slate-400">Click &quot;Media &amp; Assets&quot; to assign</p>
              </div>
            )}
          </div>

          {slide.semanticMatchReason && (
            <p className="text-[10px] text-orange-700 bg-orange-50 border border-orange-200 px-2 py-1 rounded font-mono">
              ✓ {slide.semanticMatchReason}
            </p>
          )}
        </div>

        {/* 2. PRECISE BOUNDARY TIMING */}
        <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-orange-600" />
              <span>Boundary Timing</span>
            </span>
            <span className="text-[10px] font-mono text-slate-500">
              {frameCount} frames (30fps)
            </span>
          </div>

          {/* Start Time */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 text-[11px] font-medium">Start:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, Math.max(0, slide.startTime - 0.1), slide.endTime)}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="-0.1s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-slate-900 bg-white px-1 py-1 rounded border border-slate-200 shadow-2xs">
                {slide.startTime.toFixed(3)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime + 0.1, slide.endTime)}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="+0.1s"
              >
                +
              </button>
            </div>
          </div>

          {/* End Time */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500 text-[11px] font-medium">End:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime, Math.max(slide.startTime + 0.2, slide.endTime - 0.1))}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="-0.1s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-slate-900 bg-white px-1 py-1 rounded border border-slate-200 shadow-2xs">
                {slide.endTime.toFixed(3)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime, slide.endTime + 0.1)}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="+0.1s"
              >
                +
              </button>
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-200">
            <span className="text-slate-600 text-[11px] font-semibold">Duration:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideDuration(slideIndex, Math.max(0.2, slide.duration - 0.5))}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="-0.5s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-orange-600 bg-white px-1 py-1 rounded border border-orange-200 shadow-2xs">
                {slide.duration.toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideDuration(slideIndex, slide.duration + 0.5)}
                className="w-6 h-6 rounded bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-bold flex items-center justify-center font-mono cursor-pointer shadow-2xs"
                title="+0.5s"
              >
                +
              </button>
            </div>
          </div>

          {/* Hear Slide Audio Audition Button */}
          {voiceoverUrl && (
            <button
              type="button"
              onClick={handleToggleAudio}
              className={`w-full py-2 rounded-lg font-mono text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-2xs ${
                isPlayingAudio
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-300 animate-pulse'
                  : 'bg-white hover:bg-orange-50 text-orange-700 border border-slate-200 hover:border-orange-200'
              }`}
            >
              {isPlayingAudio ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlayingAudio ? 'Playing Slide Speech...' : 'Hear Slide Speech Audio'}</span>
            </button>
          )}
        </div>

        {/* 3. MOTION FX */}
        <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-2.5">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-orange-600" />
            <span>Motion FX (Ken Burns)</span>
          </span>

          <div className="grid grid-cols-2 gap-1.5">
            {(['in', 'out'] as Exclude<ZoomDirection, 'random'>[]).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => onUpdateSlideZoomDirection?.(slideIndex, dir)}
                className={`py-1.5 rounded-md text-xs font-mono capitalize transition cursor-pointer ${
                  slide.zoomDirection === dir
                    ? 'bg-orange-600 text-white font-bold shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                Zoom {dir}
              </button>
            ))}
          </div>
        </div>

        {/* 4. SCRIPT TEXT SNIPPET */}
        <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-1.5">
          <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-orange-600" />
            <span>Script Passage</span>
          </span>
          <p className="text-xs text-slate-700 leading-relaxed font-sans bg-white p-2.5 rounded-lg border border-slate-200">
            {slide.paragraph?.text || slide.searchPhrase}
          </p>
        </div>

        {/* 5. LINKED SUBTITLE CUES */}
        {slide.matchedCue && (
          <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-1.5">
            <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
              <Subtitles className="w-3.5 h-3.5 text-orange-600" />
              <span>Linked Subtitle Cue</span>
            </span>
            <div className="text-[11px] text-slate-700 font-mono bg-white p-2.5 rounded-lg border border-slate-200 space-y-1">
              <div className="text-[10px] text-orange-600 font-bold">
                {formatSecondsToTimestamp(slide.matchedCue.startTime)} → {formatSecondsToTimestamp(slide.matchedCue.endTime)}
              </div>
              <p className="text-xs font-sans text-slate-800">{slide.matchedCue.text}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
