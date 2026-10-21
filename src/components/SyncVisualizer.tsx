'use client';

import React from 'react';
import {
  AlertTriangle,
  Clock,
  Layers,
  Search,
} from 'lucide-react';
import { SyncAnalysis, SyncMatch } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';

interface SyncVisualizerProps {
  analysis: SyncAnalysis;
  onUpdateDuration?: (index: number, newDuration: number) => void;
}

export const SyncVisualizer: React.FC<SyncVisualizerProps> = ({
  analysis,
}) => {
  const { matches, hasMismatch, mismatchReason, totalDuration, imageCount, paragraphCount, cueCount } = analysis;

  if (matches.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl bg-white border border-gray-200 p-5 shadow-sm space-y-5 font-sans">
      {/* Header section with Stats */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 pb-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-bold font-mono text-gray-900 flex items-center gap-2">
              Synchronization Inspector Table
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                {matches.length} Slides
              </span>
            </h3>
          </div>
        </div>

        {/* Stats Badges */}
        <div className="flex items-center flex-wrap gap-2 text-xs font-mono">
          <div className="px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-gray-700 flex items-center gap-1.5">
            <span className="text-gray-500">Paragraphs:</span>
            <span className="font-bold text-gray-900">{paragraphCount}</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-gray-700 flex items-center gap-1.5">
            <span className="text-gray-500">Images:</span>
            <span className={`font-bold ${imageCount !== paragraphCount ? 'text-amber-600' : 'text-gray-900'}`}>
              {imageCount}
            </span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-gray-50 border border-gray-200 text-gray-700 flex items-center gap-1.5">
            <span className="text-gray-500">Cues:</span>
            <span className="font-bold text-gray-900">{cueCount}</span>
          </div>

          <div className="px-2.5 py-1 rounded-md bg-red-50 border border-red-200 text-red-700 flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-red-600" />
            <span className="text-red-700/80">Duration:</span>
            <span className="font-bold">{formatSecondsToTimestamp(totalDuration)}</span>
          </div>
        </div>
      </div>

      {/* Mismatch Warning Banner */}
      {hasMismatch && (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 flex items-start gap-2.5 text-xs text-amber-800 font-mono">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <div className="font-bold text-amber-900">Input Mismatch Warning</div>
            <p>{mismatchReason}</p>
          </div>
        </div>
      )}

      {/* Sync Timeline Slide Cards */}
      <div className="space-y-2.5">
        {matches.map((match: SyncMatch, index: number) => {
          return (
            <div
              key={index}
              className={`rounded-lg border p-3 bg-white transition-all ${
                !match.image
                  ? 'border-amber-300 bg-amber-50/20'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-center">
                
                {/* 1. Slide & Thumbnail */}
                <div className="lg:col-span-3 flex items-center gap-2.5">
                  <div className="relative aspect-video w-24 sm:w-28 rounded-lg bg-gray-900 border border-gray-200 shrink-0 overflow-hidden flex items-center justify-center shadow-xs">
                    {match.image ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={match.image.previewUrl}
                        alt={match.image.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-amber-600 text-[9px] font-mono font-bold">No Image</span>
                    )}
                    <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-[9px] font-mono font-bold text-white border border-white/10">
                      #{index + 1}
                    </span>
                  </div>

                  <div className="min-w-0 font-mono text-xs">
                    <span className="font-bold text-gray-900 block">Slide #{index + 1}</span>
                    <span className="text-[10px] text-gray-500 truncate block" title={match.image?.name || 'Missing'}>
                      {match.image ? match.image.name : 'Missing image'}
                    </span>
                  </div>
                </div>

                {/* 2. Script Paragraph & Matched Words */}
                <div className="lg:col-span-5 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="px-1.5 py-0.2 rounded bg-gray-100 text-gray-700 text-[10px] font-mono font-bold shrink-0">
                      Trigger:
                    </span>
                    <span className="text-gray-800 font-medium truncate text-xs font-sans">
                      &ldquo;{match.triggerSentence || match.paragraph.startingSentence}&rdquo;
                    </span>
                  </div>

                  <p className="text-xs text-gray-700 line-clamp-2 leading-relaxed bg-gray-50 p-2 rounded border border-gray-200 font-sans">
                    {match.paragraph.text}
                  </p>
                </div>

                {/* 3. Timestamps & Calculated Duration */}
                <div className="lg:col-span-4 flex items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-gray-100">
                  <div className="font-mono text-xs font-semibold px-2 py-1 rounded bg-gray-100 text-gray-900 border border-gray-200 whitespace-nowrap">
                    {formatSecondsToTimestamp(match.startTime)} &rarr; {formatSecondsToTimestamp(match.endTime)}
                  </div>

                  <div className="font-mono text-xs font-bold px-2 py-1 rounded bg-red-50 text-red-700 border border-red-200 shrink-0 whitespace-nowrap">
                    {match.duration.toFixed(2)}s
                  </div>
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
