'use client';

import React, { useState, useRef } from 'react';
import { SyncMatch } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';
import { Play, Sparkles, CheckCircle2, AlertTriangle } from 'lucide-react';

interface SegmentTimelineBarProps {
  matches: SyncMatch[];
  totalDuration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  activeSlideIndex?: number | null;
  onSelectSlide?: (index: number) => void;
}

export const SegmentTimelineBar: React.FC<SegmentTimelineBarProps> = ({
  matches,
  totalDuration,
  currentTime,
  onSeek,
  activeSlideIndex,
  onSelectSlide,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  if (!matches || matches.length === 0 || totalDuration <= 0) {
    return null;
  }

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * totalDuration;
    onSeek(targetTime);
  };

  const playheadPercent = Math.max(0, Math.min(100, (currentTime / totalDuration) * 100));

  // Determine current active slide based on playhead
  const currentSlideFromPlayhead = matches.findIndex(
    (m) => currentTime >= m.startTime && currentTime <= m.endTime
  );

  return (
    <div className="space-y-2 select-none">
      <div className="flex items-center justify-between text-xs font-mono text-gray-500">
        <span className="flex items-center gap-1.5 font-semibold text-gray-700">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          Continuous Slide Timeline ({matches.length} Blocks)
        </span>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="text-gray-400">
            Current: <strong className="text-gray-800">{formatSecondsToTimestamp(currentTime)}</strong> / {formatSecondsToTimestamp(totalDuration)}
          </span>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-[10px]">Exact</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="text-[10px]">High</span>
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-[10px]">Adjust</span>
            </span>
          </div>
        </div>
      </div>

      {/* Main Track Container */}
      <div
        ref={containerRef}
        onClick={handleTimelineClick}
        className="relative h-12 w-full rounded-xl bg-gray-900 border border-gray-800 overflow-hidden shadow-inner cursor-pointer group"
      >
        {/* Subtle Waveform-like background grid ticks */}
        <div className="absolute inset-0 opacity-15 flex justify-between pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => (
            <div key={i} className="h-full border-r border-white/30" />
          ))}
        </div>

        {/* Slide Blocks */}
        {matches.map((match, idx) => {
          const widthPct = Math.max(0.5, ((match.endTime - match.startTime) / totalDuration) * 100);
          const leftPct = (match.startTime / totalDuration) * 100;
          const isHovered = hoveredIndex === idx;
          const isActive = activeSlideIndex === idx || currentSlideFromPlayhead === idx;

          const score = match.confidenceScore ?? 85;
          let blockColorClass = 'bg-emerald-600/30 border-emerald-500/50 hover:bg-emerald-600/50 text-emerald-200';
          let activeBorder = 'ring-2 ring-emerald-400 shadow-md shadow-emerald-500/20';

          if (score < 70 || match.status === 'low_confidence_flagged') {
            blockColorClass = 'bg-rose-600/35 border-rose-500/60 hover:bg-rose-600/55 text-rose-200';
            activeBorder = 'ring-2 ring-rose-400 shadow-md shadow-rose-500/20';
          } else if (score < 85) {
            blockColorClass = 'bg-amber-600/30 border-amber-500/50 hover:bg-amber-600/50 text-amber-200';
            activeBorder = 'ring-2 ring-amber-400 shadow-md shadow-amber-500/20';
          } else if (score < 95) {
            blockColorClass = 'bg-blue-600/30 border-blue-500/50 hover:bg-blue-600/50 text-blue-200';
            activeBorder = 'ring-2 ring-blue-400 shadow-md shadow-blue-500/20';
          }

          return (
            <div
              key={idx}
              onMouseEnter={() => setHoveredIndex(idx)}
              onMouseLeave={() => setHoveredIndex(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSeek(match.startTime);
                onSelectSlide?.(idx);
              }}
              style={{
                left: `${leftPct}%`,
                width: `${widthPct}%`,
              }}
              className={`absolute top-0 bottom-0 border-r border-black/40 transition-all cursor-pointer flex flex-col justify-between p-1.5 ${blockColorClass} ${
                isActive ? `${activeBorder} z-10` : 'z-0'
              }`}
            >
              {/* Header: Slide Number */}
              <div className="flex items-center justify-between pointer-events-none">
                <span className="text-[10px] font-mono font-bold tracking-tight px-1 py-0.2 rounded bg-black/60 text-white backdrop-blur-xs">
                  #{idx + 1}
                </span>
                {widthPct > 6 && (
                  <span className="text-[9px] font-mono opacity-80">
                    {(match.endTime - match.startTime).toFixed(1)}s
                  </span>
                )}
              </div>

              {/* Footer: Trigger or snippet preview */}
              {widthPct > 8 && (
                <div className="text-[9px] truncate font-sans opacity-90 pointer-events-none">
                  {match.searchPhrase || match.paragraph.startingSentence || match.paragraph.text.slice(0, 15)}
                </div>
              )}
            </div>
          );
        })}

        {/* Live Audio Playhead Line */}
        <div
          style={{ left: `${playheadPercent}%` }}
          className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 pointer-events-none shadow-[0_0_8px_rgba(239,68,68,0.9)]"
        >
          <div className="absolute -top-1 -left-1.5 w-3.5 h-3.5 bg-red-600 rounded-full border border-white shadow-sm" />
        </div>
      </div>

      {/* Hover Info Tooltip Bar */}
      {hoveredIndex !== null && matches[hoveredIndex] && (
        <div className="flex items-center justify-between p-2 rounded-lg bg-gray-900 text-white text-xs font-mono shadow-md animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="px-1.5 py-0.5 rounded bg-white/20 font-bold">
              Slide #{hoveredIndex + 1}
            </span>
            <span className="text-gray-300">
              {formatSecondsToTimestamp(matches[hoveredIndex].startTime)} &rarr;{' '}
              {formatSecondsToTimestamp(matches[hoveredIndex].endTime)} (
              {(matches[hoveredIndex].endTime - matches[hoveredIndex].startTime).toFixed(2)}s)
            </span>
            <span
              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                (matches[hoveredIndex].confidenceScore ?? 85) >= 90
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                  : (matches[hoveredIndex].confidenceScore ?? 85) >= 75
                  ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                  : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              }`}
            >
              {matches[hoveredIndex].confidenceScore ?? 85}% Confidence
            </span>
          </div>
          <div className="max-w-[40%] truncate text-gray-300 font-sans italic text-[11px]">
            &ldquo;{matches[hoveredIndex].paragraph.text.slice(0, 60)}...&rdquo;
          </div>
        </div>
      )}
    </div>
  );
};
