'use client';

import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Magnet,
  Sparkles,
  Layers,
  Clock,
  ChevronLeft,
  ChevronRight,
  ImageIcon,
  FileText,
  Subtitles,
  Music,
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
  const [resizingSlideIdx, setResizingSlideIdx] = useState<number | null>(null);

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
      let deltaSeconds = deltaPx / zoomLevel;

      // Snapping to subtitle cues
      if (isSnappingEnabled) {
        const candidateEnd = matches[index].startTime + initialDuration + deltaSeconds;
        for (const cue of cues) {
          if (Math.abs(cue.startTime - candidateEnd) < 0.25) {
            deltaSeconds = cue.startTime - (matches[index].startTime + initialDuration);
            break;
          }
        }
      }

      const newDur = Math.max(0.3, initialDuration + deltaSeconds);

      // Re-quantize and adjust subsequent slides
      const updated = matches.map((m) => ({ ...m }));
      const diff = newDur - updated[index].duration;
      updated[index].duration = Number(newDur.toFixed(3));
      updated[index].endTime = Number((updated[index].startTime + newDur).toFixed(3));
      updated[index].isManualEdit = true;
      updated[index].status = 'confirmed';

      for (let j = index + 1; j < updated.length; j++) {
        updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
        updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
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
      className="h-64 border-t border-[#2B3947] bg-[#111821] flex flex-col text-[#F1F5F9] select-none min-w-0 shrink-0"
    >
      {/* TIMELINE TOOLBAR */}
      <div className="h-9 px-3 border-b border-[#2B3947] bg-[#18222D] flex items-center justify-between gap-3 shrink-0">
        {/* Left: Playback & Auto Sync */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onTogglePlay}
            className="p-1 rounded-md bg-[#2DD4BF] hover:bg-[#5EEAD4] text-[#0B0F14] transition cursor-pointer"
            title="Play / Pause"
          >
            {isPlaying ? <Pause className="w-3.5 h-3.5 fill-[#0B0F14]" /> : <Play className="w-3.5 h-3.5 fill-[#0B0F14]" />}
          </button>

          <div className="h-4 w-px bg-[#2B3947]" />

          {/* Snapping Toggle */}
          <button
            type="button"
            onClick={() => setIsSnappingEnabled(!isSnappingEnabled)}
            className={`px-2 py-1 rounded text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              isSnappingEnabled
                ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/40'
                : 'bg-[#202C38] text-[#748396] hover:text-[#A4B1C0]'
            }`}
            title="Snap cuts to subtitle speech cues"
          >
            <Magnet className="w-3 h-3" />
            <span>Snap Cues</span>
          </button>

          {/* Auto-Sync Silence Snapping */}
          {onAutoSyncOptimize && (
            <button
              type="button"
              onClick={onAutoSyncOptimize}
              className="px-2 py-1 rounded text-[10px] font-semibold bg-[#202C38] hover:bg-[#2B3947] text-[#2DD4BF] border border-[#2B3947] flex items-center gap-1 transition cursor-pointer"
              title="Snap slide cuts to natural voiceover silence pauses"
            >
              <Sparkles className="w-3 h-3" />
              <span>Snap Silences</span>
            </button>
          )}
        </div>

        {/* Center: Track Legend */}
        <div className="hidden md:flex items-center gap-3 text-[10px] text-[#A4B1C0] font-mono">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-[#2DD4BF]" /> Slides
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-sky-400" /> Script
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-indigo-400" /> Subtitles
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded bg-[#748396]" /> Waveform
          </span>
        </div>

        {/* Right: Zoom & Fit */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleZoomOut}
            className="p-1 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#202C38] transition cursor-pointer"
            title="Zoom Out (-)"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>

          <span className="text-[10px] font-mono text-[#748396] px-1">{zoomLevel}px/s</span>

          <button
            type="button"
            onClick={handleZoomIn}
            className="p-1 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#202C38] transition cursor-pointer"
            title="Zoom In (+)"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleFitToProject}
            className="p-1 rounded text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#202C38] transition cursor-pointer ml-1"
            title="Fit to Project Width (0)"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* MULTI-TRACK SCROLL AREA */}
      <div ref={trackScrollRef} className="flex-1 overflow-x-auto overflow-y-hidden relative bg-[#0B0F14]">
        <div style={{ width: `${timelinePixelWidth}px` }} className="relative h-full flex flex-col">
          {/* TRACK 0: TIME RULER */}
          <div
            onClick={handleTimelineClick}
            className="h-6 border-b border-[#2B3947] bg-[#111821] relative cursor-pointer"
          >
            {ticks.map((t) => (
              <div
                key={t}
                style={{ left: `${t * zoomLevel}px` }}
                className="absolute top-0 bottom-0 flex flex-col justify-between pointer-events-none"
              >
                <span className="text-[9px] font-mono text-[#748396] pl-1">{formatSecondsToTimestamp(t)}</span>
                <div className="w-px h-1.5 bg-[#2B3947]" />
              </div>
            ))}
          </div>

          {/* TRACK 1: VISUAL SLIDES */}
          <div className="h-16 border-b border-[#2B3947] bg-[#111821]/80 relative flex items-center p-1">
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
                      ? 'border-[#2DD4BF] ring-2 ring-[#2DD4BF]/50 bg-[#2DD4BF]/15 z-10'
                      : hasImage
                      ? 'border-[#2B3947] bg-[#18222D] hover:border-[#748396]'
                      : 'border-amber-500/40 bg-amber-500/10'
                  }`}
                >
                  {/* Left: Thumbnail & Index */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    {hasImage ? (
                      <img src={m.image!.previewUrl} alt={m.image!.name} className="w-8 h-8 rounded object-cover shrink-0" />
                    ) : (
                      <div className="w-8 h-8 rounded bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )}
                    <div className="min-w-0">
                      <span className="text-[10px] font-mono font-bold text-[#F1F5F9] block leading-tight">
                        Slide {idx + 1}
                      </span>
                      <span className="text-[9px] font-mono text-[#2DD4BF] block">{m.duration.toFixed(1)}s</span>
                    </div>
                  </div>

                  {/* Right Drag Handle for resizing duration */}
                  <div
                    onMouseDown={(e) => handleStartResize(e, idx)}
                    className="w-2.5 h-full hover:bg-[#2DD4BF]/60 transition cursor-ew-resize rounded-r flex items-center justify-center shrink-0"
                    title="Drag to adjust slide duration"
                  >
                    <div className="w-0.5 h-4 bg-[#748396]" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* TRACK 2: SCRIPT PARAGRAPHS */}
          <div className="h-7 border-b border-[#2B3947] bg-[#0B0F14]/70 relative">
            {matches.map((m, idx) => {
              const leftPx = m.startTime * zoomLevel;
              const widthPx = Math.max(30, m.duration * zoomLevel);
              return (
                <div
                  key={idx}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  className="absolute top-0.5 bottom-0.5 rounded bg-sky-500/10 border border-sky-500/20 px-1.5 flex items-center overflow-hidden"
                  title={m.paragraph?.text}
                >
                  <span className="text-[9px] text-sky-300 truncate font-sans">
                    {m.paragraph?.text || m.searchPhrase}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 3: SUBTITLE CUES */}
          <div className="h-7 border-b border-[#2B3947] bg-[#111821]/60 relative">
            {cues.map((c, idx) => {
              const leftPx = c.startTime * zoomLevel;
              const widthPx = Math.max(12, c.duration * zoomLevel);
              return (
                <div
                  key={idx}
                  style={{ left: `${leftPx}px`, width: `${widthPx}px` }}
                  className="absolute top-0.5 bottom-0.5 rounded bg-indigo-500/15 border border-indigo-500/30 px-1 flex items-center overflow-hidden"
                  title={`${formatSecondsToTimestamp(c.startTime)} - ${c.text}`}
                >
                  <span className="text-[9px] text-indigo-300 truncate font-mono">
                    {c.cleanText || c.text}
                  </span>
                </div>
              );
            })}
          </div>

          {/* TRACK 4: AUDIO WAVEFORM */}
          <div
            onClick={handleTimelineClick}
            className="h-10 bg-[#0B0F14] relative flex items-center cursor-pointer"
          >
            {/* Visual simulated waveform bars */}
            <div className="w-full h-full flex items-center opacity-30 gap-1 px-1 pointer-events-none">
              {Array.from({ length: Math.ceil(timelinePixelWidth / 8) }).map((_, i) => {
                const heightPct = 20 + Math.sin(i * 0.4) * 35 + Math.cos(i * 0.15) * 25;
                return (
                  <div
                    key={i}
                    style={{ height: `${Math.max(15, Math.min(95, heightPct))}%` }}
                    className="w-1 bg-[#2DD4BF] rounded-full shrink-0"
                  />
                );
              })}
            </div>
          </div>

          {/* PLAYHEAD (Spans all tracks) */}
          <div
            style={{ left: `${currentTime * zoomLevel}px` }}
            className="absolute top-0 bottom-0 w-0.5 bg-[#2DD4BF] pointer-events-none z-30 shadow-[0_0_10px_rgba(45,212,191,0.8)]"
          >
            {/* Playhead Top Knob */}
            <div className="w-3.5 h-3.5 -ml-1.5 -top-1 absolute bg-[#2DD4BF] rotate-45 rounded-sm shadow-md" />
          </div>
        </div>
      </div>
    </div>
  );
};
