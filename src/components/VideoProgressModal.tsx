'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  Film,
  Archive,
} from 'lucide-react';
import { RenderProgress, SyncMatch, ExportMode } from '../lib/types';

interface VideoProgressModalProps {
  progress: RenderProgress;
  isOpen: boolean;
  onClose?: () => void;
  onCancel?: () => void;
  outputFileName?: string;
  matches?: SyncMatch[];
  outputUrl?: string | null;
  outputBlob?: Blob | null;
  exportMode?: ExportMode | null;
}

export const VideoProgressModal: React.FC<VideoProgressModalProps> = ({
  progress,
  isOpen,
  onClose,
  onCancel,
  outputFileName,
  outputUrl,
  outputBlob,
  exportMode = 'single',
}) => {
  const isCompleted = progress.stage === 'completed';
  const isError = progress.stage === 'error';

  // Smooth, monotonic linear progress tracking (never resets or stutters backwards)
  const [smoothPercentage, setSmoothPercentage] = useState(0);
  const maxPercentRef = useRef(0);
  const progressBarFillRef = useRef<HTMLDivElement>(null);
  const percentageTextRef = useRef<HTMLSpanElement>(null);
  const lastStateUpdateTimeRef = useRef(0);

  // Video object URL for inline HTML5 video player
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      maxPercentRef.current = 0;
      setSmoothPercentage(0);
      if (progressBarFillRef.current) {
        progressBarFillRef.current.style.width = '0%';
      }
      if (percentageTextRef.current) {
        percentageTextRef.current.innerText = '0%';
      }
      return;
    }

    if (isCompleted) {
      maxPercentRef.current = 100;
      if (progressBarFillRef.current) {
        progressBarFillRef.current.style.width = '100%';
      }
      if (percentageTextRef.current) {
        percentageTextRef.current.innerText = '100%';
      }
      setSmoothPercentage(100);
      return;
    }

    if (isError) {
      return;
    }

    // Monotonic progression guard: progress strictly moves forward (Math.max)
    const raw = typeof progress.percentage === 'number' ? progress.percentage : 0;
    const clamped = Math.max(3, Math.min(99, Math.round(raw)));
    if (clamped > maxPercentRef.current) {
      maxPercentRef.current = clamped;

      // 1. Direct DOM manipulation: bypass React state churn for 60fps rendering without UI thread choke
      if (progressBarFillRef.current) {
        progressBarFillRef.current.style.width = `${clamped}%`;
      }
      if (percentageTextRef.current) {
        percentageTextRef.current.innerText = `${clamped}%`;
      }

      // 2. Throttled state update for React render tree (100ms threshold)
      const now = performance.now();
      if (now - lastStateUpdateTimeRef.current > 100 || clamped >= 95) {
        lastStateUpdateTimeRef.current = now;
        setSmoothPercentage(clamped);
      }
    }
  }, [progress.percentage, isCompleted, isError, isOpen]);

  // Manage video preview URL lifecycle
  useEffect(() => {
    // If we have an API streaming endpoint from the server, use it directly for hardware-accelerated streaming & timeline scrubbing
    const directApiUrl =
      outputUrl && outputUrl.startsWith('/api/renders/')
        ? outputUrl
        : progress.outputUrl && progress.outputUrl.startsWith('/api/renders/')
        ? progress.outputUrl
        : null;

    if (directApiUrl) {
      setVideoPreviewUrl(directApiUrl);
      return;
    }

    const blob = outputBlob || progress.outputBlob;
    if (blob) {
      const url = URL.createObjectURL(blob);
      setVideoPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else if (outputUrl || progress.outputUrl) {
      setVideoPreviewUrl(outputUrl || progress.outputUrl || null);
    } else {
      setVideoPreviewUrl(null);
    }
  }, [outputBlob, progress.outputBlob, outputUrl, progress.outputUrl]);

  // Listen to Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (isCompleted || isError) {
          onClose?.();
        } else {
          onCancel?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isCompleted, isError, onClose, onCancel]);

  if (!isOpen) return null;

  const isZipExport =
    exportMode === 'clips_zip' ||
    progress.exportMode === 'clips_zip' ||
    (progress.outputBlob && progress.outputBlob.type === 'application/zip') ||
    Boolean(outputFileName && outputFileName.toLowerCase().endsWith('.zip'));

  const handleDownload = () => {
    const blob = outputBlob || progress.outputBlob;
    const directApiUrl =
      outputUrl && outputUrl.startsWith('/api/renders/')
        ? outputUrl
        : progress.outputUrl && progress.outputUrl.startsWith('/api/renders/')
        ? progress.outputUrl
        : videoPreviewUrl && videoPreviewUrl.startsWith('/api/renders/')
        ? videoPreviewUrl
        : null;

    const fileExt = isZipExport ? '.zip' : '.mp4';
    const defaultName = isZipExport ? 'slideshow_clips.zip' : 'slideshow_video.mp4';
    const cleanName = outputFileName
      ? outputFileName.trim().toLowerCase().endsWith(fileExt)
        ? outputFileName.trim()
        : `${outputFileName.trim().replace(/\.(mp4|zip)$/i, '')}${fileExt}`
      : defaultName;

    // 1. If direct server API URL is available, trigger direct download with attachment header
    if (directApiUrl) {
      const apiFileUrl = `${directApiUrl}${directApiUrl.includes('?') ? '&' : '?'}download=1&filename=${encodeURIComponent(cleanName)}`;
      const a = document.createElement('a');
      a.href = apiFileUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return;
    }

    // 2. If Blob is in memory, download directly from object URL
    if (blob) {
      const tempUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = tempUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(tempUrl), 2000);
      return;
    }

    // 3. Fallback to active preview URL
    if (videoPreviewUrl) {
      const a = document.createElement('a');
      a.href = videoPreviewUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn transition-all duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          if (isCompleted || isError) {
            onClose?.();
          }
        }
      }}
    >
      <div
        className={`w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl relative overflow-hidden transition-all duration-300 ease-out ${
          isCompleted
            ? 'max-w-2xl p-6 sm:p-8 space-y-6'
            : isError
            ? 'max-w-md p-6 sm:p-7 space-y-6'
            : 'max-w-md p-6 sm:p-7 space-y-6'
        }`}
      >
        {/* Subtle close button */}
        <button
          type="button"
          onClick={isCompleted || isError ? onClose : onCancel}
          aria-label="Close dialog"
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* -------------------- 1. ACTIVE RENDERING STATE (MINIMALIST & CLEAN) -------------------- */}
        {!isCompleted && !isError && (
          <div className="space-y-6 pt-1">
            {/* Header: Title and Percentage */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/10">
                  <Film className="w-4 h-4 animate-pulse text-indigo-400" />
                </div>
                <h3 className="text-base sm:text-lg font-semibold text-white tracking-tight">
                  Rendering Synchronized Video...
                </h3>
              </div>
              <span
                ref={percentageTextRef}
                className="font-mono text-xl sm:text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400"
              >
                {smoothPercentage}%
              </span>
            </div>

            {/* Sleek, Modern High-Performance Progress Bar with direct DOM GPU fill */}
            <div className="h-2 w-full rounded-full bg-slate-950 border border-slate-800/80 overflow-hidden relative shadow-inner shadow-black/80">
              <div
                ref={progressBarFillRef}
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-[0_0_12px_rgba(129,140,248,0.5)] transition-all duration-300 ease-out relative overflow-hidden"
                style={{ width: `${smoothPercentage}%` }}
              >
                {/* Subtle continuous shimmer highlight */}
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
              </div>
            </div>

            {/* Standard Output Logs & Status Variable Matrix (Step 2) */}
            <div className="space-y-1.5 pt-0.5">
              <p className="text-xs text-slate-300 font-medium truncate">
                {progress.message || 'Preparing video compilation...'}
              </p>
              {progress.stats && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400">
                  {progress.stats.currentFrame !== undefined && progress.stats.totalFrames ? (
                    <span>
                      Frames: <strong className="text-indigo-300 font-semibold">{progress.stats.currentFrame}</strong>/{progress.stats.totalFrames}
                    </span>
                  ) : null}
                  {progress.stats.fps ? (
                    <span>
                      FPS: <strong className="text-emerald-400 font-semibold">{progress.stats.fps}</strong>
                    </span>
                  ) : null}
                  {progress.stats.speed ? (
                    <span>
                      Speed: <strong className="text-purple-300 font-semibold">{progress.stats.speed}</strong>
                    </span>
                  ) : null}
                  {progress.stats.bitrate ? (
                    <span>
                      Bitrate: <strong className="text-pink-300 font-semibold">{progress.stats.bitrate}</strong>
                    </span>
                  ) : null}
                </div>
              )}
            </div>

            {/* Single Clean Cancel Action */}
            <div className="pt-1">
              <button
                type="button"
                onClick={onCancel}
                className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-slate-400 hover:text-red-300 bg-slate-800/40 hover:bg-red-500/10 border border-slate-800 hover:border-red-500/20 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {/* -------------------- 2. COMPLETED STATE (THE FINAL SCREEN) -------------------- */}
        {isCompleted && (
          <div className="space-y-6 pt-1 animate-fadeIn">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/15 shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    Render Complete
                  </h3>
                  <p className="text-xs text-slate-400">
                    Your file has been compiled and saved to disk.
                  </p>
                </div>
              </div>

              {/* Automatic download badge */}
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold self-start sm:self-auto">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Auto-downloaded</span>
              </div>
            </div>

            {/* Inline Responsive HTML5 Video Player */}
            {!isZipExport && videoPreviewUrl ? (
              <div className="relative w-full aspect-video rounded-xl overflow-hidden bg-black border border-slate-800 shadow-2xl">
                <video
                  src={videoPreviewUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="w-full h-full object-contain"
                />
              </div>
            ) : isZipExport ? (
              <div className="w-full aspect-video rounded-xl bg-slate-950 border border-slate-800/80 flex flex-col items-center justify-center p-6 text-center space-y-3">
                <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-inner">
                  <Archive className="w-7 h-7 text-indigo-400" />
                </div>
                <div>
                  <h4 className="text-sm font-semibold text-white">
                    Clips ZIP Package Ready
                  </h4>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    All individual timeline clips have been synchronized and compressed into a ZIP archive.
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-full aspect-video rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-center text-slate-500 text-xs">
                Preparing video preview...
              </div>
            )}

            {/* Prominent High-Conversion Action Buttons */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <button
                type="button"
                onClick={handleDownload}
                className="w-full sm:flex-1 py-3 px-5 rounded-xl font-bold text-sm text-white bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 shadow-lg shadow-emerald-500/25 hover:shadow-emerald-500/40 transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>{isZipExport ? 'Download Clips Archive (.zip)' : 'Download Video'}</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="w-full sm:w-auto py-3 px-5 rounded-xl font-semibold text-sm text-slate-300 hover:text-white bg-slate-800/80 hover:bg-slate-800 border border-slate-700/60 transition-all duration-200 cursor-pointer flex items-center justify-center gap-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span>Back / Render New</span>
              </button>
            </div>
          </div>
        )}

        {/* -------------------- 3. ERROR STATE -------------------- */}
        {isError && (
          <div className="space-y-5 pt-1 animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-400" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white tracking-tight">
                  Rendering Stopped or Failed
                </h3>
                <p className="text-xs text-slate-400">
                  An error occurred during video compilation.
                </p>
              </div>
            </div>

            <div className="rounded-xl bg-red-950/30 border border-red-900/50 p-3.5 text-xs text-red-300 font-mono leading-relaxed break-words">
              {progress.error || progress.message || 'Unknown error occurred.'}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Close & Try Again</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
