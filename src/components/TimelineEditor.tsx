'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
  Clock,
  Subtitles,
  Layers,
  Magnet,
  RefreshCw,
  Film,
  Volume2,
  VolumeX,
  AlertCircle,
  FileText,
  AlignLeft,
  Sparkles,
  Sliders,
  ChevronDown,
  ChevronUp,
  Zap,
  Check,
  Link2,
  UploadCloud,
  Image as ImageIcon,
  Eye,
  X,
  List,
} from 'lucide-react';
import {
  SyncMatch,
  VttCue,
  MotionSettings,
  DEFAULT_MOTION_SETTINGS,
  ScriptParagraph,
  ImageItem,
  LogoSettings,
  DEFAULT_LOGO_SETTINGS,
  LogoPosition,
} from '@/lib/types';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';
import { intelligentAutoSync } from '@/lib/matcher';
import { getZoomScaleAtTime } from '@/lib/motion';
import { WordToFrameConnector } from './WordToFrameConnector';

interface TimelineEditorProps {
  matches: SyncMatch[];
  cues: VttCue[];
  totalDuration: number;
  voiceoverUrl?: string | null;
  onUpdateMatches: (updatedMatches: SyncMatch[]) => void;
  onResetToAutoSync?: () => void;
  motionSettings?: MotionSettings;
  onUpdateMotionSettings?: (settings: MotionSettings) => void;
  logoSettings?: LogoSettings;
  onUpdateLogoSettings?: (settings: LogoSettings) => void;
  paragraphs?: ScriptParagraph[];
  images?: ImageItem[];
}

export const TimelineEditor: React.FC<TimelineEditorProps> = ({
  matches,
  cues,
  totalDuration,
  voiceoverUrl,
  onUpdateMatches,
  onResetToAutoSync,
  motionSettings,
  onUpdateMotionSettings,
  logoSettings,
  onUpdateLogoSettings,
  paragraphs = [],
  images = [],
}) => {
  const [isWordLinkerOpen, setIsWordLinkerOpen] = useState<boolean>(false);
  // Motion FX settings state (subtle Ken Burns zoom + slide transitions)
  const [internalMotionSettings, setInternalMotionSettings] = useState<MotionSettings>(
    motionSettings || DEFAULT_MOTION_SETTINGS
  );
  const activeMotionSettings = motionSettings || internalMotionSettings;
  const [showZoomSettings, setShowZoomSettings] = useState<boolean>(false);
  const zoomSettingsRef = useRef<HTMLDivElement | null>(null);

  const toggleZoomEffect = useCallback(() => {
    const nextSettings = {
      ...activeMotionSettings,
      zoomEnabled: !activeMotionSettings.zoomEnabled,
    };
    setInternalMotionSettings(nextSettings);
    onUpdateMotionSettings?.(nextSettings);
  }, [activeMotionSettings, onUpdateMotionSettings]);

  const updateZoomIntensity = useCallback(
    (newIntensity: number) => {
      const nextSettings: MotionSettings = {
        ...activeMotionSettings,
        zoomIntensity: newIntensity,
      };
      setInternalMotionSettings(nextSettings);
      onUpdateMotionSettings?.(nextSettings);
    },
    [activeMotionSettings, onUpdateMotionSettings]
  );

  const updateZoomDirection = useCallback(
    (newDirection: 'random' | 'in' | 'out') => {
      const nextSettings: MotionSettings = {
        ...activeMotionSettings,
        zoomDirection: newDirection,
      };
      setInternalMotionSettings(nextSettings);
      onUpdateMotionSettings?.(nextSettings);
    },
    [activeMotionSettings, onUpdateMotionSettings]
  );

  // Close zoom popover when clicking outside
  useEffect(() => {
    if (!showZoomSettings) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (zoomSettingsRef.current && !zoomSettingsRef.current.contains(e.target as Node)) {
        setShowZoomSettings(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showZoomSettings]);

  // Logo Watermark state
  const [internalLogoSettings, setInternalLogoSettings] = useState<LogoSettings>(
    logoSettings || DEFAULT_LOGO_SETTINGS
  );
  const activeLogoSettings = logoSettings || internalLogoSettings;
  const [showLogoControls, setShowLogoControls] = useState(true);
  const logoInputRef = useRef<HTMLInputElement | null>(null);

  const updateLogo = useCallback(
    (updater: LogoSettings | ((prev: LogoSettings) => LogoSettings)) => {
      const next = typeof updater === 'function' ? updater(activeLogoSettings) : updater;
      setInternalLogoSettings(next);
      onUpdateLogoSettings?.(next);
    },
    [activeLogoSettings, onUpdateLogoSettings]
  );

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    updateLogo((prev) => ({
      ...prev,
      enabled: true,
      file,
      previewUrl,
      name: file.name,
    }));
  };

  const removeLogo = () => {
    if (activeLogoSettings.previewUrl && activeLogoSettings.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(activeLogoSettings.previewUrl);
    }
    updateLogo((prev) => ({
      ...prev,
      enabled: false,
      file: null,
      previewUrl: null,
      name: '',
    }));
  };

  // Filmstrip & Lightbox State for crystal-clear thumbnails
  const [showFilmstrip, setShowFilmstrip] = useState<boolean>(true);
  const [filmstripViewMode, setFilmstripViewMode] = useState<'filmstrip' | 'list'>('filmstrip');
  const [enlargedImage, setEnlargedImage] = useState<{
    url: string;
    name: string;
    slideIdx: number;
    duration: number;
    trigger?: string;
  } | null>(null);



  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isLooping, setIsLooping] = useState(true);
  const [showSubtitles, setShowSubtitles] = useState(true);
  const [isMuted, setIsMuted] = useState(false);

  // Audio ref & Playback optimization refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewImageRef = useRef<HTMLImageElement | null>(null);
  const currentTimeRef = useRef(0);
  const playheadRef = useRef<HTMLDivElement | null>(null);
  const timecodeRef = useRef<HTMLSpanElement | null>(null);

  // Timeline UI state
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1 = 70px/s
  const [snapToCues, setSnapToCues] = useState(true);
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number | null>(0);
  const [showCuesTrack, setShowCuesTrack] = useState(true);
  const [showParagraphsTrack, setShowParagraphsTrack] = useState(true);
  const [autoSyncNotice, setAutoSyncNotice] = useState<string | null>(null);

  // Dragging state for playhead and edge trimming
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [draggingHandle, setDraggingHandle] = useState<{
    slideIndex: number;
    edge: 'start' | 'end';
    startX: number;
    initialStartTime: number;
    initialEndTime: number;
  } | null>(null);

  // Refs
  const timelineScrollRef = useRef<HTMLDivElement>(null);
  const timelineTracksRef = useRef<HTMLDivElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const lastTimeRef = useRef<number | null>(null);
  const lastStateUpdateRef = useRef<number>(0);

  // Calculate pixels per second based on zoom level
  const basePixelsPerSecond = 70;
  const pps = basePixelsPerSecond * zoomLevel;

  // Safe total duration
  const safeTotalDuration = Math.max(
    1,
    matches.length > 0 ? matches[matches.length - 1].endTime : totalDuration || 1
  );

  const timelineWidth = Math.max(800, safeTotalDuration * pps + 140);

  // Synchronize currentTimeRef with state
  useEffect(() => {
    currentTimeRef.current = currentTime;
    if (playheadRef.current) {
      playheadRef.current.style.transform = `translateX(${currentTime * pps}px)`;
    }
    if (timecodeRef.current) {
      timecodeRef.current.innerText = formatSecondsToTimestamp(currentTime);
    }
  }, [currentTime, pps]);

  // Decoupled Active Slide & Cue state (Updated only when boundary crossed, not 60fps)
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const activeSlideIndexRef = useRef(0);
  const activeCueIndexRef = useRef(-1);
  const [activeCue, setActiveCue] = useState<VttCue | null>(null);
  const subtitleTextRef = useRef<HTMLParagraphElement | null>(null);
  const lastScrubUpdateRef = useRef(0);

  // Sync activeSlideIndex with matches when matches change
  useEffect(() => {
    if (matches.length > 0) {
      const cur = currentTimeRef.current;
      const found = matches.findIndex((m) => cur >= m.startTime && cur < m.endTime);
      const idx = found !== -1 ? found : 0;
      activeSlideIndexRef.current = idx;
      setActiveSlideIndex(idx);
    }
  }, [matches]);

  const activeSlide = activeSlideIndex >= 0 && activeSlideIndex < matches.length ? matches[activeSlideIndex] : null;

  const updatePreviewZoom = useCallback(
    (time: number, slideIndex: number) => {
      const image = previewImageRef.current;
      if (!image) return;

      const match = matches[slideIndex];
      const scale =
        activeMotionSettings.zoomEnabled && match
          ? getZoomScaleAtTime(
              match,
              time,
              activeMotionSettings.zoomIntensity
            )
          : 1;
      image.style.transform = `scale(${scale}) translateZ(0)`;
    },
    [
      activeMotionSettings.zoomEnabled,
      activeMotionSettings.zoomIntensity,
      matches,
    ]
  );

  useEffect(() => {
    updatePreviewZoom(currentTimeRef.current, activeSlideIndex);
  }, [activeSlideIndex, updatePreviewZoom]);


  // High-performance 60FPS animation loop: updates playhead & timecode directly via GPU transform
  useEffect(() => {
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimeRef.current = null;
      return;
    }

    const step = (timestamp: number) => {
      if (lastTimeRef.current === null) {
        lastTimeRef.current = timestamp;
      }
      const deltaSec = ((timestamp - lastTimeRef.current) / 1000) * playbackSpeed;
      lastTimeRef.current = timestamp;

      let nextTime = currentTimeRef.current + deltaSec;
      if (nextTime >= safeTotalDuration) {
        if (isLooping) {
          nextTime = 0;
        } else {
          setIsPlaying(false);
          nextTime = safeTotalDuration;
        }
      }

      currentTimeRef.current = nextTime;

      // Update playhead DOM directly on GPU - 60fps butter-smooth movement
      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${nextTime * pps}px)`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.innerText = formatSecondsToTimestamp(nextTime);
      }

      // Check if active slide boundary changed (triggers React re-render only when slide changes!)
      if (matches.length > 0) {
        const curIdx = activeSlideIndexRef.current;
        const curSlide = matches[curIdx];
        let previewSlideIndex = curIdx;
        if (!curSlide || nextTime < curSlide.startTime || nextTime >= curSlide.endTime) {
          let found = matches.findIndex((m) => nextTime >= m.startTime && nextTime < m.endTime);
          if (found === -1 && nextTime >= matches[matches.length - 1]?.endTime) {
            found = matches.length - 1;
          }
          if (found !== -1 && found !== curIdx) {
            activeSlideIndexRef.current = found;
            setActiveSlideIndex(found);
            previewSlideIndex = found;
          }
        }
        updatePreviewZoom(nextTime, previewSlideIndex);
      }

      // Check if active subtitle cue changed
      if (showSubtitles && cues.length > 0) {
        const curCIdx = activeCueIndexRef.current;
        const curCue = curCIdx >= 0 ? cues[curCIdx] : null;
        if (!curCue || nextTime < curCue.startTime || nextTime > curCue.endTime) {
          const newCIdx = cues.findIndex((c) => nextTime >= c.startTime && nextTime <= c.endTime);
          if (newCIdx !== curCIdx) {
            activeCueIndexRef.current = newCIdx;
            const newCueObj = newCIdx >= 0 ? cues[newCIdx] : null;
            setActiveCue(newCueObj);
            if (subtitleTextRef.current) {
              subtitleTextRef.current.innerText = newCueObj ? newCueObj.cleanText : '';
            }
          }
        }
      }

      animationFrameRef.current = requestAnimationFrame(step);
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, isLooping, safeTotalDuration, pps, matches, cues, showSubtitles, updatePreviewZoom]);

  // Synchronize audio element with playback state
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !voiceoverUrl) return;

    if (isPlaying) {
      if (Math.abs(audio.currentTime - currentTimeRef.current) > 0.15) {
        audio.currentTime = currentTimeRef.current;
      }
      audio.playbackRate = playbackSpeed;
      audio.muted = isMuted;
      audio.play().catch(() => {});
    } else {
      audio.pause();
      if (Math.abs(audio.currentTime - currentTimeRef.current) > 0.05) {
        audio.currentTime = currentTimeRef.current;
      }
    }
  }, [isPlaying, voiceoverUrl, playbackSpeed, isMuted]);

  // Sync audio time when seeking
  const seekTo = useCallback(
    (time: number) => {
      const clamped = Math.max(0, Math.min(safeTotalDuration, time));
      currentTimeRef.current = clamped;
      setCurrentTime(clamped);

      if (playheadRef.current) {
        playheadRef.current.style.transform = `translateX(${clamped * pps}px)`;
      }
      if (timecodeRef.current) {
        timecodeRef.current.innerText = formatSecondsToTimestamp(clamped);
      }

      if (matches.length > 0) {
        const foundIdx = matches.findIndex((m) => clamped >= m.startTime && clamped < m.endTime);
        const newIdx = foundIdx !== -1 ? foundIdx : (clamped >= matches[matches.length - 1]?.endTime ? matches.length - 1 : 0);
        if (newIdx !== activeSlideIndexRef.current) {
          activeSlideIndexRef.current = newIdx;
          setActiveSlideIndex(newIdx);
        }
        updatePreviewZoom(clamped, newIdx);
      }

      if (showSubtitles && cues.length > 0) {
        const foundCIdx = cues.findIndex((c) => clamped >= c.startTime && clamped <= c.endTime);
        activeCueIndexRef.current = foundCIdx;
        const newCue = foundCIdx >= 0 ? cues[foundCIdx] : null;
        setActiveCue(newCue);
        if (subtitleTextRef.current) {
          subtitleTextRef.current.innerText = newCue ? newCue.cleanText : '';
        }
      }

      if (audioRef.current && voiceoverUrl) {
        audioRef.current.currentTime = clamped;
      }
    },
    [safeTotalDuration, pps, voiceoverUrl, matches, showSubtitles, cues, updatePreviewZoom]
  );


  const seekRelative = (delta: number) => {
    seekTo(currentTimeRef.current + delta);
  };

  const jumpToSlide = (index: number) => {
    if (index >= 0 && index < matches.length) {
      setSelectedSlideIndex(index);
      seekTo(matches[index].startTime + 0.02);
    }
  };

  // Keyboard shortcut listener (Spacebar for play/pause, arrow keys for step)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) {
        return;
      }

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => {
          if (!p) {
            // Update audio before playing
            if (audioRef.current && voiceoverUrl) {
              audioRef.current.currentTime = currentTimeRef.current;
            }
          }
          return !p;
        });
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekRelative(-1);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekRelative(1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [safeTotalDuration, voiceoverUrl]);

  useEffect(() => {
    const handleZoomShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        !target ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== 'z'
      ) {
        return;
      }

      event.preventDefault();
      toggleZoomEffect();
    };

    window.addEventListener('keydown', handleZoomShortcut);
    return () => window.removeEventListener('keydown', handleZoomShortcut);
  }, [toggleZoomEffect]);

  // Convert client coordinate to timeline seconds
  const clientXToSeconds = useCallback(
    (clientX: number): number => {
      if (!timelineTracksRef.current) return 0;
      const rect = timelineTracksRef.current.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const seconds = offsetX / pps;
      return Math.max(0, Math.min(safeTotalDuration, seconds));
    },
    [pps, safeTotalDuration]
  );

  // Playhead scrubbing handler
  const handleTimelineMouseDown = (e: React.MouseEvent) => {
    if (draggingHandle) return;
    setIsScrubbing(true);
    const sec = clientXToSeconds(e.clientX);
    seekTo(sec);
  };

  // Global mouse move & mouse up listeners for scrubbing & dragging handles
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isScrubbing) {
        const sec = clientXToSeconds(e.clientX);
        currentTimeRef.current = sec;
        if (playheadRef.current) {
          playheadRef.current.style.transform = `translateX(${sec * pps}px)`;
        }
        if (timecodeRef.current) {
          timecodeRef.current.innerText = formatSecondsToTimestamp(sec);
        }

        // Throttle audio seek and slide preview to 35ms for butter-smooth scrubbing
        const now = performance.now();
        if (now - lastScrubUpdateRef.current > 35) {
          lastScrubUpdateRef.current = now;
          seekTo(sec);
        }
      } else if (draggingHandle) {
        const { slideIndex, edge, startX, initialStartTime, initialEndTime } = draggingHandle;
        const deltaPx = e.clientX - startX;
        const deltaSec = deltaPx / pps;

        let targetSec = edge === 'end' ? initialEndTime + deltaSec : initialStartTime + deltaSec;

        // Optional Snap to Cues
        if (snapToCues && cues.length > 0) {
          const snapThreshold = 0.35;
          for (const cue of cues) {
            if (Math.abs(cue.startTime - targetSec) < snapThreshold) {
              targetSec = cue.startTime;
              break;
            }
            if (Math.abs(cue.endTime - targetSec) < snapThreshold) {
              targetSec = cue.endTime;
              break;
            }
          }
        }

        const newMatches = [...matches];
        const currentMatch = { ...newMatches[slideIndex] };

        if (edge === 'end') {
          // Adjust end time of current slide & start time of next slide
          const minEnd = currentMatch.startTime + 0.5;
          const clampedEnd = Math.max(minEnd, Number(targetSec.toFixed(2)));
          currentMatch.endTime = clampedEnd;
          currentMatch.duration = Number((clampedEnd - currentMatch.startTime).toFixed(2));
          newMatches[slideIndex] = currentMatch;

          if (slideIndex < newMatches.length - 1) {
            const nextMatch = { ...newMatches[slideIndex + 1] };
            nextMatch.startTime = clampedEnd;
            nextMatch.duration = Math.max(0.5, Number((nextMatch.endTime - clampedEnd).toFixed(2)));
            newMatches[slideIndex + 1] = nextMatch;
          }
        } else if (edge === 'start' && slideIndex > 0) {
          // Adjust start time of current slide & end time of previous slide
          const maxStart = currentMatch.endTime - 0.5;
          const clampedStart = Math.min(maxStart, Math.max(0, Number(targetSec.toFixed(2))));
          currentMatch.startTime = clampedStart;
          currentMatch.duration = Number((currentMatch.endTime - clampedStart).toFixed(2));
          newMatches[slideIndex] = currentMatch;

          const prevMatch = { ...newMatches[slideIndex - 1] };
          prevMatch.endTime = clampedStart;
          prevMatch.duration = Math.max(0.5, Number((clampedStart - prevMatch.startTime).toFixed(2)));
          newMatches[slideIndex - 1] = prevMatch;
        }

        onUpdateMatches(newMatches);
      }
    };

    const handleMouseUp = () => {
      if (isScrubbing) {
        setIsScrubbing(false);
        seekTo(currentTimeRef.current);
      }
      if (draggingHandle) setDraggingHandle(null);
    };


    if (isScrubbing || draggingHandle) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isScrubbing, draggingHandle, clientXToSeconds, pps, matches, snapToCues, cues, onUpdateMatches, seekTo]);

  // Adjust duration by fixed delta (+/- 0.1s or +/- 0.5s)
  const adjustSlideDuration = (index: number, delta: number) => {
    if (index < 0 || index >= matches.length) return;
    const newMatches = [...matches];
    const target = { ...newMatches[index] };
    const newDuration = Math.max(0.5, Number((target.duration + delta).toFixed(2)));
    const durationDiff = newDuration - target.duration;

    target.duration = newDuration;
    target.endTime = Number((target.startTime + newDuration).toFixed(2));
    newMatches[index] = target;

    // Shift all subsequent slides
    for (let i = index + 1; i < newMatches.length; i++) {
      const m = { ...newMatches[i] };
      m.startTime = Number((m.startTime + durationDiff).toFixed(2));
      m.endTime = Number((m.endTime + durationDiff).toFixed(2));
      newMatches[i] = m;
    }

    onUpdateMatches(newMatches);
  };

  // Shift transition boundary between slide index-1 and slide index
  const adjustSlideBoundary = (index: number, delta: number) => {
    if (index <= 0 || index >= matches.length) return;
    const newMatches = [...matches];
    const prev = { ...newMatches[index - 1] };
    const current = { ...newMatches[index] };

    const newBoundary = Number((current.startTime + delta).toFixed(2));
    if (newBoundary < prev.startTime + 0.3 || newBoundary > current.endTime - 0.3) {
      return;
    }

    prev.endTime = newBoundary;
    prev.duration = Number((newBoundary - prev.startTime).toFixed(2));

    current.startTime = newBoundary;
    current.duration = Number((current.endTime - newBoundary).toFixed(2));

    newMatches[index - 1] = prev;
    newMatches[index] = current;
    onUpdateMatches(newMatches);
  };

  // Generate ruler tick marks
  const rulerTicks = useMemo(() => {
    const ticks = [];
    const step = zoomLevel >= 1.5 ? 1 : zoomLevel >= 0.8 ? 2 : 5;
    for (let sec = 0; sec <= safeTotalDuration + step; sec += step) {
      ticks.push(sec);
    }
    return ticks;
  }, [safeTotalDuration, zoomLevel]);

  if (matches.length === 0) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-slate-900/95 border border-slate-800 shadow-2xl overflow-hidden backdrop-blur-xl flex flex-col space-y-0">
      {/* Hidden audio element for synchronized playback */}
      {voiceoverUrl && (
        <audio ref={audioRef} src={voiceoverUrl} preload="auto" />
      )}

      {/* 1. TOP HEADER & WORKSPACE TOOLBAR */}
      <div className="px-5 py-3.5 border-b border-slate-800 bg-slate-950/70 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <Film className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              Timeline Editor
              <span className="text-[11px] px-2 py-0.2 rounded-full bg-indigo-500/20 text-indigo-300 font-semibold border border-indigo-500/30">
                1 Paragraph = 1 Image
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Images synchronized to paragraph start lines in the voiceover
            </p>
          </div>
        </div>

        {/* Action Controls in Header */}
        <div className="flex items-center gap-2 flex-wrap">
          {onResetToAutoSync && (
            <button
              onClick={onResetToAutoSync}
              type="button"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-300 bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700 hover:text-white transition-all shadow-sm cursor-pointer"
              title="Recalculate timestamps directly from paragraph voiceover alignment"
            >
              <RefreshCw className="w-3.5 h-3.5 text-sky-400" />
              <span>Reset to Auto-Sync</span>
            </button>
          )}

          {/* Zoom Effect Toggle & Interactive Settings Popover */}
          <div className="relative inline-flex items-center" ref={zoomSettingsRef}>
            <div className="inline-flex rounded-xl shadow-sm">
              <button
                type="button"
                onClick={toggleZoomEffect}
                aria-pressed={activeMotionSettings.zoomEnabled}
                className={`inline-flex min-h-10 items-center gap-2 px-3.5 py-2 rounded-l-xl text-xs font-bold border-y border-l transition-colors cursor-pointer ${
                  activeMotionSettings.zoomEnabled
                    ? 'bg-violet-500/20 text-violet-200 border-violet-400/50 hover:bg-violet-500/30'
                    : 'bg-slate-800/70 text-slate-300 border-slate-700 hover:bg-slate-700/80 hover:text-white'
                }`}
                title="Toggle smooth zoom on every image clip (keyboard shortcut: Z). Zoom can slow exports; leave it off for faster rendering."
              >
                <Sparkles className="w-4 h-4 text-violet-400" aria-hidden="true" />
                <span>Zoom Effect: {activeMotionSettings.zoomEnabled ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={() => setShowZoomSettings((prev) => !prev)}
                aria-expanded={showZoomSettings}
                className={`inline-flex min-h-10 items-center gap-1.5 px-2.5 py-2 rounded-r-xl text-xs font-bold border transition-colors cursor-pointer ${
                  activeMotionSettings.zoomEnabled
                    ? 'bg-violet-600/30 text-violet-200 border-violet-400/50 hover:bg-violet-500/40'
                    : 'bg-slate-800/90 text-slate-400 border-slate-700 hover:bg-slate-700 hover:text-white'
                }`}
                title="Adjust Zoom Level (e.g. 102% scale) and Direction"
              >
                <span className="font-mono text-[11px] text-violet-300">
                  {100 + (activeMotionSettings.zoomIntensity || 2)}%
                </span>
                <Sliders className="w-3.5 h-3.5 text-violet-400" />
                <ChevronDown
                  className={`w-3 h-3 text-slate-400 transition-transform duration-200 ${
                    showZoomSettings ? 'rotate-180' : ''
                  }`}
                />
              </button>
            </div>

            {/* Interactive Zoom Settings Popover */}
            {showZoomSettings && (
              <div className="absolute top-full left-0 mt-2 z-50 w-80 p-4 rounded-2xl bg-slate-900/95 backdrop-blur-xl border border-violet-500/40 shadow-2xl text-slate-200 space-y-3.5 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-violet-400" />
                    <span className="text-xs font-bold text-white tracking-wide">
                      Zoom Level &amp; Direction
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowZoomSettings(false)}
                    className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Scale Display */}
                <div className="p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 text-center space-y-1">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                    Current Scale Factor
                  </span>
                  <div className="text-sm font-mono font-bold text-violet-300">
                    {activeMotionSettings.zoomDirection === 'in'
                      ? `100% → ${(100 + (activeMotionSettings.zoomIntensity || 2)).toFixed(1)}% (Zoom In)`
                      : activeMotionSettings.zoomDirection === 'out'
                      ? `${(100 + (activeMotionSettings.zoomIntensity || 2)).toFixed(1)}% → 100% (Zoom Out)`
                      : `100% ⇄ ${(100 + (activeMotionSettings.zoomIntensity || 2)).toFixed(1)}% (Alternating)`}
                  </div>
                </div>

                {/* Slider */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="text-slate-400">Zoom Intensity:</span>
                    <span className="font-bold text-violet-300">
                      {(activeMotionSettings.zoomIntensity || 2).toFixed(1)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="10"
                    step="0.5"
                    value={activeMotionSettings.zoomIntensity || 2}
                    onChange={(e) => updateZoomIntensity(parseFloat(e.target.value))}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-violet-500"
                  />
                </div>

                {/* Presets */}
                <div className="space-y-1">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                    Quick Presets
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-xs font-mono">
                    {[
                      { label: '1% (101%)', val: 1 },
                      { label: '2% (102% ✓)', val: 2 },
                      { label: '3% (103%)', val: 3 },
                      { label: '5% (105%)', val: 5 },
                      { label: '8% (108%)', val: 8 },
                      { label: '10% (110%)', val: 10 },
                    ].map((p) => (
                      <button
                        key={p.val}
                        type="button"
                        onClick={() => updateZoomIntensity(p.val)}
                        className={`px-2 py-1.5 rounded-lg text-center font-semibold transition-all border cursor-pointer ${
                          Math.abs((activeMotionSettings.zoomIntensity || 2) - p.val) < 0.1
                            ? 'bg-violet-600 text-white border-violet-400 shadow-sm'
                            : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Direction Selector */}
                <div className="space-y-1 pt-1 border-t border-slate-800">
                  <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider block">
                    Zoom Direction
                  </span>
                  <div className="grid grid-cols-3 gap-1.5 text-[11px] font-mono">
                    {[
                      { id: 'random', label: 'Alternating ⇄' },
                      { id: 'in', label: 'Zoom In' },
                      { id: 'out', label: 'Zoom Out' },
                    ].map((d) => (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => updateZoomDirection(d.id as 'random' | 'in' | 'out')}
                        className={`p-1.5 rounded-lg text-center font-semibold transition-all border cursor-pointer ${
                          (activeMotionSettings.zoomDirection || 'random') === d.id
                            ? 'bg-violet-600 text-white border-violet-400 shadow-sm'
                            : 'bg-slate-950/60 text-slate-300 border-slate-800 hover:bg-slate-800 hover:text-white'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] text-slate-400 italic">
                  Default 102% (2%) ensures ultra-smooth motion without jitter or vibration.
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => setSnapToCues(!snapToCues)}
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
              snapToCues
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 shadow-sky-500/10'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Snap slide trims to VTT cue points"
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>Magnetic Snap</span>
          </button>

          <button
            onClick={() => setShowParagraphsTrack(!showParagraphsTrack)}
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
              showParagraphsTrack
                ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Show or hide Paragraph Script Track"
          >
            <AlignLeft className="w-3.5 h-3.5" />
            <span>Paragraph Track</span>
          </button>

          <button
            onClick={() => setShowCuesTrack(!showCuesTrack)}
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
              showCuesTrack
                ? 'bg-purple-500/20 text-purple-300 border-purple-500/40'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Show or hide VTT Subtitle Cues Track"
          >
            <Subtitles className="w-3.5 h-3.5" />
            <span>Subtitle Track</span>
          </button>

          <button
            onClick={() => setShowFilmstrip(!showFilmstrip)}
            type="button"
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all border shadow-sm cursor-pointer ${
              showFilmstrip
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-800/60 text-slate-400 border-slate-700 hover:text-white'
            }`}
            title="Show or hide Slide Thumbnails Filmstrip"
          >
            <ImageIcon className="w-3.5 h-3.5" />
            <span>Thumbnails</span>
          </button>
        </div>
      </div>

      {/* 2. REAL-TIME CANVAS/IMAGE PREVIEW VIEWPORT */}
      <div className="p-6 bg-gradient-to-b from-slate-950/40 to-slate-900/60 border-b border-slate-800/80 flex flex-col items-center">
        <div className="w-full max-w-3xl space-y-3.5">
          {/* Quick Word-to-Frame Linker trigger */}
          {cues.length > 0 && (
            <div className="flex items-center justify-between px-4 py-2.5 rounded-xl bg-slate-900/80 border border-slate-800 shadow-md text-xs">
              <div className="flex items-center gap-2">
                <Link2 className="w-4 h-4 text-cyan-400" />
                <span className="text-slate-200 font-bold">Word-to-Frame Visual Linker</span>
                <span className="text-slate-400 hidden sm:inline">&bull; Connect speech words &amp; sentences directly to slide frames</span>
              </div>
              <button
                type="button"
                onClick={() => setIsWordLinkerOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors shadow-sm cursor-pointer active:scale-95"
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>Open Word Linker</span>
              </button>
            </div>
          )}


          {/* Brand Logo & Watermark Studio Card */}
          <div className="rounded-2xl bg-slate-900/90 border border-slate-800 shadow-xl overflow-hidden backdrop-blur-md transition-all">
            {/* Header */}
            <div className="px-4 py-3 sm:px-5 sm:py-3.5 flex items-center justify-between gap-3 border-b border-slate-800/80 bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30 shadow-inner">
                  <ImageIcon className="w-4 h-4 text-amber-300" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-xs sm:text-sm font-bold text-white tracking-wide">
                      Logo &amp; Brand Watermark
                    </h4>
                    <span
                      className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${
                        activeLogoSettings.enabled && activeLogoSettings.file
                          ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 shadow-sm shadow-amber-500/10'
                          : activeLogoSettings.file
                          ? 'bg-slate-800 text-slate-400 border-slate-700'
                          : 'bg-slate-850 text-slate-500 border-slate-800'
                      }`}
                    >
                      {activeLogoSettings.enabled && activeLogoSettings.file
                        ? `Active (${activeLogoSettings.position})`
                        : activeLogoSettings.file
                        ? 'Disabled'
                        : 'No Logo'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 hidden sm:block">
                    Overlay your channel or brand logo in the video corner (adjustable in preview)
                  </p>
                </div>
              </div>

              {/* Master Toggle & Expand */}
              <div className="flex items-center gap-2">
                {activeLogoSettings.file ? (
                  <button
                    type="button"
                    onClick={() =>
                      updateLogo((prev) => ({ ...prev, enabled: !prev.enabled }))
                    }
                    className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md cursor-pointer ${
                      activeLogoSettings.enabled
                        ? 'bg-gradient-to-r from-amber-500 to-orange-600 text-white shadow-amber-500/25 hover:from-amber-400 hover:to-orange-500 scale-[1.02]'
                        : 'bg-slate-850 hover:bg-slate-800 text-slate-300 border border-slate-700 hover:text-white'
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full ${
                        activeLogoSettings.enabled ? 'bg-white animate-pulse' : 'bg-slate-500'
                      }`}
                    />
                    <span>{activeLogoSettings.enabled ? 'Logo ON' : 'Enable Logo'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 text-xs font-bold transition-all cursor-pointer shadow-sm active:scale-95"
                  >
                    <UploadCloud className="w-3.5 h-3.5" />
                    <span>Upload Logo</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setShowLogoControls((prev) => !prev)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  title={showLogoControls ? 'Collapse logo settings' : 'Expand logo settings'}
                >
                  {showLogoControls ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Hidden File Input */}
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleLogoUpload}
            />

            {/* Logo Settings Body */}
            {showLogoControls && (
              <div className="p-4 sm:p-5 border-t border-slate-800/80 bg-slate-900/60">
                {!activeLogoSettings.file ? (
                  /* Upload Dropzone */
                  <div
                    onClick={() => logoInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-700 hover:border-amber-500/60 bg-slate-950/40 hover:bg-slate-950/80 rounded-xl p-5 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
                  >
                    <div className="p-3 rounded-xl bg-amber-500/10 text-amber-400 group-hover:scale-110 transition-transform">
                      <UploadCloud className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs sm:text-sm font-semibold text-slate-200">
                        Click to select Channel / Brand Logo
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        PNG with transparent background, SVG, JPG or WebP. Defaults to top-right corner.
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Active Logo Controls */
                  <div className="space-y-4">
                    {/* Top Row: File Details & Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                      <div className="flex items-center gap-3 min-w-0">
                        {activeLogoSettings.previewUrl && (
                          <div className="w-12 h-12 rounded-lg bg-black/60 border border-slate-700 p-1 flex items-center justify-center shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={activeLogoSettings.previewUrl}
                              alt="Logo preview"
                              className="max-w-full max-h-full object-contain"
                            />
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-white truncate max-w-xs sm:max-w-sm">
                            {activeLogoSettings.name || 'Uploaded Logo'}
                          </p>
                          <p className="text-[10px] text-emerald-400 font-semibold flex items-center gap-1 mt-0.5">
                            <Check className="w-3 h-3" />
                            <span>Ready for video burn-in &amp; preview</span>
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => logoInputRef.current?.click()}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
                        >
                          Change
                        </button>
                        <button
                          type="button"
                          onClick={removeLogo}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-500/10 hover:bg-red-500/20 text-red-300 border border-red-500/30 transition-colors cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    {/* Grid: Position Selector & Sliders */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                      {/* Position Selector */}
                      <div className="space-y-2">
                        <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                          Watermark Position (Preview &amp; Video)
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                          {[
                            { id: 'top-right', label: 'Top-Right (Default)' },
                            { id: 'top-left', label: 'Top-Left' },
                            { id: 'bottom-right', label: 'Bottom-Right' },
                            { id: 'bottom-left', label: 'Bottom-Left' },
                          ].map((pos) => (
                            <button
                              key={pos.id}
                              type="button"
                              onClick={() =>
                                updateLogo((prev) => ({
                                  ...prev,
                                  position: pos.id as LogoPosition,
                                }))
                              }
                              className={`p-2 rounded-xl text-left font-semibold text-xs transition-all border cursor-pointer ${
                                activeLogoSettings.position === pos.id
                                  ? 'bg-amber-500/20 text-amber-200 border-amber-400 font-bold shadow-md shadow-amber-500/15 ring-1 ring-amber-400'
                                  : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:text-white hover:bg-slate-850'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span>{pos.label}</span>
                                {activeLogoSettings.position === pos.id && (
                                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shadow-sm shadow-amber-400" />
                                )}
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Scale & Opacity Sliders */}
                      <div className="space-y-3.5">
                        {/* Scale */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-medium">Logo Size:</span>
                            <span className="font-mono font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                              {activeLogoSettings.scale}% of video width
                            </span>
                          </div>
                          <input
                            type="range"
                            min="6"
                            max="30"
                            step="1"
                            value={activeLogoSettings.scale}
                            onChange={(e) =>
                              updateLogo((prev) => ({
                                ...prev,
                                scale: Number(e.target.value),
                              }))
                            }
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                          <div className="flex items-center gap-1.5">
                            {[10, 14, 18, 24].map((pct) => (
                              <button
                                key={pct}
                                type="button"
                                onClick={() =>
                                  updateLogo((prev) => ({ ...prev, scale: pct }))
                                }
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                  activeLogoSettings.scale === pct
                                    ? 'bg-amber-500 text-white font-bold'
                                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
                                }`}
                              >
                                {pct}%
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Opacity */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="text-slate-400 font-medium">Logo Opacity:</span>
                            <span className="font-mono font-bold text-amber-300 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/20">
                              {Math.round(activeLogoSettings.opacity * 100)}%
                            </span>
                          </div>
                          <input
                            type="range"
                            min="0.2"
                            max="1.0"
                            step="0.05"
                            value={activeLogoSettings.opacity}
                            onChange={(e) =>
                              updateLogo((prev) => ({
                                ...prev,
                                opacity: Number(e.target.value),
                              }))
                            }
                            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                          />
                          <div className="flex items-center gap-1.5">
                            {[0.5, 0.75, 0.9, 1.0].map((op) => (
                              <button
                                key={op}
                                type="button"
                                onClick={() =>
                                  updateLogo((prev) => ({ ...prev, opacity: op }))
                                }
                                className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                                  Math.abs(activeLogoSettings.opacity - op) < 0.03
                                    ? 'bg-amber-500 text-white font-bold'
                                    : 'bg-slate-950 text-slate-400 border border-slate-800 hover:text-white'
                                }`}
                              >
                                {Math.round(op * 100)}%
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Main Visual Display Frame */}
          <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black/95 border border-slate-800 shadow-2xl flex items-center justify-center group select-none">
            {!activeSlide?.image ? (
              <div className="text-center p-6 space-y-2">
                <AlertCircle className="w-10 h-10 text-red-400 mx-auto animate-pulse" />
                <p className="text-sm font-semibold text-slate-300">
                  Missing Image for Slide #{(activeSlideIndex + 1) || 1}
                </p>
                <p className="text-xs text-slate-500">
                  Upload an image in Step 1 to fill Paragraph #{activeSlideIndex + 1}
                </p>
              </div>
            ) : (
              // Fast crisp static image (zero overhead, max performance)
              // eslint-disable-next-line @next/next/no-img-element
              <img
                ref={previewImageRef}
                src={activeSlide.image.previewUrl}
                alt={activeSlide.image.name}
                className="w-full h-full object-contain select-none"
                style={{
                  transform: 'scale(1) translateZ(0)',
                  transformOrigin: 'center center',
                  willChange: 'transform',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                }}
              />
            )}

            {/* Live Brand Logo Watermark Overlay */}
            {activeLogoSettings.enabled && activeLogoSettings.previewUrl && (
              <div
                className={`absolute z-20 pointer-events-none transition-all duration-150 ${
                  activeLogoSettings.position === 'top-right'
                    ? 'top-3 right-3'
                    : activeLogoSettings.position === 'top-left'
                    ? 'top-3 left-3'
                    : activeLogoSettings.position === 'bottom-left'
                    ? 'bottom-10 sm:bottom-12 left-4'
                    : 'bottom-10 sm:bottom-12 right-4'
                }`}
                style={{
                  width: `${activeLogoSettings.scale}%`,
                  maxWidth: '35%',
                  minWidth: '40px',
                  opacity: activeLogoSettings.opacity,
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={activeLogoSettings.previewUrl}
                  alt={activeLogoSettings.name || 'Brand Logo'}
                  className="w-full h-auto object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.8)]"
                />
              </div>
            )}

            {/* Slide & Paragraph Index Badge Overlay */}
            <div
              className={`absolute top-3 transition-all ${
                activeLogoSettings.enabled &&
                activeLogoSettings.previewUrl &&
                activeLogoSettings.position === 'top-left'
                  ? 'left-24 sm:left-32'
                  : 'left-3'
              } flex items-center gap-2`}
            >
              <span className="px-3 py-1 rounded-xl bg-black/75 backdrop-blur-md border border-white/10 text-xs font-bold text-white shadow-lg flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                Slide {activeSlideIndex + 1} &bull; Paragraph {activeSlideIndex + 1}
              </span>
              {activeSlide?.image && (
                <span className="hidden sm:inline-block px-2.5 py-1 rounded-xl bg-black/60 backdrop-blur-md border border-white/10 text-[11px] font-medium text-slate-300 truncate max-w-[200px]">
                  {activeSlide.image.name}
                </span>
              )}
              {activeMotionSettings.zoomEnabled && activeSlide && (
                <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-violet-500/25 backdrop-blur-md border border-violet-400/40 text-[11px] font-mono font-bold text-violet-200 shadow-lg">
                  <Sparkles className="w-3 h-3 text-violet-300" />
                  <span>
                    {activeSlide.zoomDirection === 'out'
                      ? `${(100 + (activeMotionSettings.zoomIntensity || 2)).toFixed(0)}% → 100%`
                      : `100% → ${(100 + (activeMotionSettings.zoomIntensity || 2)).toFixed(0)}%`}
                  </span>
                </span>
              )}
            </div>

            {/* Current Slide Duration Badge */}
            {activeSlide && (
              <div
                className={`absolute top-3 transition-all ${
                  activeLogoSettings.enabled &&
                  activeLogoSettings.previewUrl &&
                  activeLogoSettings.position === 'top-right'
                    ? 'right-28 sm:right-36'
                    : 'right-3'
                }`}
              >
                <span className="px-3 py-1 rounded-xl bg-amber-500/20 backdrop-blur-md border border-amber-500/30 text-xs font-mono font-bold text-amber-300 shadow-lg">
                  {activeSlide.duration.toFixed(2)}s on screen
                </span>
              </div>
            )}

            {/* Real-Time Synced Subtitle Caption Overlay */}
            {showSubtitles && (
              <div className="absolute bottom-4 left-6 right-6 pointer-events-none flex justify-center">
                <div className="max-w-xl px-4 py-2 rounded-xl bg-black/85 backdrop-blur-lg border border-white/15 text-center shadow-2xl animate-fade-in">
                  <p className="text-xs sm:text-sm font-medium text-white tracking-wide leading-snug drop-shadow-md">
                    {activeCue ? (
                      activeCue.cleanText
                    ) : (
                      <span className="text-slate-400 italic text-xs">
                        &ldquo;{activeSlide?.triggerSentence || activeSlide?.paragraph.startingSentence}&rdquo;
                      </span>
                    )}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Real-time Playback Toolbar below viewport */}
          <div className="mt-4 flex flex-col sm:flex-row items-center justify-between gap-3 px-2">
            {/* Left: Timecode Display (updated directly without re-render) */}
            <div className="flex items-center gap-2">
              <div className="font-mono text-sm sm:text-base font-black px-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-sky-400 shadow-inner flex items-center gap-2">
                <Clock className="w-4 h-4 text-sky-400 shrink-0" />
                <span ref={timecodeRef}>{formatSecondsToTimestamp(currentTime)}</span>
                <span className="text-slate-600 font-normal">/</span>
                <span className="text-slate-400 text-xs font-normal">
                  {formatSecondsToTimestamp(safeTotalDuration)}
                </span>
              </div>
            </div>

            {/* Center: Play / Pause & Step Controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => seekTo(0)}
                type="button"
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                title="Rewind to start (00:00:00)"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                onClick={() => jumpToSlide(activeSlideIndex - 1)}
                disabled={activeSlideIndex <= 0}
                type="button"
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
                title="Previous Slide / Paragraph"
              >
                <SkipBack className="w-4 h-4" />
              </button>

              {/* Main Play / Pause Button */}
              <button
                onClick={() => {
                  setIsPlaying((prev) => {
                    if (!prev && audioRef.current && voiceoverUrl) {
                      audioRef.current.currentTime = currentTimeRef.current;
                    }
                    return !prev;
                  });
                }}
                type="button"
                className="p-3.5 rounded-2xl bg-gradient-to-tr from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white shadow-xl shadow-sky-500/25 transition-all hover:scale-105 active:scale-95 cursor-pointer"
                title="Play / Pause (Spacebar)"
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>

              <button
                onClick={() => jumpToSlide(activeSlideIndex + 1)}
                disabled={activeSlideIndex >= matches.length - 1}
                type="button"
                className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-30 transition-colors cursor-pointer"
                title="Next Slide / Paragraph"
              >
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Right: Playback Speed & Controls */}
            <div className="flex items-center gap-2">
              <div className="flex items-center rounded-xl bg-slate-950 border border-slate-800 p-0.5 text-xs font-semibold">
                {[1, 1.25, 1.5, 2].map((spd) => (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => setPlaybackSpeed(spd)}
                    className={`px-2 py-1 rounded-lg transition-all cursor-pointer ${
                      playbackSpeed === spd
                        ? 'bg-sky-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>

              {/* Subtitle overlay toggle */}
              <button
                onClick={() => setShowSubtitles(!showSubtitles)}
                type="button"
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  showSubtitles
                    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                    : 'bg-slate-950 text-slate-500 border-slate-800'
                }`}
                title="Toggle Subtitle Caption Overlay"
              >
                <Subtitles className="w-4 h-4" />
              </button>

              {/* Voiceover Audio Mute toggle */}
              {voiceoverUrl && (
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  type="button"
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    isMuted
                      ? 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                  }`}
                  title={isMuted ? 'Unmute Voiceover Audio' : 'Mute Voiceover Audio'}
                >
                  {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. TIMELINE CONTROLS & ZOOM SLIDER */}
      <div className="px-6 py-2.5 bg-slate-950/90 border-b border-slate-800/80 flex items-center justify-between gap-4 text-xs">
        <div className="flex items-center gap-3">
          <label
            htmlFor="timeline-scale"
            className="text-slate-400 font-bold uppercase tracking-wider text-[10px]"
          >
            Timeline Scale
          </label>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setZoomLevel((z) => Math.max(0.4, Number((z - 0.2).toFixed(1))))}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <input
              id="timeline-scale"
              type="range"
              min="0.4"
              max="2.5"
              step="0.1"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              aria-label="Timeline scale"
              className="w-24 h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
            />
            <button
              onClick={() => setZoomLevel((z) => Math.min(2.5, Number((z + 0.2).toFixed(1))))}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <span className="font-mono text-[11px] text-slate-400 w-10">
              {Math.round(zoomLevel * 100)}%
            </span>
          </div>

          {/* ⚡ Intelligent Auto-Sync Button */}
          {cues.length > 0 && matches.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const res = intelligentAutoSync(matches, cues, totalDuration);
                onUpdateMatches(res.optimizedMatches);
                setAutoSyncNotice(`⚡ Snapped ${res.optimizationsApplied} boundaries (${res.confidenceScore}% speech alignment)`);
                setTimeout(() => setAutoSyncNotice(null), 4000);
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono font-bold rounded-lg bg-gradient-to-r from-amber-500 via-rose-500 to-red-600 hover:from-amber-600 hover:to-red-700 text-white shadow-xs transition-all cursor-pointer active:scale-95"
              title="Intelligently calculate word tempo, silence pauses, and snap slide transitions to speech cues"
            >
              <Zap className="w-3.5 h-3.5 fill-current" />
              <span>⚡ Intelligent Auto-Sync</span>
            </button>
          )}

          {autoSyncNotice && (
            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-mono text-[10px] font-semibold animate-in fade-in duration-200">
              {autoSyncNotice}
            </span>
          )}
        </div>

        {/* Active Slide Timing Quick Tweak */}
        {activeSlide && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-white font-semibold text-[11px] bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
              Slide #{activeSlideIndex + 1} ({activeSlide.duration.toFixed(2)}s)
            </span>

            {/* Boundary nudge */}
            {activeSlideIndex > 0 && (
              <div className="flex items-center gap-1">
                <span className="text-slate-400 text-[11px]">Start:</span>
                <span className="font-mono text-[11px] text-sky-400 font-semibold mr-0.5">
                  {activeSlide.startTime.toFixed(2)}s
                </span>
                <button
                  type="button"
                  onClick={() => adjustSlideBoundary(activeSlideIndex, -0.1)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                  title="Shift start 0.1s earlier"
                >
                  -0.1s
                </button>
                <button
                  type="button"
                  onClick={() => adjustSlideBoundary(activeSlideIndex, 0.1)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                  title="Shift start 0.1s later"
                >
                  +0.1s
                </button>
              </div>
            )}

            {/* Duration nudge */}
            <div className="flex items-center gap-1">
              <span className="text-slate-400 text-[11px]">Duration:</span>
              <button
                type="button"
                onClick={() => adjustSlideDuration(activeSlideIndex, -0.1)}
                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                title="Reduce duration by 0.1s"
              >
                -0.1s
              </button>
              <button
                type="button"
                onClick={() => adjustSlideDuration(activeSlideIndex, 0.1)}
                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                title="Increase duration by 0.1s"
              >
                +0.1s
              </button>
              <button
                type="button"
                onClick={() => adjustSlideDuration(activeSlideIndex, -0.5)}
                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                title="Reduce duration by 0.5s"
              >
                -0.5s
              </button>
              <button
                type="button"
                onClick={() => adjustSlideDuration(activeSlideIndex, 0.5)}
                className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700/80 text-[10px] font-bold cursor-pointer"
                title="Increase duration by 0.5s"
              >
                +0.5s
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 3.5 SLIDE THUMBNAILS FILMSTRIP (HIGH-VISIBILITY GALLERY) */}
      {/* 3.5 SLIDE THUMBNAILS FILMSTRIP & LIST VIEW (HIGH-VISIBILITY GALLERY) */}
      {showFilmstrip && matches.length > 0 && (
        <div className="px-6 py-3 bg-slate-950/70 border-b border-slate-800/80">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-amber-400" />
                <span className="text-xs font-bold text-slate-300">
                  Slide Thumbnails ({matches.length} slides)
                </span>
              </div>

              {/* View Switcher: Horizontal Filmstrip vs Detailed List */}
              <div className="flex items-center border border-slate-800 rounded-lg overflow-hidden bg-slate-900 p-0.5 shadow-inner">
                <button
                  type="button"
                  onClick={() => setFilmstripViewMode('filmstrip')}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-semibold cursor-pointer transition-colors ${
                    filmstripViewMode === 'filmstrip'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Horizontal Filmstrip Gallery"
                >
                  <Film className="w-3 h-3" />
                  <span>Filmstrip</span>
                </button>
                <button
                  type="button"
                  onClick={() => setFilmstripViewMode('list')}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded font-semibold cursor-pointer transition-colors ${
                    filmstripViewMode === 'list'
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title="Detailed Slides List View"
                >
                  <List className="w-3 h-3" />
                  <span>List View</span>
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 hidden sm:inline">
                Click any slide to jump playhead &bull; Click eye to enlarge
              </span>
              <button
                type="button"
                onClick={() => setShowFilmstrip(false)}
                className="text-[11px] text-slate-400 hover:text-white px-2 py-0.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Hide
              </button>
            </div>
          </div>

          {filmstripViewMode === 'filmstrip' ? (
            /* Mode A: Horizontal Filmstrip */
            <div className="flex items-stretch gap-3 overflow-x-auto pb-2 pt-1 custom-scrollbar">
              {matches.map((match, idx) => {
                const isActive = idx === activeSlideIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedSlideIndex(idx);
                      seekTo(match.startTime);
                    }}
                    className={`group relative shrink-0 w-44 sm:w-52 rounded-xl border transition-all cursor-pointer overflow-hidden flex flex-col ${
                      isActive
                        ? 'border-amber-400 ring-2 ring-amber-400/40 bg-amber-950/20 shadow-lg shadow-amber-500/10'
                        : 'border-slate-800 hover:border-slate-600 bg-slate-900/60'
                    }`}
                  >
                    {/* Thumbnail Picture Container */}
                    <div className="relative aspect-video w-full bg-black/95 overflow-hidden flex items-center justify-center">
                      {match.image?.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={match.image.previewUrl}
                          alt={match.image.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="text-[10px] text-red-400 font-bold">No Image</div>
                      )}

                      {/* Slide Number Badge */}
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/85 backdrop-blur-sm text-[10px] font-bold text-white border border-white/10">
                        #{idx + 1}
                      </div>

                      {/* Duration Badge */}
                      <div className="absolute top-1 right-1 px-1.5 py-0.5 rounded bg-amber-500/80 backdrop-blur-sm text-[10px] font-mono font-bold text-black">
                        {match.duration.toFixed(1)}s
                      </div>

                      {/* Lightbox Trigger Icon on Hover */}
                      {match.image?.previewUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEnlargedImage({
                              url: match.image!.previewUrl,
                              name: match.image!.name,
                              slideIdx: idx,
                              duration: match.duration,
                              trigger: match.triggerSentence || match.paragraph.startingSentence,
                            });
                          }}
                          className="absolute bottom-1 right-1 p-1 rounded-lg bg-black/80 hover:bg-sky-600 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer shadow-md"
                          title="Enlarge preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    {/* Text details below thumbnail */}
                    <div className="p-2 flex flex-col justify-between flex-1 bg-slate-950/80">
                      <p className="text-[11px] font-medium text-slate-200 line-clamp-1 truncate">
                        {match.image?.name || `Slide ${idx + 1}`}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center justify-between">
                        <span>{match.startTime.toFixed(1)}s</span>
                        <span>&rarr;</span>
                        <span>{match.endTime.toFixed(1)}s</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* Mode B: Detailed Vertical Sequence List */
            <div className="flex flex-col gap-2 max-h-64 overflow-y-auto p-1 bg-slate-900/60 rounded-xl border border-slate-800/80 custom-scrollbar">
              {matches.map((match, idx) => {
                const isActive = idx === activeSlideIndex;
                return (
                  <div
                    key={idx}
                    onClick={() => {
                      setSelectedSlideIndex(idx);
                      seekTo(match.startTime);
                    }}
                    className={`group relative flex items-center justify-between gap-3 p-2 rounded-xl border transition-all cursor-pointer ${
                      isActive
                        ? 'border-amber-400 ring-1 ring-amber-400/40 bg-amber-950/20'
                        : 'border-slate-800 hover:border-slate-700 bg-slate-950/80'
                    }`}
                  >
                    {/* Left: Large Thumbnail */}
                    <div
                      className="relative aspect-video w-36 sm:w-44 rounded-lg bg-black/95 overflow-hidden shrink-0 cursor-pointer shadow-xs border border-slate-800"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (match.image?.previewUrl) {
                          setEnlargedImage({
                            url: match.image.previewUrl,
                            name: match.image.name,
                            slideIdx: idx,
                            duration: match.duration,
                            trigger: match.triggerSentence || match.paragraph.startingSentence,
                          });
                        }
                      }}
                    >
                      {match.image?.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={match.image.previewUrl}
                          alt={match.image.name}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                        />
                      ) : (
                        <div className="text-[10px] text-red-400 font-bold flex items-center justify-center h-full">
                          No Image
                        </div>
                      )}
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/85 text-white font-mono text-[10px] font-bold border border-white/10">
                        #{idx + 1}
                      </div>
                    </div>

                    {/* Middle: Timing & Script Trigger */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white truncate max-w-xs">
                          {match.image?.name || `Slide ${idx + 1}`}
                        </span>
                        <span className="px-2 py-0.2 rounded font-mono text-[10px] font-bold bg-amber-500/10 text-amber-300 border border-amber-500/20">
                          {match.duration.toFixed(2)}s
                        </span>
                        <span className="font-mono text-[10px] text-slate-400">
                          {match.startTime.toFixed(1)}s &rarr; {match.endTime.toFixed(1)}s
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 font-sans truncate">
                        &ldquo;{match.triggerSentence || match.paragraph.startingSentence || match.paragraph.text.slice(0, 60)}&rdquo;
                      </p>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-2 shrink-0 pr-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          seekTo(match.startTime);
                        }}
                        className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-sky-500/15 hover:bg-sky-500/25 text-sky-300 border border-sky-500/30 cursor-pointer"
                      >
                        Jump To
                      </button>
                      {match.image?.previewUrl && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setEnlargedImage({
                              url: match.image!.previewUrl,
                              name: match.image!.name,
                              slideIdx: idx,
                              duration: match.duration,
                              trigger: match.triggerSentence || match.paragraph.startingSentence,
                            });
                          }}
                          className="p-1 rounded-lg border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white cursor-pointer"
                          title="Enlarge preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 4. MULTI-TRACK INTERACTIVE TIMELINE WORKSPACE */}
      <div
        ref={timelineScrollRef}
        className="relative overflow-x-auto overflow-y-hidden bg-[#060910] select-none p-4 custom-scrollbar"
        style={{ minHeight: '260px' }}
      >
        <div
          ref={timelineTracksRef}
          className="relative"
          style={{ width: `${timelineWidth}px` }}
          onMouseDown={handleTimelineMouseDown}
        >
          {/* RULER TRACK (Time Markings) */}
          <div className="h-7 relative border-b border-slate-800 flex items-center cursor-pointer">
            {rulerTicks.map((sec) => {
              const leftPos = sec * pps;
              return (
                <div
                  key={sec}
                  className="absolute flex flex-col items-center pointer-events-none"
                  style={{ left: `${leftPos}px` }}
                >
                  <span className="font-mono text-[10px] text-slate-400 -translate-x-1/2">
                    {formatSecondsToTimestamp(sec).slice(3)}
                  </span>
                  <div className="w-[1px] h-2 bg-slate-700 mt-0.5" />
                </div>
              );
            })}
          </div>

          {/* TRACK 1: SLIDES / PARAGRAPH IMAGES CLIPS TRACK */}
          <div className="relative my-3 h-28 flex items-center">
            {matches.map((match, idx) => {
              const left = match.startTime * pps;
              const width = Math.max(36, match.duration * pps);
              const isActive = idx === activeSlideIndex;
              const isSelected = idx === selectedSlideIndex;

              return (
                <div
                  key={idx}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedSlideIndex(idx);
                    seekTo(match.startTime);
                  }}
                  className={`absolute h-26 rounded-xl border transition-all duration-150 overflow-hidden flex flex-col justify-between group cursor-pointer ${
                    isActive
                      ? 'ring-2 ring-sky-400 border-sky-400 bg-sky-950/40 shadow-xl shadow-sky-500/20 z-10'
                      : isSelected
                      ? 'border-indigo-400 bg-indigo-950/30 ring-1 ring-indigo-400 z-10'
                      : 'border-slate-800 bg-slate-900/80 hover:border-slate-700'
                  }`}
                  style={{
                    left: `${left}px`,
                    width: `${width}px`,
                  }}
                >
                  {/* Slide Top Details */}
                  <div className="p-1.5 flex items-center justify-between gap-1 bg-black/50 backdrop-blur-sm border-b border-white/5">
                    <div className="flex items-center gap-1 min-w-0">
                      <span className="px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-300 font-bold text-[10px]">
                        #{idx + 1}
                      </span>
                      <span className="text-[10px] text-white font-medium truncate">
                        {match.image?.name || `Slide ${idx + 1}`}
                      </span>
                    </div>

                    <span className="font-mono text-[10px] text-amber-300 font-bold shrink-0 bg-amber-500/10 px-1 rounded">
                      {match.duration.toFixed(1)}s
                    </span>
                  </div>

                  {/* Thumbnail & Trigger Preview */}
                  <div className="flex-1 relative flex items-center justify-center overflow-hidden bg-black/80">
                    {match.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={match.image.previewUrl}
                        alt={match.image.name}
                        className="w-full h-full object-cover rounded opacity-100 brightness-105 group-hover:scale-105 transition-all duration-150"
                      />
                    ) : (
                      <span className="text-[10px] text-red-400 font-bold">No Image</span>
                    )}

                    {/* Quick Lightbox Enlarge button on hover */}
                    {match.image && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEnlargedImage({
                            url: match.image!.previewUrl,
                            name: match.image!.name,
                            slideIdx: idx,
                            duration: match.duration,
                            trigger: match.triggerSentence || match.paragraph.startingSentence,
                          });
                        }}
                        className="absolute bottom-1 right-1 p-1 rounded-md bg-black/80 hover:bg-sky-500 text-white opacity-0 group-hover:opacity-100 transition-opacity z-10 cursor-pointer shadow-md"
                        title="Enlarge slide thumbnail"
                      >
                        <Eye className="w-3 h-3" />
                      </button>
                    )}

                    {/* Script Excerpt Tooltip */}
                    <div className="absolute inset-0 bg-black/85 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-center p-2 text-center pointer-events-none">
                      <span className="text-[9px] text-sky-300 font-bold mb-0.5 truncate">
                        Trigger: &ldquo;{match.triggerSentence || match.paragraph.startingSentence}&rdquo;
                      </span>
                      <p className="text-[10px] text-slate-200 line-clamp-2">
                        {match.paragraph.text}
                      </p>
                    </div>
                  </div>

                  {/* Slide Bottom Timestamps */}
                  <div className="px-1.5 py-0.5 bg-black/60 text-[9px] font-mono text-slate-400 flex items-center justify-between">
                    <span>{match.startTime.toFixed(1)}s</span>
                    <span className="text-sky-300/80 hidden sm:inline truncate max-w-[90px]">
                      {match.triggerSentence ? match.triggerSentence.slice(0, 15) + '...' : ''}
                    </span>
                    <span>{match.endTime.toFixed(1)}s</span>
                  </div>

                  {/* Left Trimming Edge Handle */}
                  {idx > 0 && (
                    <div
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setDraggingHandle({
                          slideIndex: idx,
                          edge: 'start',
                          startX: e.clientX,
                          initialStartTime: match.startTime,
                          initialEndTime: match.endTime,
                        });
                      }}
                      className="absolute left-0 top-0 bottom-0 w-2.5 bg-sky-500/0 hover:bg-sky-400/80 cursor-ew-resize group-hover:bg-sky-500/30 transition-all flex items-center justify-center z-20"
                      title="Drag left edge to trim start time"
                    >
                      <div className="w-[2px] h-6 bg-white/70 rounded-full" />
                    </div>
                  )}

                  {/* Right Trimming Edge Handle */}
                  <div
                    onMouseDown={(e) => {
                      e.stopPropagation();
                      setDraggingHandle({
                        slideIndex: idx,
                        edge: 'end',
                        startX: e.clientX,
                        initialStartTime: match.startTime,
                        initialEndTime: match.endTime,
                      });
                    }}
                    className="absolute right-0 top-0 bottom-0 w-2.5 bg-sky-500/0 hover:bg-sky-400/80 cursor-ew-resize group-hover:bg-sky-500/30 transition-all flex items-center justify-center z-20"
                    title="Drag right edge to trim slide duration"
                  >
                    <div className="w-[2px] h-6 bg-white/70 rounded-full" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* TRACK 2: SCRIPT PARAGRAPH MARKERS TRACK */}
          {showParagraphsTrack && matches.length > 0 && (
            <div className="relative h-11 border-t border-slate-800/80 my-2 pt-1.5">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                <FileText className="w-3 h-3 text-indigo-400" />
                <span>Script Paragraphs Track</span>
              </div>

              {matches.map((m, pIdx) => {
                const left = m.startTime * pps;
                const width = Math.max(30, m.duration * pps);
                const isParaActive = currentTime >= m.startTime && currentTime < m.endTime;

                return (
                  <div
                    key={pIdx}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(m.startTime);
                    }}
                    className={`absolute h-6 rounded-lg px-2 text-[10px] truncate border cursor-pointer transition-all flex items-center gap-1.5 ${
                      isParaActive
                        ? 'bg-indigo-500/30 text-white border-indigo-400 font-semibold ring-1 ring-indigo-400'
                        : 'bg-indigo-950/20 text-indigo-200/80 border-indigo-800/40 hover:bg-indigo-900/40'
                    }`}
                    style={{
                      left: `${left}px`,
                      width: `${width}px`,
                      top: '18px',
                    }}
                    title={`Paragraph ${pIdx + 1}: ${m.paragraph.text}`}
                  >
                    <span className="font-bold text-indigo-400">P#{pIdx + 1}</span>
                    <span className="truncate">&ldquo;{m.triggerSentence || m.paragraph.startingSentence}&rdquo;</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* TRACK 3: SUBTITLES / VTT CUES TRACK */}
          {showCuesTrack && cues.length > 0 && (
            <div className="relative h-12 border-t border-slate-800/80 my-2 pt-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
                <Subtitles className="w-3 h-3 text-purple-400" />
                <span>VTT Subtitle Speech Cues</span>
              </div>

              {cues.map((cue, cIdx) => {
                const left = cue.startTime * pps;
                const width = Math.max(20, (cue.endTime - cue.startTime) * pps);
                const isCueActive = currentTime >= cue.startTime && currentTime <= cue.endTime;

                return (
                  <div
                    key={cIdx}
                    onClick={(e) => {
                      e.stopPropagation();
                      seekTo(cue.startTime);
                    }}
                    className={`absolute h-7 rounded-lg px-1.5 py-0.5 text-[10px] truncate border cursor-pointer transition-all ${
                      isCueActive
                        ? 'bg-purple-500/40 text-white border-purple-400 font-semibold shadow-md shadow-purple-500/20 ring-1 ring-purple-400'
                        : 'bg-purple-950/30 text-purple-200/80 border-purple-800/40 hover:bg-purple-900/40'
                    }`}
                    style={{
                      left: `${left}px`,
                      width: `${width}px`,
                      top: '20px',
                    }}
                    title={`[${formatSecondsToTimestamp(cue.startTime)} - ${formatSecondsToTimestamp(cue.endTime)}]: ${cue.cleanText}`}
                  >
                    {cue.cleanText}
                  </div>
                );
              })}
            </div>
          )}

          {/* TRACK 4: VOICEOVER AUDIO TRACK */}
          {voiceoverUrl && (
            <div className="relative h-12 border-t border-slate-800/80 my-2 pt-2">
              <div className="text-[9px] font-bold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1.5">
                <Volume2 className="w-3 h-3 text-emerald-400" />
                <span>Voiceover Audio Track</span>
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Synced
                </span>
              </div>
              <div
                className="absolute h-6 rounded-lg px-2 text-[10px] border border-emerald-500/30 bg-emerald-950/40 text-emerald-200 flex items-center gap-2 overflow-hidden shadow-sm"
                style={{
                  left: 0,
                  width: `${Math.max(100, safeTotalDuration * pps)}px`,
                  top: '20px',
                }}
              >
                <Volume2 className="w-3 h-3 text-emerald-400 shrink-0" />
                <div className="flex-1 flex items-center gap-1 h-3 opacity-60">
                  {Array.from({ length: 48 }).map((_, i) => (
                    <div
                      key={i}
                      className="w-1 bg-emerald-400 rounded-full"
                      style={{
                        height: `${Math.max(20, Math.sin(i * 0.6) * 50 + 50)}%`,
                      }}
                    />
                  ))}
                </div>
                <span className="text-[9px] font-mono text-emerald-300/80 shrink-0">
                  {formatSecondsToTimestamp(safeTotalDuration)}
                </span>
              </div>
            </div>
          )}

          {/* 5. INTERACTIVE RED/CYAN PLAYHEAD (Vertical Cursor with Direct Ref Transformation) */}
          <div
            ref={playheadRef}
            className="absolute top-0 bottom-0 pointer-events-none z-30 will-change-transform"
            style={{
              left: 0,
              transform: `translateX(${currentTime * pps}px)`,
            }}
          >
            {/* Playhead Scrubber Top Handle */}
            <div className="w-4 h-4 bg-gradient-to-b from-sky-400 to-indigo-500 rounded-b-md shadow-lg shadow-sky-500/50 flex items-center justify-center -translate-x-1/2 border border-white/80">
              <div className="w-1 h-1 bg-white rounded-full" />
            </div>

            {/* Glowing Vertical Line */}
            <div className="w-[2px] h-full bg-sky-400 shadow-[0_0_8px_rgba(56,189,248,0.8)] -translate-x-1/2" />
          </div>
        </div>
      </div>

      {/* Word-to-Frame Interactive Linker Modal */}
      <WordToFrameConnector
        isOpen={isWordLinkerOpen}
        onClose={() => setIsWordLinkerOpen(false)}
        matches={matches}
        cues={cues}
        paragraphs={paragraphs && paragraphs.length > 0 ? paragraphs : matches.map((m) => m.paragraph)}
        images={images && images.length > 0 ? images : (matches.map((m) => m.image).filter(Boolean) as ImageItem[])}
        voiceoverUrl={voiceoverUrl}
        totalDuration={totalDuration}
        onApplyMatches={(updatedMatches) => {
          onUpdateMatches(updatedMatches);
        }}
      />

      {/* High-Resolution Image Preview Lightbox Modal */}
      {enlargedImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex items-center justify-center p-4"
          onClick={() => setEnlargedImage(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 bg-slate-950 border-b border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-amber-400">Slide #{enlargedImage.slideIdx + 1}</span>
                <span className="text-slate-400 font-mono">({enlargedImage.duration.toFixed(2)}s)</span>
                <span className="text-white font-medium truncate max-w-xs sm:max-w-md">{enlargedImage.name}</span>
              </div>
              <button
                type="button"
                onClick={() => setEnlargedImage(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-3 bg-black flex items-center justify-center max-h-[75vh] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={enlargedImage.url}
                alt={enlargedImage.name}
                className="max-h-[70vh] w-auto object-contain rounded-lg shadow-lg"
              />
            </div>
            {enlargedImage.trigger && (
              <div className="px-4 py-2 bg-slate-950/80 border-t border-slate-800 text-xs text-slate-300">
                <span className="text-amber-400 font-bold mr-1.5">Trigger:</span>
                &ldquo;{enlargedImage.trigger}&rdquo;
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
