'use client';

import React, { useState, useRef } from 'react';
import {
  Sliders,
  CheckCircle2,
  Clock,
  ImageIcon,
  Sparkles,
  Play,
  Pause,
  Trash2,
  Film,
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
  motionSettings,
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
      <div className="flex flex-col h-full bg-[#111821] border-l border-[#2B3947] p-4 text-center justify-center text-[#748396] space-y-2 select-none">
        <Sliders className="w-8 h-8 mx-auto text-[#2B3947]" />
        <p className="text-xs font-semibold text-[#A4B1C0]">No Slide Selected</p>
        <p className="text-[11px]">Click any slide card or timeline block to inspect its timing & visual properties</p>
      </div>
    );
  }

  const isConfirmed = slide.isManualEdit || slide.status === 'confirmed';
  const startFrame = Math.round(slide.startTime * 30);
  const endFrame = Math.round(slide.endTime * 30);
  const frameCount = Math.max(1, endFrame - startFrame);

  return (
    <div className="flex flex-col h-full bg-[#111821] border-l border-[#2B3947] text-[#F1F5F9] select-none min-w-0">
      {/* HEADER */}
      <div className="h-10 px-3.5 border-b border-[#2B3947] bg-[#0B0F14]/60 flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-[#F1F5F9]">
            Slide {slideIndex + 1} <span className="text-[#748396] font-normal">of {totalSlides}</span>
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold capitalize ${
              isConfirmed
                ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/40'
                : slide.status === 'needs_review'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-[#202C38] text-[#A4B1C0]'
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
                ? 'bg-[#2DD4BF]/15 text-[#2DD4BF] border border-[#2DD4BF]/30'
                : 'bg-[#18222D] hover:bg-[#202C38] text-[#A4B1C0] border border-[#2B3947]'
            }`}
            title={isConfirmed ? 'Timing confirmed (won\'t be overwritten)' : 'Click to lock timing'}
          >
            {isConfirmed ? <Lock className="w-3 h-3 text-[#2DD4BF]" /> : <Unlock className="w-3 h-3" />}
            <span>{isConfirmed ? 'Locked' : 'Lock'}</span>
          </button>
        )}
      </div>

      {/* INSPECTOR BODY */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-4 min-h-0">
        {/* 1. VISUAL ASSET */}
        <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5 text-[#2DD4BF]" />
              <span>Visual Image</span>
            </span>
            {slide.image && (
              <button
                type="button"
                onClick={() => onUpdateSlideImage(slideIndex, null)}
                className="text-[10px] text-rose-400 hover:text-rose-300 flex items-center gap-1 transition cursor-pointer"
                title="Remove assigned image"
              >
                <Trash2 className="w-3 h-3" />
                <span>Clear</span>
              </button>
            )}
          </div>

          <div className="relative aspect-video rounded-lg overflow-hidden border border-[#2B3947] bg-[#0B0F14] flex items-center justify-center">
            {slide.image ? (
              <>
                <img src={slide.image.previewUrl} alt={slide.image.name} className="w-full h-full object-cover" />
                <span className="absolute bottom-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[9px] truncate max-w-[85%]">
                  {slide.image.name}
                </span>
              </>
            ) : (
              <div className="text-center p-3 text-amber-400 space-y-1">
                <AlertTriangle className="w-5 h-5 mx-auto opacity-70" />
                <p className="text-[11px] font-semibold">Missing Image</p>
                <p className="text-[10px] text-[#748396]">Click an image in the Visuals tab to assign</p>
              </div>
            )}
          </div>

          {slide.semanticMatchReason && (
            <p className="text-[10px] text-[#2DD4BF] bg-[#2DD4BF]/10 px-2 py-1 rounded font-mono">
              ✓ {slide.semanticMatchReason}
            </p>
          )}
        </div>

        {/* 2. PRECISE BOUNDARY TIMING */}
        <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#2DD4BF]" />
              <span>Boundary Timing</span>
            </span>
            <span className="text-[10px] font-mono text-[#A4B1C0]">
              {frameCount} frames (30fps)
            </span>
          </div>

          {/* Start Time */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#A4B1C0] text-[11px]">Start:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, Math.max(0, slide.startTime - 0.1), slide.endTime)}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
                title="-0.1s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-[#F1F5F9] bg-[#0B0F14] px-1 py-1 rounded border border-[#2B3947]">
                {slide.startTime.toFixed(3)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime + 0.1, slide.endTime)}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
                title="+0.1s"
              >
                +
              </button>
            </div>
          </div>

          {/* End Time */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#A4B1C0] text-[11px]">End:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime, Math.max(slide.startTime + 0.2, slide.endTime - 0.1))}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
                title="-0.1s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-[#F1F5F9] bg-[#0B0F14] px-1 py-1 rounded border border-[#2B3947]">
                {slide.endTime.toFixed(3)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideTiming(slideIndex, slide.startTime, slide.endTime + 0.1)}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
                title="+0.1s"
              >
                +
              </button>
            </div>
          </div>

          {/* Duration */}
          <div className="flex items-center justify-between text-xs pt-1 border-t border-[#2B3947]/70">
            <span className="text-[#A4B1C0] text-[11px] font-semibold">Duration:</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateSlideDuration(slideIndex, Math.max(0.2, slide.duration - 0.5))}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
                title="-0.5s"
              >
                -
              </button>
              <span className="w-20 text-center font-mono text-xs font-bold text-[#2DD4BF] bg-[#0B0F14] px-1 py-1 rounded border border-[#2B3947]">
                {slide.duration.toFixed(2)}s
              </span>
              <button
                type="button"
                onClick={() => onUpdateSlideDuration(slideIndex, slide.duration + 0.5)}
                className="w-6 h-6 rounded bg-[#202C38] hover:bg-[#2B3947] text-[#F1F5F9] text-xs font-bold flex items-center justify-center font-mono cursor-pointer"
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
              className={`w-full py-2 rounded-lg font-mono text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer shadow-sm ${
                isPlayingAudio
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50 animate-pulse'
                  : 'bg-[#202C38] hover:bg-[#2B3947] text-[#2DD4BF] border border-[#2B3947]'
              }`}
            >
              {isPlayingAudio ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
              <span>{isPlayingAudio ? 'Playing Slide Speech...' : 'Hear Slide Speech Audio'}</span>
            </button>
          )}
        </div>

        {/* 3. MOTION FX */}
        <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-2.5">
          <span className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#2DD4BF]" />
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
                    ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/40 font-bold'
                    : 'bg-[#202C38] text-[#A4B1C0] hover:text-[#F1F5F9]'
                }`}
              >
                Zoom {dir}
              </button>
            ))}
          </div>
        </div>

        {/* 4. SCRIPT TEXT SNIPPET */}
        <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-1.5">
          <span className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
            <FileText className="w-3.5 h-3.5 text-[#2DD4BF]" />
            <span>Script Passage</span>
          </span>
          <p className="text-xs text-[#A4B1C0] leading-relaxed font-sans bg-[#0B0F14] p-2 rounded-lg border border-[#2B3947]">
            {slide.paragraph?.text || slide.searchPhrase}
          </p>
        </div>

        {/* 5. LINKED SUBTITLE CUES */}
        {slide.matchedCue && (
          <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-1.5">
            <span className="text-xs font-bold text-[#F1F5F9] flex items-center gap-1.5">
              <Subtitles className="w-3.5 h-3.5 text-[#2DD4BF]" />
              <span>Linked Subtitle Cue</span>
            </span>
            <div className="text-[11px] text-[#A4B1C0] font-mono bg-[#0B0F14] p-2 rounded-lg border border-[#2B3947] space-y-1">
              <div className="text-[10px] text-[#2DD4BF]">
                {formatSecondsToTimestamp(slide.matchedCue.startTime)} → {formatSecondsToTimestamp(slide.matchedCue.endTime)}
              </div>
              <p className="text-xs font-sans text-[#F1F5F9]">{slide.matchedCue.text}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
