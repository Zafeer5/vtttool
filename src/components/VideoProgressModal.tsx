'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  X,
  CheckCircle2,
  AlertCircle,
  Download,
  RotateCcw,
  Film,
  Archive,
  Clock,
  Layers,
  ArrowRight,
  Gauge,
  Activity,
  AlertTriangle,
  StopCircle,
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
  jobId?: string | null;
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
  jobId,
}) => {
  const activeJobId = jobId || progress.jobId || null;
  const isCompleted = progress.stage === 'completed';
  const isError = progress.stage === 'error';
  const isCancelled = progress.stage === 'cancelled';
  const isInterrupted = progress.stage === 'interrupted';
  const isTerminal = isCompleted || isError || isCancelled || isInterrupted;

  // Track active job ID and strictly reset monotonic guards per job ID
  const currentJobIdRef = useRef<string | null>(null);
  const maxPercentRef = useRef<number>(0);
  const startTimeRef = useRef<number>(Date.now());
  const [smoothPercentage, setSmoothPercentage] = useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);

  // Video object URL for inline HTML5 video player
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string | null>(null);

  // Reset or initialize state when job ID changes or modal opens
  useEffect(() => {
    if (!isOpen) {
      currentJobIdRef.current = null;
      maxPercentRef.current = 0;
      setSmoothPercentage(0);
      setElapsedSeconds(0);
      return;
    }

    if (activeJobId !== currentJobIdRef.current) {
      currentJobIdRef.current = activeJobId;
      maxPercentRef.current = 0;
      startTimeRef.current = Date.now();
      setElapsedSeconds(0);
      const initial = typeof progress.percentage === 'number' ? Math.max(0, Math.min(100, Math.round(progress.percentage))) : 0;
      maxPercentRef.current = initial;
      setSmoothPercentage(initial);
    }
  }, [isOpen, activeJobId, progress.percentage]);

  // Elapsed time ticker
  useEffect(() => {
    if (!isOpen || isTerminal) return;

    const interval = setInterval(() => {
      const sec = Math.max(0, Math.floor((Date.now() - startTimeRef.current) / 1000));
      setElapsedSeconds(sec);
    }, 1000);

    return () => clearInterval(interval);
  }, [isOpen, isTerminal]);

  // Monotonic progress progression strictly within one job
  useEffect(() => {
    if (!isOpen) return;

    if (isCompleted) {
      maxPercentRef.current = 100;
      setSmoothPercentage(100);
      return;
    }

    if (isError || isCancelled || isInterrupted) {
      // Preserve last achieved percentage, do not drop to 0 or advance to 100
      return;
    }

    const raw = typeof progress.percentage === 'number' ? progress.percentage : 0;
    // Real percentage without artificial minimum clamping (starts at 0%)
    const rounded = Math.max(0, Math.min(99, Math.round(raw)));

    if (rounded >= maxPercentRef.current) {
      maxPercentRef.current = rounded;
      setSmoothPercentage(rounded);
    }
  }, [progress.percentage, isCompleted, isError, isCancelled, isInterrupted, isOpen]);

  // Manage video preview URL lifecycle
  useEffect(() => {
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
        if (isTerminal) {
          onClose?.();
        } else {
          // In active rendering, Escape closes modal without aborting render (Continue in Background)
          onClose?.();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isTerminal, onClose]);

  // Telemetry Calculations: ETA & Speed
  const etaText = useMemo(() => {
    if (isTerminal) return null;
    const stats = progress.stats;
    if (stats?.currentFrame && stats.totalFrames && stats.totalFrames > stats.currentFrame) {
      const remainingFrames = stats.totalFrames - stats.currentFrame;
      let effectiveFps = stats.fps && stats.fps > 0 ? stats.fps : 0;
      if (effectiveFps <= 0 && elapsedSeconds > 3 && stats.currentFrame > 15) {
        effectiveFps = stats.currentFrame / elapsedSeconds;
      }
      if (effectiveFps > 0) {
        const remainingSec = Math.round(remainingFrames / effectiveFps);
        if (remainingSec < 60) return `~${remainingSec}s left`;
        const mins = Math.floor(remainingSec / 60);
        const secs = remainingSec % 60;
        return `~${mins}m ${secs}s left`;
      }
    }
    return null;
  }, [progress.stats, elapsedSeconds, isTerminal]);

  const formatElapsed = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

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

    if (videoPreviewUrl) {
      const a = document.createElement('a');
      a.href = videoPreviewUrl;
      a.download = cleanName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  };

  // Stage display label and styling
  const stageInfo = (() => {
    if (isCompleted) {
      return { label: 'Completed', color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' };
    }
    if (isError) {
      return { label: 'Failed', color: 'text-rose-400 bg-rose-500/10 border-rose-500/30' };
    }
    if (isCancelled) {
      return { label: 'Cancelled', color: 'text-slate-400 bg-slate-800 border-slate-700' };
    }
    if (isInterrupted) {
      return { label: 'Interrupted', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
    }
    switch (progress.stage) {
      case 'queued':
        return { label: 'Queued in line', color: 'text-amber-400 bg-amber-500/10 border-amber-500/30' };
      case 'preparing':
      case 'loading-ffmpeg':
        return { label: 'Preparing media', color: 'text-sky-400 bg-sky-500/10 border-sky-500/30' };
      case 'finalizing':
        return { label: 'Finalizing video', color: 'text-purple-400 bg-purple-500/10 border-purple-500/30' };
      case 'encoding':
      default:
        return { label: 'Encoding frames', color: 'text-indigo-400 bg-indigo-500/10 border-indigo-500/30' };
    }
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="progress-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn transition-all duration-300"
      onClick={(e) => {
        if (e.target === e.currentTarget && isTerminal) {
          onClose?.();
        }
      }}
    >
      <div
        className={`w-full rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl relative overflow-hidden transition-all duration-300 ease-out ${
          isCompleted
            ? 'max-w-2xl p-6 sm:p-8 space-y-6'
            : 'max-w-md p-6 sm:p-7 space-y-5'
        }`}
      >
        {/* Subtle close button */}
        <button
          type="button"
          onClick={isTerminal ? onClose : onClose}
          aria-label={isTerminal ? 'Close dialog' : 'Continue in background'}
          title={isTerminal ? 'Close dialog' : 'Continue in background'}
          className="absolute top-4 right-4 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 border border-slate-700/50 transition-colors cursor-pointer z-10"
        >
          <X className="w-4 h-4" />
        </button>

        {/* -------------------- 1. ACTIVE RENDERING STATE -------------------- */}
        {!isTerminal && (
          <div className="space-y-5 pt-1" role="status" aria-live="polite">
            {/* Header: Title, Stage Badge, and Percentage */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center shadow-lg shadow-indigo-500/10 shrink-0">
                  <Film className="w-5 h-5 animate-pulse text-indigo-400" />
                </div>
                <div>
                  <h3 id="progress-modal-title" className="text-base sm:text-lg font-semibold text-white tracking-tight">
                    {outputFileName || 'Rendering Slideshow...'}
                  </h3>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold border ${stageInfo.color}`}>
                      {stageInfo.label}
                    </span>
                    {activeJobId && (
                      <span className="font-mono text-[10px] text-slate-500 truncate max-w-[120px]">
                        #{activeJobId.substring(0, 8)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <span className="font-mono text-2xl sm:text-3xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400 shrink-0">
                {smoothPercentage}%
              </span>
            </div>

            {/* High-Performance Progress Bar with monotonic guarantee */}
            <div className="space-y-1.5">
              <div className="h-2.5 w-full rounded-full bg-slate-950 border border-slate-800/80 overflow-hidden relative shadow-inner shadow-black/80">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 shadow-[0_0_12px_rgba(129,140,248,0.5)] transition-all duration-300 ease-out relative overflow-hidden"
                  style={{ width: `${smoothPercentage}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-pulse" />
                </div>
              </div>

              {/* Progress Subtext & Telemetry */}
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span className="truncate max-w-[240px] text-slate-300 font-medium">
                  {progress.message || 'Processing video compilation...'}
                </span>
                <span className="font-mono text-slate-400 shrink-0">
                  Elapsed: <strong className="text-slate-200">{formatElapsed(elapsedSeconds)}</strong>
                </span>
              </div>
            </div>

            {/* Live Metrics Grid (Frames, FPS, Speed, ETA) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-[11px] font-mono">
              {progress.stats?.currentFrame !== undefined && progress.stats?.totalFrames ? (
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase text-slate-500 block">Frames</span>
                  <span className="text-indigo-300 font-semibold">
                    {progress.stats.currentFrame} / {progress.stats.totalFrames}
                  </span>
                </div>
              ) : (
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-[10px] uppercase text-slate-500 block">Status</span>
                  <span className="text-indigo-300 font-semibold capitalize">{progress.stage}</span>
                </div>
              )}

              <div>
                <span className="text-[10px] uppercase text-slate-500 block">Speed</span>
                <span className="text-emerald-400 font-semibold">
                  {progress.stats?.fps ? `${progress.stats.fps} fps` : progress.stats?.speed || '—'}
                </span>
              </div>

              <div>
                <span className="text-[10px] uppercase text-slate-500 block">ETA</span>
                <span className="text-purple-300 font-semibold">{etaText || 'Calculating...'}</span>
              </div>
            </div>

            {/* Action Buttons: Background continue + Safe Cancel */}
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-500 border border-indigo-500/30 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/20"
              >
                <span>Continue in Background</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                onClick={onCancel}
                className="py-2.5 px-3.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-rose-300 bg-slate-800/40 hover:bg-rose-500/10 border border-slate-800 hover:border-rose-500/20 transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5"
                title="Cancel Render Process"
              >
                <StopCircle className="w-3.5 h-3.5" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
        )}

        {/* -------------------- 2. COMPLETED STATE -------------------- */}
        {isCompleted && (
          <div className="space-y-6 pt-1 animate-fadeIn">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-lg shadow-emerald-500/15 shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                </div>
                <div>
                  <h3 id="progress-modal-title" className="text-lg sm:text-xl font-bold text-white tracking-tight">
                    Render Complete
                  </h3>
                  <p className="text-xs text-slate-400">
                    Your output has been finalized, validated, and saved to the library.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold self-start sm:self-auto">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>100% Ready</span>
              </div>
            </div>

            {/* Video Player or ZIP Badge */}
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
                    All individual timeline clips have been synchronized and archived without re-encode degradation.
                  </p>
                </div>
              </div>
            ) : (
              <div className="w-full aspect-video rounded-xl bg-slate-950 border border-slate-800/80 flex items-center justify-center text-slate-500 text-xs">
                Preparing video preview...
              </div>
            )}

            {/* Action Buttons */}
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
                <span>Back to Studio</span>
              </button>
            </div>
          </div>
        )}

        {/* -------------------- 3. TERMINAL ERROR / INTERRUPTED / CANCELLED STATE -------------------- */}
        {(isError || isCancelled || isInterrupted) && (
          <div className="space-y-5 pt-1 animate-fadeIn">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                isInterrupted
                  ? 'bg-amber-500/10 border border-amber-500/30 text-amber-400'
                  : isCancelled
                  ? 'bg-slate-800 border border-slate-700 text-slate-400'
                  : 'bg-rose-500/10 border border-rose-500/30 text-rose-400'
              }`}>
                {isInterrupted ? (
                  <AlertTriangle className="w-5 h-5 text-amber-400" />
                ) : isCancelled ? (
                  <StopCircle className="w-5 h-5 text-slate-400" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-400" />
                )}
              </div>
              <div>
                <h3 id="progress-modal-title" className="text-lg font-bold text-white tracking-tight">
                  {isInterrupted
                    ? 'Render Interrupted'
                    : isCancelled
                    ? 'Render Cancelled'
                    : 'Rendering Failed'}
                </h3>
                <p className="text-xs text-slate-400">
                  {isInterrupted
                    ? 'The server restarted while this job was active.'
                    : isCancelled
                    ? 'Render was stopped by user request.'
                    : 'An error occurred during video compilation.'}
                </p>
              </div>
            </div>

            <div className={`rounded-xl p-3.5 text-xs font-mono leading-relaxed break-words border ${
              isInterrupted
                ? 'bg-amber-950/30 border-amber-900/50 text-amber-300'
                : isCancelled
                ? 'bg-slate-950/60 border-slate-800 text-slate-300'
                : 'bg-rose-950/30 border-rose-900/50 text-rose-300'
            }`}>
              {progress.error || progress.message || 'No additional error diagnostics were reported.'}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Close Dialog</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
