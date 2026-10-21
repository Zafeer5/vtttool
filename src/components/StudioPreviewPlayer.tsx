'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Maximize2,
  RotateCcw,
  Film,
  Sparkles,
} from 'lucide-react';
import { SyncMatch, VttCue, MotionSettings } from '@/lib/types';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';
import { VideoResolution } from '@/lib/image-helper';

interface StudioPreviewPlayerProps {
  matches: SyncMatch[];
  cues: VttCue[];
  totalDuration: number;
  voiceoverUrl?: string | null;
  selectedResolution: VideoResolution;
  onResolutionChange: (res: VideoResolution) => void;
  motionSettings: MotionSettings;
  activeSlideIndex: number;
  onSelectSlide: (index: number) => void;
  currentTime: number;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
}

export const StudioPreviewPlayer: React.FC<StudioPreviewPlayerProps> = ({
  matches,
  cues,
  totalDuration,
  voiceoverUrl,
  selectedResolution,
  onResolutionChange,
  motionSettings,
  activeSlideIndex,
  onSelectSlide,
  currentTime,
  onSeek,
  isPlaying,
  onTogglePlay,
}) => {
  const [isMuted, setIsMuted] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Sync audio element with currentTime & isPlaying
  useEffect(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(() => {});
    } else {
      audioRef.current.pause();
    }
  }, [isPlaying]);

  useEffect(() => {
    if (!audioRef.current) return;
    if (Math.abs(audioRef.current.currentTime - currentTime) > 0.3) {
      audioRef.current.currentTime = currentTime;
    }
  }, [currentTime]);

  // Find active slide based on currentTime
  const currentSlide = useMemo(() => {
    if (matches.length === 0) return null;
    const found = matches.find((m) => currentTime >= m.startTime && currentTime < m.endTime);
    return found || matches[matches.length - 1];
  }, [matches, currentTime]);

  // Find active subtitle cue based on currentTime
  const currentCue = useMemo(() => {
    if (cues.length === 0) return null;
    return cues.find((c) => currentTime >= c.startTime && currentTime <= c.endTime) || null;
  }, [cues, currentTime]);

  // Calculate Ken Burns Zoom Transform
  const kenBurnsTransform = useMemo(() => {
    if (!motionSettings.enabled && !motionSettings.zoomEnabled) {
      return 'scale(1)';
    }
    if (!currentSlide || currentSlide.duration <= 0) return 'scale(1)';

    const progress = Math.min(1, Math.max(0, (currentTime - currentSlide.startTime) / currentSlide.duration));
    const intensity = (motionSettings.zoomIntensity || 2) / 100;

    const direction = currentSlide.zoomDirection || (currentSlide.index % 2 === 0 ? 'in' : 'out');

    if (direction === 'in') {
      const scale = 1.0 + progress * intensity;
      return `scale(${scale.toFixed(4)})`;
    } else {
      const scale = 1.0 + intensity - progress * intensity;
      return `scale(${scale.toFixed(4)})`;
    }
  }, [currentSlide, currentTime, motionSettings]);

  // Frame calculation at 30 fps
  const currentFrame = Math.round(currentTime * 30);
  const totalFrames = Math.round((totalDuration || 1) * 30);

  return (
    <div className="flex flex-col h-full bg-[#0B0F14] text-[#F1F5F9] select-none min-w-0">
      {/* Hidden audio element for synchronous playback */}
      {voiceoverUrl && (
        <audio
          ref={audioRef}
          src={voiceoverUrl}
          muted={isMuted}
          onTimeUpdate={() => {
            if (audioRef.current && isPlaying) {
              onSeek(audioRef.current.currentTime);
            }
          }}
          onEnded={() => onTogglePlay()}
        />
      )}

      {/* TOP BAR: ACTIVE SLIDE SNIPPET & RESOLUTION */}
      <div className="h-9 px-3 border-b border-[#2B3947] bg-[#111821] flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="px-2 py-0.5 rounded bg-[#2DD4BF]/15 text-[#2DD4BF] font-mono text-[10px] font-bold shrink-0">
            Slide {currentSlide ? currentSlide.index + 1 : 1} of {matches.length || 1}
          </span>
          <p className="text-xs text-[#A4B1C0] truncate font-sans">
            {currentSlide?.paragraph?.text || currentSlide?.searchPhrase || 'Studio Preview'}
          </p>
        </div>

        {/* Resolution Selector */}
        <div className="flex items-center gap-1.5 shrink-0">
          <select
            value={selectedResolution}
            onChange={(e) => onResolutionChange(e.target.value as VideoResolution)}
            className="px-2 py-0.5 rounded bg-[#18222D] border border-[#2B3947] text-[10px] font-mono font-semibold text-[#F1F5F9] outline-none cursor-pointer"
          >
            <option value="720p">720p HD</option>
            <option value="1080p">1080p Full HD</option>
            <option value="4k">4K Ultra HD</option>
          </select>
        </div>
      </div>

      {/* CENTER: 16:9 VIDEO CANVAS */}
      <div className="flex-1 min-h-0 p-3 flex items-center justify-center bg-[#0B0F14] overflow-hidden relative">
        <div className="w-full max-w-4xl aspect-video rounded-xl overflow-hidden border border-[#2B3947] bg-[#111821] relative shadow-2xl flex items-center justify-center">
          {currentSlide && currentSlide.image ? (
            <div className="w-full h-full overflow-hidden flex items-center justify-center">
              <img
                src={currentSlide.image.previewUrl}
                alt={currentSlide.image.name}
                style={{
                  transform: kenBurnsTransform,
                  transition: 'transform 80ms linear',
                }}
                className="w-full h-full object-cover select-none"
              />
            </div>
          ) : (
            <div className="text-center p-6 text-[#748396] space-y-2">
              <Film className="w-10 h-10 mx-auto text-[#2B3947]" />
              <p className="text-xs font-semibold text-[#A4B1C0]">No Visual Image Assigned</p>
              <p className="text-[10px]">Select an image from the Visuals tab on the left</p>
            </div>
          )}

          {/* Subtitle Cue Overlay (Bottom) */}
          {currentCue && currentCue.text && (
            <div className="absolute bottom-4 left-6 right-6 text-center pointer-events-none">
              <span className="inline-block px-3 py-1.5 rounded-lg bg-black/85 text-white font-sans text-xs sm:text-sm font-semibold tracking-wide shadow-lg border border-white/10 backdrop-blur-sm max-w-xl">
                {currentCue.text}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM PLAYBACK CONTROLS BAR */}
      <div className="border-t border-[#2B3947] bg-[#111821] px-4 py-2 space-y-2 shrink-0">
        {/* Scrub Bar */}
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={0}
            max={totalDuration || 1}
            step={0.05}
            value={currentTime}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="w-full accent-[#2DD4BF] cursor-pointer h-1.5 bg-[#202C38] rounded-lg"
          />
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center justify-between gap-3">
          {/* Left: Playback Buttons */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (activeSlideIndex > 0) {
                  const prev = matches[activeSlideIndex - 1];
                  onSelectSlide(activeSlideIndex - 1);
                  if (prev) onSeek(prev.startTime);
                }
              }}
              disabled={activeSlideIndex <= 0}
              className="p-1.5 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#18222D] transition disabled:opacity-30 cursor-pointer"
              title="Previous Slide ([)"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              className="p-2 rounded-lg bg-[#2DD4BF] hover:bg-[#5EEAD4] text-[#0B0F14] transition shadow-md cursor-pointer"
              title="Play / Pause (Space)"
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-[#0B0F14]" /> : <Play className="w-4 h-4 fill-[#0B0F14]" />}
            </button>

            <button
              type="button"
              onClick={() => {
                if (activeSlideIndex < matches.length - 1) {
                  const next = matches[activeSlideIndex + 1];
                  onSelectSlide(activeSlideIndex + 1);
                  if (next) onSeek(next.startTime);
                }
              }}
              disabled={activeSlideIndex >= matches.length - 1}
              className="p-1.5 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#18222D] transition disabled:opacity-30 cursor-pointer"
              title="Next Slide (])"
            >
              <SkipForward className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => onSeek(0)}
              className="p-1.5 rounded text-[#748396] hover:text-[#A4B1C0] hover:bg-[#18222D] transition cursor-pointer"
              title="Reset to beginning"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Center: High-Contrast Timecode */}
          <div className="flex items-center gap-2 font-mono">
            <span className="text-xs font-bold text-[#F1F5F9]">
              {formatSecondsToTimestamp(currentTime, true)}
            </span>
            <span className="text-xs text-[#748396]">/</span>
            <span className="text-xs text-[#A4B1C0]">
              {formatSecondsToTimestamp(totalDuration, true)}
            </span>
            <span className="text-[10px] text-[#748396] ml-2 hidden sm:inline">
              (F: {currentFrame}/{totalFrames})
            </span>
          </div>

          {/* Right: Audio Volume */}
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setIsMuted(!isMuted)}
              className="p-1.5 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#18222D] transition cursor-pointer"
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
