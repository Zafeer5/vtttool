'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Sparkles,
  ImageIcon,
} from 'lucide-react';
import { SyncMatch, VttCue } from '@/lib/types';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';

interface ProMultiTrackTimelineProps {
  matches: SyncMatch[];
  cues: VttCue[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  isPlaying: boolean;
  onTogglePlay: () => void;
  activeSlideIndex: number;
  onSelectSlide: (index: number) => void;
  onUpdateMatches: (updatedMatches: SyncMatch[]) => void;
  onAutoSyncOptimize?: () => void;
}

export const ProMultiTrackTimeline: React.FC<ProMultiTrackTimelineProps> = ({
  matches,
  cues,
  totalDuration,
  currentTime,
  onSeek,
  isPlaying,
  onTogglePlay,
  activeSlideIndex,
  onSelectSlide,
  onUpdateMatches,
  onAutoSyncOptimize,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(35); // Pixels per second
  const [isSnappingEnabled, setIsSnappingEnabled] = useState<boolean>(true);
  const [_resizingSlideIdx, setResizingSlideIdx] = useState<number | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const trackScrollRef = useRef<HTMLDivElement | null>(null);

  const effectiveDuration = Math.max(totalDuration || 1, 10);
  const timelinePixelWidth = Math.max(1200, effectiveDuration * zoomLevel);

  // Auto-scroll timeline to follow playhead when playing
  useEffect(() => {
    if (!isPlaying || !trackScrollRef.current) return;
    const playheadPx = currentTime * zoomLevel;
    const scrollLeft = trackScrollRef.current.scrollLeft;
    const clientWidth = trackScrollRef.current.clientWidth;

    if (playheadPx > scrollLeft + clientWidth - 100 || playheadPx < scrollLeft) {
      trackScrollRef.current.scrollLeft = Math.max(0, playheadPx - clientWidth / 3);
    }
  }, [currentTime, isPlaying, zoomLevel]);

  // Handle timeline ruler / track click to seek
  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const targetTime = Math.max(0, Math.min(effectiveDuration, clickX / zoomLevel));
    onSeek(targetTime);
  };

  // Zoom controls
  const handleZoomIn = () => setZoomLevel((prev) => Math.min(120, prev * 1.25));
  const handleZoomOut = () => setZoomLevel((prev) => Math.max(12, prev / 1.25));
  const handleFitToProject = () => {
    if (!trackScrollRef.current) return;
    const visibleWidth = trackScrollRef.current.clientWidth - 40;
    const newZoom = Math.max(12, Math.min(100, visibleWidth / effectiveDuration));
    setZoomLevel(newZoom);
  };

  // Drag-to-resize slide duration handle
  const handleStartResize = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setResizingSlideIdx(index);

    const startX = e.clientX;
    const initialDuration = matches[index].duration;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaPx = moveEvent.clientX - startX;
      let newDuration = Math.max(0.3, initialDuration + deltaPx / zoomLevel);

      // Snap to nearby cue ends if snapping is enabled
      if (isSnappingEnabled && cues.length > 0) {
        const slideEnd = matches[index].startTime + newDuration;
        for (const cue of cues) {
          if (Math.abs(cue.endTime - slideEnd) < 0.25) {
            newDuration = Math.max(0.3, cue.endTime - matches[index].startTime);
            break;
          }
        }
      }

      const cleanDur = Number(newDuration.toFixed(3));
      const diff = cleanDur - matches[index].duration;

      const updated = matches.map((m) => ({ ...m }));
      updated[index].duration = cleanDur;
      updated[index].endTime = Number((updated[index].startTime + cleanDur).toFixed(3));
      updated[index].isManualEdit = true;
      updated[index].status = 'confirmed';

      if (diff !== 0 && index < updated.length - 1) {
        for (let j = index + 1; j < updated.length; j++) {
          updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
          updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
        }
      }

      onUpdateMatches(updated);
    };

    const onMouseUp = () => {
      setResizingSlideIdx(null);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // Time ruler tick marks
  const tickInterval = zoomLevel > 50 ? 1 : zoomLevel > 25 ? 2 : 5;
  const tickCount = Math.ceil(effectiveDuration / tickInterval);
  const ticks = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i <= tickCount; i++) {
      list.push(i * tickInterval);
    }
    return list;
  }, [tickCount, tickInterval]);

  return (
    <div
      ref={containerRef}
      className="h-64 border-t border-slate-200 bg-white flex flex-col text-slate-900 select-none min-w-0 shrink-0 shadow-xs"
    >
      {/* TIMELINE TOOLBAR */}
      <div className="h-9 px-3 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-3 shrink-0">
        {/* Left: Playback & Auto Sync */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="p-1 rounded-md bg-orange-600 hover:bg-orange-700 text-white shadow-xs transition cursor-pointer"
            title="Play / Pause"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-white" /> : <Play className="w-3.5 h-3.5 fill-white" />}
          </button>

          <div className="h-4 w-px bg-slate-200" />

          {/* Snapping Toggle */}
          <button
            type="button"
            onClick={() => setIsSnappingEnabled(!isSnappingEnabled)}
            className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              isSnappingEnabled
                ? 'bg-orange-50 text-orange-700 border border-orange-200 font-bold'
                : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
            }`}
            title="Snap cuts to subtitle speech cues"
          >
            <Magnet className="w-3 h-3 text-orange-600" />
            <span>Snap Cues</span>
          </button>

          {/* Auto-Sync Silence Snapping */}
          {onAutoSyncOptimize && (
            <button
              type="button"
              onClick={onAutoSyncOptimize}
              className="px-2 py-1 rounded text-[10px] font-semibold bg-white hover:bg-orange-50 text-orange-700 border border-slate-200 hover:border-orange-200 flex items-center gap-1 transition cursor-pointer shadow-2xs"
              title="Snap slide cuts to natural voiceover silence pauses"
            >
              <Sparkles className="w-3 h-3 text-orange-600" />
              <span>Snap Silences</span>
            </button>
          )}
        </div>

        {/* Center: Track Legend */}
        <div className="hidden md:flex items-center gap-3 text-[10px] text-slate-500 font-mono font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-orange-500" /> Slides
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-amber-500" /> Script
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-rose-500" /> Subtitles
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-slate-400" /> Waveform
          </span>
        </div>

        {/* Right: Zoom & Fit */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-[10px] font-mono text-slate-500 px-1">{zoomLevel}px/s</span>

          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleFitToProject}
            className="p-1 rounded text-slate-500 hover:text-slate-900 hover:bg-slate-200/60 transition cursor-pointer ml-1"
            title="Fit to Project Width (0)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* MULTI-TRACK SCROLL AREA */}
      <div ref={trackScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative bg-slate-50">
        <div style={{ width: `${timelinePixelWidth}px` }} className="relative h-full flex flex-col">
          {/* TRACK 0: TIME RULER */}
          <div
            onClick={handleTimelineClick}
            className="h-6 border-b border-slate-200 bg-slate-100/70 relative cursor-pointer"
          >
            {ticks.map((t) => (
              <div
                key={t}
                style={{ left: `${t * zoomLevel}px` }}
                className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
              >
                <span className="text-[9px] font-mono text-slate-500 pl-1 font-semibold">{formatSecondsToTimestamp(t)}</span>
                <div className="w-px h-1.5 bg-slate-300" />
              </div>
            ))}
          </div>

          {/* TRACK 1: VISUAL SLIDES */}
          <div className="h-16 border-b border-slate-200 bg-white relative flex items-center p-1">
            {matches.map((m, idx) => {
              const leftPx = m.startTime * zoomLevel;
              const widthPx = Math.max(30, m.duration * zoomLevel);
              const isSelected = idx === activeSlideIndex;
              const hasImage = !!m.image;

              return (
                <div
                  key={m.id || idx}
                  onClick={() => {
                    onSelectSlide(idx);
                    onSeek(m.startTime);
                  }}
                  style={{
                    left: `${leftPx}px`,
                    width: `${widthPx}px`,
                  }}
                  className={`absolute top-1 bottom-1 rounded-lg border overflow-hidden flex items-center justify-between p-1 transition cursor-pointer ${
                    isSelected
                      ? 'border-orange-500 ring-2 ring-orange-500/40 bg-orange-50/80 z-10 shadow-xs'
                      : hasImage
                      ? 'border-slate-200 bg-white hover:border-slate-400 hover:shadow-xs'
                      : 'border-amber-300 bg-amber-50'
                  }`}
                >
                  {/* Left: Thumbnail & Index */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {hasImage ? (
                      <img src={m.image!.previewUrl} alt={m.image!.name} className="w-8 h-8 rounded object-cover shrink-0 border border-slate-200" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono font-bold text-slate-800 block leading-tight">
                        Slide {idx + 1}
                      </span>
                      <span className="text-[9px] font-mono text-orange-600 font-bold block">{m.duration.toFixed(1)}s</span>
                    </div>
                  </div>

                  {/* Right Drag Handle for resizing duration */}
                  <div
                    onMouseDown={(e) => handleStartResize(e, idx)}
                    className="w-2.5 h-full hover:bg-orange-500/30 transition cursor-ew-resize rounded-r flex items-center justify-center shrink-0"
                    title="Drag to adjust slide duration"
                  >
                    <div className="w-0.5 h-4 bg-slate-300 hover:bg-orange-500" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* TRACK 2: SCRIPT PARAGRAPHS */}
          <div className="h-7 border-b border-slate-200 bg-slate-50/80 relative">
            {matches.map((m, idx) => {
              const leftPx = m.startTime * zoomLevel;
              const widthPx = Math.max(30, m.duration * zoomLevel);
              return (
                <div
                  key={idx}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  className="absolute top-0.5 bottom-0.5 rounded bg-amber-50 border border-amber-200 px-1.5 flex items-center overflow-hidden shadow-2xs"
                  title={m.paragraph?.text}
                >
                  <span className="text-[9px] text-amber-900 truncate font-sans font-medium">
                    {m.paragraph?.text || m.searchPhrase}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 3: SUBTITLE CUES */}
          <div className="h-7 border-b border-slate-200 bg-white relative">
            {cues.map((c, idx) => {
              const leftPx = c.startTime * zoomLevel;
              const widthPx = Math.max(12, c.duration * zoomLevel);
              return (
                <div
                  key={idx}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  className="absolute top-0.5 bottom-0.5 rounded bg-rose-50 border border-rose-200 px-1 flex items-center overflow-hidden shadow-2xs"
                  title={`${formatSecondsToTimestamp(c.startTime)} - ${c.text}`}
                >
                  <span className="text-[9px] text-rose-900 truncate font-mono font-medium">
                    {c.cleanText || c.text}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 4: AUDIO WAVEFORM */}
          <div
            onClick={handleTimelineClick}
            className="h-10 bg-slate-50 relative flex items-center cursor-pointer"
          >
            {/* Visual simulated waveform bars */}
            <div className="w-full h-full flex items-center opacity-40 gap-1 px-1 pointer-events-none">
              {Array.from({ length: Math.ceil(timelinePixelWidth / 8) }).map((_, i) => {
                const heightPct = 20 + Math.sin(i * 0.4) * 35 + Math.cos(i * 0.15) * 25;
                return (
                  <div
                    key={i}
                    style={{ height: `${Math.max(15, Math.min(95, heightPct))}%` }}
                    className="w-1 bg-orange-500 rounded-full shrink-0"
                  />
                );
              })}
            </div>
          </div>

          {/* PLAYHEAD (Spans all tracks) */}
          <div
            style={{ left: `${currentTime * zoomLevel}px` }}
            className="absolute top-0 bottom-0 w-0.5 bg-orange-600 pointer-events-none z-30 shadow-[0_0_10px_rgba(234,88,12,0.8)]"
          >
            {/* Playhead Top Knob */}
            <div className="w-3.5 h-3.5 -ml-1.5 -top-1 absolute bg-orange-600 rotate-45 rounded-xs shadow-md" />
          </div>
        </div>
      </div>
    </div>
  );
};
