'use client';

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  Download,
  Play,
  Pause,
  RotateCcw,
  Film,
  CheckCircle2,
  Sparkles,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  SkipBack,
  SkipForward,
  FastForward,
  Layers,
  ChevronLeft,
  ChevronRight,
  Info,
  Archive,
  FolderArchive,
  FileVideo,
} from 'lucide-react';
import { SyncMatch, ExportMode } from '../lib/types';

interface VideoPreviewPlayerProps {
  videoBlob: Blob | null;
  videoUrl: string | null;
  videoDuration: number;
  totalSlides: number;
  matches?: SyncMatch[];
  resolution?: string;
  outputFileName?: string;
  exportMode?: ExportMode;
  onReset?: () => void;
}

const SPEED_OPTIONS = [0.75, 1.0, 1.25, 1.5, 2.0];

export const VideoPreviewPlayer: React.FC<VideoPreviewPlayerProps> = ({
  videoBlob,
  videoUrl,
  videoDuration,
  totalSlides,
  matches = [],
  resolution = '1080p',
  outputFileName,
  exportMode = 'single',
  onReset,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(videoDuration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPosition, setHoverPosition] = useState<number>(0);

  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!videoUrl || !videoBlob) {
    return null;
  }

  // Format MM:SS or HH:MM:SS
  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) secs = 0;
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m}:${s < 10 ? '0' : ''}${s}.${ms}`;
  };

  // Find active slide based on current video time
  const currentSlideIndex = useMemo(() => {
    if (!matches || matches.length === 0) return 0;
    const idx = matches.findIndex(
      (m) => currentTime >= m.startTime && currentTime <= m.endTime
    );
    return idx !== -1 ? idx : Math.min(Math.floor((currentTime / (duration || 1)) * totalSlides), totalSlides - 1);
  }, [matches, currentTime, duration, totalSlides]);

  const activeSlide = matches[currentSlideIndex] || null;

  // Sync duration once video metadata loads
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const vidDur = videoRef.current.duration;
      if (vidDur && !isNaN(vidDur) && isFinite(vidDur)) {
        setDuration(vidDur);
      }
    }
  };

  const handlePlayPause = useCallback(() => {
    if (!videoRef.current) return;
    if (videoRef.current.paused) {
      videoRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      videoRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const handleTimeUpdate = () => {
    if (videoRef.current && !isScrubbing) {
      setCurrentTime(videoRef.current.currentTime);
    }
  };

  const handleSeek = (targetTime: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(duration, targetTime));
    videoRef.current.currentTime = clamped;
    setCurrentTime(clamped);
  };

  const handleSkip = (deltaSeconds: number) => {
    if (!videoRef.current) return;
    handleSeek(videoRef.current.currentTime + deltaSeconds);
  };

  const handleJumpToSlide = (slideIdx: number) => {
    if (!matches || matches.length === 0) return;
    const targetIdx = Math.max(0, Math.min(matches.length - 1, slideIdx));
    const targetMatch = matches[targetIdx];
    if (targetMatch) {
      handleSeek(targetMatch.startTime);
    }
  };

  const handleVolumeChange = (newVol: number) => {
    if (!videoRef.current) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    videoRef.current.volume = clamped;
    setVolume(clamped);
    if (clamped > 0 && isMuted) {
      videoRef.current.muted = false;
      setIsMuted(false);
    }
  };

  const handleToggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    videoRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const handleRateChange = (rate: number) => {
    if (!videoRef.current) return;
    videoRef.current.playbackRate = rate;
    setPlaybackRate(rate);
  };

  const handleToggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Keyboard accessibility
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Avoid intercepting if typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        handlePlayPause();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        handleSkip(-5);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        handleSkip(5);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        handleVolumeChange(volume + 0.1);
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        handleVolumeChange(volume - 0.1);
      } else if (e.key === 'm' || e.key === 'M') {
        e.preventDefault();
        handleToggleMute();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        handleToggleFullscreen();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePlayPause, volume, isMuted]);

  // Scrub bar interaction
  const getProgressFromEvent = (e: React.MouseEvent<HTMLDivElement> | MouseEvent) => {
    if (!progressBarRef.current) return 0;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    return pos;
  };

  const handleProgressMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsScrubbing(true);
    const progress = getProgressFromEvent(e);
    handleSeek(progress * duration);

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const p = getProgressFromEvent(moveEvent);
      handleSeek(p * duration);
    };

    const handleMouseUp = () => {
      setIsScrubbing(false);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleProgressMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setHoverPosition(pos * 100);
    setHoverTime(pos * duration);
  };

  const handleProgressMouseLeave = () => {
    setHoverTime(null);
  };

  // Auto-hide controls when playing and mouse is idle
  const handleMouseMoveContainer = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
      }, 2500);
    }
  };

  const isZipOutput =
    exportMode === 'clips_zip' ||
    videoBlob.type === 'application/zip' ||
    (outputFileName ? outputFileName.trim().toLowerCase().endsWith('.zip') : false);

  const handleDownload = () => {
    const fileExt = isZipOutput ? '.zip' : '.mp4';
    const defaultName = isZipOutput
      ? `SlideSync_Clips_${Date.now()}.zip`
      : `SlideSync_${resolution}_${Date.now()}.mp4`;
    const cleanName = outputFileName?.trim()
      ? (outputFileName.trim().toLowerCase().endsWith(fileExt)
          ? outputFileName.trim()
          : `${outputFileName.trim().replace(/\.(mp4|zip)$/i, '')}${fileExt}`)
      : defaultName;

    const a = document.createElement('a');
    let href = videoUrl;
    if (href.startsWith('/api/renders/')) {
      href = `${href}${href.includes('?') ? '&' : '?'}download=1&filename=${encodeURIComponent(cleanName)}`;
    }
    a.href = href;
    a.download = cleanName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;
  const fileSizeMb = (videoBlob.size / (1024 * 1024)).toFixed(2);

  // If the rendered output is a Clips ZIP Package, render the dedicated Clips Archive Explorer
  if (isZipOutput) {
    return (
      <section
        id="output-section"
        className="rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-7 space-y-6 text-slate-100"
      >
        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-md shadow-sky-500/10 shrink-0">
              <Archive className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                  Clips ZIP Archive Output
                </h3>
                <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 text-[11px] font-bold border border-sky-500/30 shadow-xs">
                  {matches.length} Video Clips
                </span>
                <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] font-semibold border border-emerald-500/30">
                  Timeline Synced
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Every slide image was rendered into its own video clip matching its exact timeline duration and audio sync.
              </p>
            </div>
          </div>

          {/* Primary Download Action */}
          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={handleDownload}
              className="px-6 py-3 rounded-xl font-bold text-xs sm:text-sm bg-gradient-to-r from-sky-500 via-blue-600 to-sky-600 hover:from-sky-400 hover:to-blue-500 text-white shadow-lg shadow-sky-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center gap-2.5"
            >
              <Download className="w-4 h-4" />
              <span>Download Clips Archive (.zip)</span>
            </button>
          </div>
        </div>

        {/* Specs Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto pt-1">
          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Duration</div>
            <div className="font-mono text-sm font-bold text-sky-400">{formatTime(videoDuration)}</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Resolution</div>
            <div className="font-mono text-sm font-bold text-emerald-400">
              {resolution === '1080p' ? '1920 × 1080' : '1280 × 720'}
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Package Size</div>
            <div className="font-mono text-sm font-bold text-indigo-400">{fileSizeMb} MB</div>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
            <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Slide Clips</div>
            <div className="font-mono text-sm font-bold text-amber-400">{matches.length} Clips</div>
          </div>
        </div>

        {/* Clips Grid List */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
              <FolderArchive className="w-4 h-4 text-sky-400" />
              <span>Included Video Clips in ZIP Package:</span>
            </h4>
            <span className="text-[11px] font-mono text-slate-400">
              All {matches.length} chunks ready for Premiere / DaVinci / CapCut
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-96 overflow-y-auto pr-1">
            {matches.map((m, idx) => {
              const clipNum = String(idx + 1).padStart(3, '0');
              const clipName = `clip_${clipNum}_${m.startTime.toFixed(2)}s-${m.endTime.toFixed(2)}s.mp4`;
              return (
                <div
                  key={idx}
                  className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 space-y-2.5 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-16 h-10 rounded-lg overflow-hidden bg-slate-800 border border-slate-700/80 shrink-0 relative">
                      {m.image?.previewUrl ? (
                        <img
                          src={m.image.previewUrl}
                          alt={m.image.name || `Clip ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-500">
                          <FileVideo className="w-4 h-4" />
                        </div>
                      )}
                      <span className="absolute bottom-0.5 right-0.5 px-1 py-0.2 rounded bg-black/80 text-[9px] font-mono text-white font-bold">
                        #{idx + 1}
                      </span>
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-mono font-bold text-white truncate" title={clipName}>
                        {clipName}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 mt-0.5">
                        <span className="text-sky-300 font-semibold">{m.duration.toFixed(2)}s</span>
                        <span>•</span>
                        <span>{m.startTime.toFixed(2)}s → {m.endTime.toFixed(2)}s</span>
                      </div>
                    </div>
                  </div>

                  {m.matchedTextSnippet && (
                    <p className="text-[11px] text-slate-400 font-sans line-clamp-1 italic">
                      &quot;{m.matchedTextSnippet}&quot;
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Reset & Re-edit Action */}
        {onReset && (
          <div className="flex justify-center pt-2">
            <button
              type="button"
              onClick={onReset}
              className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Start New Project</span>
            </button>
          </div>
        )}
      </section>
    );
  }

  return (
    <section
      id="output-section"
      className="rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-5 sm:p-7 space-y-6 text-slate-100"
    >
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-500/10 shrink-0">
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                Synchronized Video Output
              </h3>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 text-[11px] font-bold border border-emerald-500/30 shadow-xs">
                30 FPS CFR Ready
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-sky-500/15 text-sky-300 text-[11px] font-semibold border border-sky-500/30">
                FastStart Enabled
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Optimized constant frame-rate stream with instant seeking and high-fidelity English timing.
            </p>
          </div>
        </div>

        {/* Primary Download Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDownload}
            className="px-5 py-2.5 rounded-xl font-bold text-xs sm:text-sm bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 hover:from-emerald-400 hover:to-teal-400 text-white shadow-lg shadow-emerald-500/20 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer flex items-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Download Video (.mp4)</span>
          </button>
        </div>
      </div>

      {/* Modern High-Performance Studio Player Frame */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMoveContainer}
        onMouseLeave={() => isPlaying && setShowControls(false)}
        className="relative rounded-2xl overflow-hidden bg-black border border-slate-800 shadow-2xl max-w-4xl mx-auto aspect-video select-none group flex items-center justify-center"
      >
        <video
          ref={videoRef}
          src={videoUrl}
          playsInline
          preload="auto"
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onEnded={() => setIsPlaying(false)}
          onClick={handlePlayPause}
          className="w-full h-full object-contain cursor-pointer"
        />

        {/* Center Giant Play/Pause Overlay Button */}
        {!isPlaying && (
          <button
            type="button"
            onClick={handlePlayPause}
            aria-label="Play Video"
            className="absolute z-20 w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-emerald-500/90 hover:bg-emerald-400 text-white flex items-center justify-center shadow-2xl shadow-emerald-500/40 backdrop-blur-md transition-all hover:scale-110 active:scale-95 cursor-pointer"
          >
            <Play className="w-8 h-8 sm:w-10 sm:h-10 ml-1 fill-white" />
          </button>
        )}

        {/* Active Slide Top Floating Pill */}
        <div className="absolute top-3 left-3 z-20 flex items-center gap-2 pointer-events-none">
          <div className="px-3 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/10 text-white text-xs font-mono font-bold flex items-center gap-2 shadow-lg">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>
              Slide {currentSlideIndex + 1} of {totalSlides}
            </span>
          </div>
          {activeSlide && activeSlide.triggerSentence && (
            <div className="hidden sm:block max-w-xs truncate px-3 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/10 text-slate-300 text-[11px] font-sans">
              {activeSlide.triggerSentence}
            </div>
          )}
        </div>

        {/* Video Player Floating Bottom Control Bar */}
        <div
          className={`absolute bottom-0 inset-x-0 z-30 p-3 sm:p-4 bg-gradient-to-t from-black/95 via-black/80 to-transparent transition-opacity duration-300 ${
            showControls || !isPlaying ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Timeline Scrubber Bar with Slide Marker Ticks */}
          <div className="relative mb-3 group/scrub">
            {/* Hover timestamp tooltip */}
            {hoverTime !== null && (
              <div
                className="absolute -top-8 -translate-x-1/2 px-2 py-0.5 rounded bg-slate-900 text-sky-300 text-[11px] font-mono border border-slate-700 shadow-lg pointer-events-none"
                style={{ left: `${hoverPosition}%` }}
              >
                {formatTime(hoverTime)}
              </div>
            )}

            <div
              ref={progressBarRef}
              onMouseDown={handleProgressMouseDown}
              onMouseMove={handleProgressMouseMove}
              onMouseLeave={handleProgressMouseLeave}
              className="h-3 w-full rounded-full bg-white/15 hover:bg-white/25 cursor-pointer relative overflow-hidden transition-all duration-150 py-0.5"
            >
              {/* Buffer / Active Progress Fill */}
              <div
                className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-teal-400 to-sky-400 relative transition-all duration-75"
                style={{ width: `${progressPercentage}%` }}
              >
                {/* Scrubber Knob */}
                <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white shadow-md shadow-black/80 scale-100 group-hover/scrub:scale-125 transition-transform" />
              </div>

              {/* Slide Transition Marker Ticks */}
              {matches.map((m, idx) => {
                if (idx === 0 || duration <= 0) return null;
                const markerPct = (m.startTime / duration) * 100;
                return (
                  <div
                    key={idx}
                    title={`Slide ${idx + 1} (${formatTime(m.startTime)})`}
                    className="absolute top-0 bottom-0 w-0.5 bg-white/40 pointer-events-none"
                    style={{ left: `${markerPct}%` }}
                  />
                );
              })}
            </div>
          </div>

          {/* Controls row */}
          <div className="flex items-center justify-between text-xs text-white">
            {/* Left controls: Play, Prev/Next slide, Skip, Timing */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={handlePlayPause}
                className="p-1.5 rounded-lg hover:bg-white/15 text-white transition-colors cursor-pointer"
                title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current" />}
              </button>

              <button
                type="button"
                onClick={() => handleJumpToSlide(currentSlideIndex - 1)}
                disabled={currentSlideIndex <= 0}
                className="p-1 rounded-md hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer text-slate-300 hover:text-white"
                title="Previous Slide"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleJumpToSlide(currentSlideIndex + 1)}
                disabled={currentSlideIndex >= matches.length - 1}
                className="p-1 rounded-md hover:bg-white/15 disabled:opacity-30 disabled:cursor-not-allowed transition-colors cursor-pointer text-slate-300 hover:text-white"
                title="Next Slide"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleSkip(-5)}
                className="p-1.5 rounded-lg hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer hidden sm:block"
                title="Rewind 5s (Left Arrow)"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => handleSkip(5)}
                className="p-1.5 rounded-lg hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer hidden sm:block"
                title="Forward 5s (Right Arrow)"
              >
                <SkipForward className="w-4 h-4" />
              </button>

              {/* Time display */}
              <div className="font-mono text-xs text-slate-300 pl-1">
                <span className="font-bold text-white">{formatTime(currentTime)}</span>
                <span className="text-slate-500 mx-1">/</span>
                <span className="text-slate-400">{formatTime(duration)}</span>
              </div>
            </div>

            {/* Right controls: Playback rate, Volume, Fullscreen */}
            <div className="flex items-center gap-2 sm:gap-3">
              {/* Playback speed selector */}
              <div className="flex items-center gap-1 bg-white/10 rounded-lg p-0.5">
                {SPEED_OPTIONS.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => handleRateChange(rate)}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors cursor-pointer ${
                      playbackRate === rate ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    {rate}x
                  </button>
                ))}
              </div>

              {/* Volume Slider */}
              <div className="flex items-center gap-1.5 group/vol">
                <button
                  type="button"
                  onClick={handleToggleMute}
                  className="p-1.5 rounded-lg hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer"
                  title={isMuted ? 'Unmute (M)' : 'Mute (M)'}
                >
                  {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={isMuted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                  className="w-16 h-1.5 rounded-lg bg-white/20 accent-emerald-400 cursor-pointer hidden sm:block"
                  title="Volume (Up/Down Arrow)"
                />
              </div>

              {/* Fullscreen Button */}
              <button
                type="button"
                onClick={handleToggleFullscreen}
                className="p-1.5 rounded-lg hover:bg-white/15 text-slate-300 hover:text-white transition-colors cursor-pointer"
                title="Fullscreen (F)"
              >
                {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Stream & Output Specs Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-4xl mx-auto pt-1">
        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Duration</div>
          <div className="font-mono text-sm font-bold text-sky-400">{formatTime(duration)}</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Resolution</div>
          <div className="font-mono text-sm font-bold text-emerald-400">
            {resolution === '1080p' ? '1920 × 1080 (1080p)' : '1280 × 720 (720p)'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">File Size</div>
          <div className="font-mono text-sm font-bold text-indigo-400">{fileSizeMb} MB</div>
        </div>

        <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800 text-center space-y-1">
          <div className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Slide Tracks</div>
          <div className="font-mono text-sm font-bold text-amber-400">{totalSlides} Slides</div>
        </div>
      </div>

      {/* Reset & Re-edit Action */}
      {onReset && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={onReset}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-white bg-slate-800/50 hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Clear Output & Adjust Inputs</span>
          </button>
        </div>
      )}
    </section>
  );
};
