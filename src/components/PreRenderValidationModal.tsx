'use client';

import React from 'react';
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  Film,
  Archive,
  Clock,
  Layers,
  Volume2,
  Subtitles,
  Sparkles,
  ArrowRight,
  X,
} from 'lucide-react';
import { SyncMatch, ExportMode, MotionSettings } from '../lib/types';
import { VttValidationResult } from '../lib/vtt-parser';

interface PreRenderValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  matches: SyncMatch[];
  exportMode: ExportMode;
  resolution: string;
  totalDuration: number;
  outputFileName: string;
  hasAudio: boolean;
  audioDuration?: number;
  motionSettings?: MotionSettings;
  vttValidation?: VttValidationResult;
}

export const PreRenderValidationModal: React.FC<PreRenderValidationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  matches,
  exportMode,
  resolution,
  totalDuration,
  outputFileName,
  hasAudio,
  audioDuration,
  motionSettings,
  vttValidation,
}) => {
  if (!isOpen) return null;

  // Identify blockers vs warnings
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (matches.length === 0) {
    blockers.push('No slides or script paragraphs found in the project.');
  }

  const missingImageCount = matches.filter((m) => !m.image).length;
  if (missingImageCount > 0) {
    blockers.push(`${missingImageCount} slide(s) are missing an image.`);
  }

  if (totalDuration <= 0) {
    blockers.push('Total timeline duration is 0 seconds.');
  }

  if (!hasAudio) {
    warnings.push('No voiceover audio file provided; video will be rendered with silent audio.');
  } else if (audioDuration && Math.abs(audioDuration - totalDuration) > 1.5) {
    warnings.push(
      `Timeline duration (${totalDuration.toFixed(1)}s) differs from voiceover audio duration (${audioDuration.toFixed(1)}s).`
    );
  }

  // Low confidence matches
  const lowConfidenceCount = matches.filter((m) => m.confidence === 'fallback').length;
  if (lowConfidenceCount > 0) {
    warnings.push(`${lowConfidenceCount} slide(s) have estimated/fallback subtitle synchronization.`);
  }

  // VTT validation issues
  if (vttValidation && vttValidation.issues) {
    vttValidation.issues.forEach((issue) => {
      if (issue.type === 'error') {
        blockers.push(issue.message);
      } else {
        warnings.push(issue.message);
      }
    });
  }

  const isBlocked = blockers.length > 0;
  const isZip = exportMode === 'clips_zip';

  // Rough size estimation (1080p ~ 6-8 Mbps, clips ZIP slightly larger due to archive headers)
  const estMbPerMinute = resolution === '4K' ? 120 : resolution === '720p' ? 25 : 45;
  const estSizeMb = Math.max(1, Math.round((totalDuration / 60) * estMbPerMinute * (isZip ? 1.05 : 1)));

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="validation-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl relative overflow-hidden p-6 sm:p-7 space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-lg shrink-0 ${
              isBlocked
                ? 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
                : warnings.length > 0
                ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                : 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            }`}>
              {isBlocked ? (
                <XCircle className="w-5 h-5 text-rose-400" />
              ) : warnings.length > 0 ? (
                <AlertTriangle className="w-5 h-5 text-amber-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 text-emerald-400" />
              )}
            </div>
            <div>
              <h3 id="validation-modal-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                Pre-Render Validation Summary
              </h3>
              <p className="text-xs text-slate-400">
                {isBlocked
                  ? 'Resolve blockers below before starting video compilation.'
                  : warnings.length > 0
                  ? 'All essential checks passed with minor warnings.'
                  : 'All pre-render checks passed with 100% confidence.'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Project Metrics Summary Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 rounded-xl bg-slate-950/70 border border-slate-800/80 text-xs font-mono">
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Slides</span>
            <span className="text-indigo-300 font-bold">{matches.length} clips</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Duration</span>
            <span className="text-emerald-300 font-bold">{totalDuration.toFixed(1)}s</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Format</span>
            <span className="text-purple-300 font-bold">{isZip ? 'Clips ZIP' : 'Single MP4'}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-500 uppercase block">Est. Size</span>
            <span className="text-amber-300 font-bold">~{estSizeMb} MB</span>
          </div>
        </div>

        {/* Technical details pill row */}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
          <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/60 font-mono">
            {resolution} • 30 FPS
          </span>
          <span className="px-2 py-0.5 rounded-md bg-slate-800 border border-slate-700/60 font-mono">
            {motionSettings?.zoomEnabled
              ? `Zoom Active (${motionSettings.zoomIntensity || 2}%)`
              : 'Static (Zoom Off)'}
          </span>
          <span className="truncate max-w-[200px] text-slate-300 font-mono text-[11px]">
            {outputFileName}
          </span>
        </div>

        {/* Blockers list */}
        {blockers.length > 0 && (
          <div className="space-y-1.5 p-3 rounded-xl bg-rose-950/30 border border-rose-900/50 text-xs text-rose-300">
            <div className="font-semibold flex items-center gap-1.5 text-rose-200">
              <XCircle className="w-3.5 h-3.5 text-rose-400" />
              <span>Blockers ({blockers.length})</span>
            </div>
            <ul className="space-y-1 pl-5 list-disc text-[11px] leading-relaxed">
              {blockers.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Warnings list */}
        {warnings.length > 0 && (
          <div className="space-y-1.5 p-3 rounded-xl bg-amber-950/20 border border-amber-900/40 text-xs text-amber-300">
            <div className="font-semibold flex items-center gap-1.5 text-amber-200">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
              <span>Advisories &amp; Warnings ({warnings.length})</span>
            </div>
            <ul className="space-y-1 pl-5 list-disc text-[11px] leading-relaxed max-h-24 overflow-y-auto">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex items-center gap-2.5 pt-2 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="w-1/3 py-2.5 px-3 rounded-xl text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition cursor-pointer"
          >
            Review Timeline
          </button>

          <button
            type="button"
            disabled={isBlocked}
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold text-white transition-all flex items-center justify-center gap-2 cursor-pointer ${
              isBlocked
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/40'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 shadow-lg shadow-indigo-600/25'
            }`}
          >
            <span>Confirm &amp; Start Render</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
