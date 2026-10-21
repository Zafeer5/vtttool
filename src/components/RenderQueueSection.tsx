'use client';

import React, { useState } from 'react';
import {
  Layers,
  Clock,
  Loader2,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Download,
  Trash2,
  Terminal,
  ChevronDown,
  ChevronUp,
  HardDrive,
  Film,
  Archive,
  RotateCcw,
  X,
  Play,
  Zap,
} from 'lucide-react';
import { QueueRenderItem } from '@/lib/types';

interface RenderQueueSectionProps {
  items: QueueRenderItem[];
  onCancelItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onClearCompleted: () => void;
  onDownloadItem: (item: QueueRenderItem) => void;
  onPreviewItem?: (item: QueueRenderItem) => void;
  onRetryItem?: (item: QueueRenderItem) => void;
  onDownloadAllCompleted?: () => void;
}

export const RenderQueueSection: React.FC<RenderQueueSectionProps> = ({
  items,
  onCancelItem,
  onDeleteItem,
  onClearCompleted,
  onDownloadItem,
  onPreviewItem,
  onRetryItem,
  onDownloadAllCompleted,
}) => {
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<QueueRenderItem | null>(null);

  const activeRendering = items.filter((i) => i.status === 'rendering' || i.status === 'preparing');
  const queuedItems = items.filter((i) => i.status === 'queued');
  const completedItems = items.filter((i) => i.status === 'completed');

  const toggleLogs = (id: string) => {
    setExpandedLogsId((prev) => (prev === id ? null : id));
  };

  const handlePreview = (item: QueueRenderItem) => {
    if (onPreviewItem) {
      onPreviewItem(item);
    } else {
      setPreviewItem(item);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || isNaN(bytes) || bytes <= 0) return '';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) {
      return `${(bytes / 1024).toFixed(0)} KB`;
    }
    return `${mb.toFixed(1)} MB`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const elapsedSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (elapsedSec < 10) return 'Just now';
    if (elapsedSec < 60) return `${elapsedSec}s ago`;
    const min = Math.floor(elapsedSec / 60);
    return `${min}m ago`;
  };

  return (
    <section id="render-queue-section" className="w-full space-y-4 pt-2">
      {/* Section Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-slate-900 border border-slate-800 text-white shadow-md">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-lg shadow-sky-500/20">
            <Layers className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-mono font-bold tracking-tight text-white flex items-center gap-2">
                Render &amp; Export Queue
              </h2>
              {items.length > 0 && (
                <span className="px-2 py-0.5 rounded-full bg-slate-800 text-sky-300 border border-slate-700 text-xs font-mono font-bold">
                  {items.length} {items.length === 1 ? 'Job' : 'Jobs'}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5 font-sans">
              Sequential Render Queue. Tasks are rendered in order and automatically downloaded upon completion.
            </p>
          </div>
        </div>

        {/* Status Count Badges & Global Actions */}
        <div className="flex flex-wrap items-center gap-2">
          {activeRendering.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-sky-500/15 border border-sky-400/30 text-sky-300 text-xs font-mono font-semibold">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              <span>{activeRendering.length} Rendering</span>
            </span>
          )}

          {queuedItems.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-400/30 text-amber-300 text-xs font-mono font-semibold">
              <Clock className="w-3.5 h-3.5 text-amber-400" />
              <span>{queuedItems.length} in Queue</span>
            </span>
          )}

          {completedItems.length > 0 && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-400/30 text-emerald-300 text-xs font-mono font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{completedItems.length} Ready</span>
            </span>
          )}

          {completedItems.length > 1 && onDownloadAllCompleted && (
            <button
              type="button"
              onClick={onDownloadAllCompleted}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Download All ({completedItems.length})</span>
            </button>
          )}

          {completedItems.length > 0 && (
            <button
              type="button"
              onClick={onClearCompleted}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-mono transition-colors cursor-pointer"
              title="Clear all completed items from list"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear Done</span>
            </button>
          )}
        </div>
      </div>

      {/* Queue Items List */}
      {items.length === 0 ? (
        <div className="p-8 rounded-2xl bg-slate-900/60 border border-slate-800/80 text-center flex flex-col items-center justify-center gap-2.5">
          <div className="w-12 h-12 rounded-2xl bg-slate-800/80 flex items-center justify-center text-slate-500">
            <Layers className="w-6 h-6" />
          </div>
          <div className="text-sm font-mono font-semibold text-slate-300">
            No videos in the render queue
          </div>
          <p className="text-xs text-slate-500 max-w-md">
            Click &quot;Compile Final Video&quot; or &quot;Compile &amp; Export Clips ZIP&quot; above to add renders to this queue. You can queue multiple videos one after another!
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isCompleted = item.status === 'completed';
            const isFailed = item.status === 'failed';
            const isCancelled = item.status === 'cancelled';
            const isRendering = item.status === 'rendering';
            const isPreparing = item.status === 'preparing';
            const isQueued = item.status === 'queued';
            const isZip = item.exportMode === 'clips_zip';
            const isLogsOpen = expandedLogsId === item.id;

            // Compute position in queue if queued
            const queueIndex = isQueued
              ? queuedItems.findIndex((q) => q.id === item.id) + 1
              : 0;

            return (
              <div
                key={item.id}
                className={`relative rounded-2xl border transition-all duration-200 overflow-hidden ${
                  isRendering
                    ? 'bg-slate-900 border-sky-500/50 shadow-xl shadow-sky-950/40 ring-1 ring-sky-500/20'
                    : isCompleted
                    ? 'bg-slate-900/90 border-emerald-500/40 shadow-lg shadow-emerald-950/20'
                    : isFailed
                    ? 'bg-slate-900/90 border-rose-500/40 shadow-md'
                    : isQueued
                    ? 'bg-slate-900/80 border-amber-500/30'
                    : 'bg-slate-900/70 border-slate-800'
                }`}
              >
                {/* Active Render Ambient Light Indicator */}
                {isRendering && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-sky-500 via-indigo-500 to-cyan-400 animate-pulse" />
                )}

                <div className="p-4 sm:p-5 space-y-3.5">
                  {/* Top Bar: Title, Badges & Actions */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-start sm:items-center gap-2.5 min-w-0">
                      {/* Format Icon */}
                      <div
                        className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                          isZip
                            ? 'bg-purple-950/70 text-purple-400 border border-purple-800/50'
                            : 'bg-sky-950/70 text-sky-400 border border-sky-800/50'
                        }`}
                      >
                        {isZip ? <Archive className="w-4 h-4" /> : <Film className="w-4 h-4" />}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono font-bold text-sm text-white truncate max-w-[280px] sm:max-w-[420px]" title={item.outputFileName || item.title}>
                            {item.outputFileName || item.title}
                          </span>

                          {/* Mode Badge */}
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                              isZip
                                ? 'bg-purple-500/15 text-purple-300 border border-purple-500/30'
                                : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                            }`}
                          >
                            {isZip ? 'Clips ZIP' : `MP4 ${item.resolution || '1080p'}`}
                          </span>

                          {/* Status Badge */}
                          {isRendering && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/40 text-[11px] font-mono font-bold animate-pulse">
                              <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                              <span>Rendering {item.progress}%</span>
                            </span>
                          )}

                          {isPreparing && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 border border-cyan-400/40 text-[11px] font-mono font-bold">
                              <Zap className="w-3 h-3 text-cyan-400" />
                              <span>Preparing</span>
                            </span>
                          )}

                          {isQueued && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-400/40 text-[11px] font-mono font-bold">
                              <Clock className="w-3 h-3 text-amber-400" />
                              <span>Queued #{queueIndex} in Line</span>
                            </span>
                          )}

                          {isCompleted && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/40 text-[11px] font-mono font-bold">
                              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                              <span>Ready to Download</span>
                            </span>
                          )}

                          {isFailed && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-400/40 text-[11px] font-mono font-bold">
                              <AlertCircle className="w-3 h-3 text-rose-400" />
                              <span>Failed</span>
                            </span>
                          )}

                          {isCancelled && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700 text-[11px] font-mono font-semibold">
                              <XCircle className="w-3 h-3 text-slate-400" />
                              <span>Cancelled</span>
                            </span>
                          )}
                        </div>

                        {/* Metadata Details Row */}
                        <div className="flex items-center gap-3 text-[11px] font-mono text-slate-400 mt-0.5">
                          <span>{item.duration ? `${item.duration.toFixed(1)}s` : '—'}</span>
                          <span>•</span>
                          <span>{item.slideCount} slides</span>
                          {item.outputSize ? (
                            <>
                              <span>•</span>
                              <span className="text-slate-300 font-semibold">{formatFileSize(item.outputSize)}</span>
                            </>
                          ) : null}
                          <span>•</span>
                          <span>{formatTimeAgo(item.createdAt)}</span>
                        </div>
                      </div>
                    </div>

                    {/* Action Buttons for this item */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      {/* Live Logs Toggle */}
                      <button
                        type="button"
                        onClick={() => toggleLogs(item.id)}
                        className={`px-2.5 py-1.5 rounded-xl border text-xs font-mono font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
                          isLogsOpen
                            ? 'bg-slate-800 border-slate-600 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                        title="Toggle console / encoding logs"
                      >
                        <Terminal className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline">Logs</span>
                        {isLogsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>

                      {/* Cancel Button (if active or queued) */}
                      {(isRendering || isPreparing || isQueued) && (
                        <button
                          type="button"
                          onClick={() => onCancelItem(item.id)}
                          className="px-3 py-1.5 rounded-xl border border-rose-900/60 bg-rose-950/40 hover:bg-rose-900/50 text-rose-300 hover:text-rose-100 text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer"
                          title="Cancel this render job"
                        >
                          <XCircle className="w-3.5 h-3.5 text-rose-400" />
                          <span>Cancel</span>
                        </button>
                      )}

                      {/* Preview Button (if completed and has stream URL or preview) */}
                      {isCompleted && (item.outputUrl || item.outputBlob) && !isZip && (
                        <button
                          type="button"
                          onClick={() => handlePreview(item)}
                          className="px-3 py-1.5 rounded-xl border border-indigo-700/60 bg-indigo-950/60 hover:bg-indigo-900/70 text-indigo-200 text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
                          title="Watch video preview"
                        >
                          <Play className="w-3.5 h-3.5 fill-current text-indigo-400" />
                          <span>Preview</span>
                        </button>
                      )}

                      {/* Download Button (if completed) */}
                      {isCompleted && (
                        <button
                          type="button"
                          onClick={() => onDownloadItem(item)}
                          className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-mono font-bold flex items-center gap-2 transition-all cursor-pointer shadow-lg shadow-emerald-600/30 hover:scale-[1.02] active:scale-[0.98]"
                          title="Download rendered file to your computer"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Download {isZip ? 'ZIP' : 'MP4'}</span>
                          {item.outputSize ? (
                            <span className="text-[10px] opacity-80 font-normal">
                              ({formatFileSize(item.outputSize)})
                            </span>
                          ) : null}
                        </button>
                      )}

                      {/* Retry Button (if failed) */}
                      {isFailed && onRetryItem && (
                        <button
                          type="button"
                          onClick={() => onRetryItem(item)}
                          className="px-3 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-mono font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                          title="Retry rendering this video"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Retry</span>
                        </button>
                      )}

                      {/* Dismiss / Delete Button (for terminal states) */}
                      {(isCompleted || isFailed || isCancelled) && (
                        <button
                          type="button"
                          onClick={() => onDeleteItem(item.id)}
                          className="p-1.5 rounded-xl text-slate-500 hover:text-slate-300 hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Remove from queue list"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Middle Progress Bar */}
                  <div className="space-y-1.5">
                    <div className="w-full bg-slate-950 rounded-full h-2.5 overflow-hidden border border-slate-800 p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ease-out ${
                          isCompleted
                            ? 'bg-gradient-to-r from-emerald-500 to-teal-400 w-full'
                            : isFailed
                            ? 'bg-rose-500'
                            : isCancelled
                            ? 'bg-slate-700'
                            : isQueued
                            ? 'bg-amber-500/50 w-2 animate-pulse'
                            : 'bg-gradient-to-r from-sky-500 via-indigo-500 to-cyan-400'
                        }`}
                        style={{
                          width: isCompleted ? '100%' : isQueued ? '3%' : `${Math.max(3, item.progress)}%`,
                        }}
                      />
                    </div>

                    {/* Stage Message & Live Metrics */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs font-mono">
                      <span className="text-slate-300 truncate font-medium">
                        {item.message || (isQueued ? 'Waiting in line...' : isCompleted ? 'Compilation complete.' : '')}
                      </span>

                      {/* Live Encoding Stats Strip */}
                      {isRendering && item.stats && (
                        <div className="flex items-center gap-2 text-[11px] text-sky-400 shrink-0 font-mono">
                          {item.stats.currentFrame && item.stats.totalFrames ? (
                            <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                              Frame: <strong>{item.stats.currentFrame}</strong>/{item.stats.totalFrames}
                            </span>
                          ) : null}
                          {item.stats.fps ? (
                            <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                              {item.stats.fps.toFixed(1)} fps
                            </span>
                          ) : null}
                          {item.stats.speed ? (
                            <span className="bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                              {item.stats.speed}
                            </span>
                          ) : null}
                        </div>
                      )}

                      {/* Percentage readout */}
                      {!isRendering && (
                        <span
                          className={`shrink-0 font-bold ${
                            isCompleted ? 'text-emerald-400' : isFailed ? 'text-rose-400' : 'text-slate-400'
                          }`}
                        >
                          {isCompleted ? '100%' : isQueued ? 'Waiting' : `${item.progress}%`}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Auto-saved Destination Path Confirmation */}
                  {item.savedDestinationPath && (
                    <div className="flex items-center gap-2 text-xs font-mono text-emerald-300 bg-slate-950/80 px-3 py-1.5 rounded-xl border border-emerald-900/40">
                      <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      <span className="truncate">
                        Saved to folder: <strong className="text-white">{item.savedDestinationPath}</strong>
                      </span>
                    </div>
                  )}

                  {/* Error Notification */}
                  {isFailed && item.error && (
                    <div className="flex items-start gap-2 text-xs font-mono text-rose-300 bg-rose-950/40 px-3 py-2 rounded-xl border border-rose-900/50">
                      <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <strong>Error:</strong> {item.error}
                      </div>
                    </div>
                  )}

                  {/* Logs Drawer (Collapsible) */}
                  {isLogsOpen && (
                    <div className="pt-2">
                      <div className="bg-slate-950 rounded-xl border border-slate-800 p-3 max-h-48 overflow-y-auto font-mono text-[11px] text-slate-300 space-y-1">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wider pb-1 border-b border-slate-800 flex items-center justify-between">
                          <span>Live Console Logs</span>
                          <span>{item.logs?.length || 0} lines</span>
                        </div>
                        {item.logs && item.logs.length > 0 ? (
                          item.logs.map((log, lIdx) => (
                            <div key={lIdx} className="break-all font-mono leading-relaxed text-slate-400">
                              {log}
                            </div>
                          ))
                        ) : (
                          <div className="text-slate-600 italic">No logs recorded yet.</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline Preview Modal for completed videos */}
      {previewItem && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-800 bg-slate-950">
              <div className="flex items-center gap-2">
                <Film className="w-4 h-4 text-sky-400" />
                <span className="font-mono text-sm font-bold text-white truncate max-w-md">
                  {previewItem.outputFileName || previewItem.title}
                </span>
              </div>
              <button
                type="button"
                onClick={() => setPreviewItem(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 bg-black flex items-center justify-center min-h-[300px]">
              {previewItem.outputUrl ? (
                <video
                  src={previewItem.outputUrl}
                  controls
                  autoPlay
                  className="max-h-[60vh] w-auto rounded-lg shadow-lg"
                />
              ) : previewItem.outputBlob ? (
                <video
                  src={URL.createObjectURL(previewItem.outputBlob)}
                  controls
                  autoPlay
                  className="max-h-[60vh] w-auto rounded-lg shadow-lg"
                />
              ) : (
                <div className="text-slate-500 font-mono text-xs">No video preview stream available.</div>
              )}
            </div>

            <div className="p-4 border-t border-slate-800 bg-slate-950 flex items-center justify-between">
              <div className="text-xs font-mono text-slate-400">
                Duration: {previewItem.duration ? previewItem.duration.toFixed(1) : 0}s • {previewItem.slideCount} slides
              </div>
              <button
                type="button"
                onClick={() => {
                  onDownloadItem(previewItem);
                  setPreviewItem(null);
                }}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-xs font-bold flex items-center gap-2 shadow-lg shadow-emerald-600/30 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download Video</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

/**
 * Floating Mini Queue Dock (always visible when items are rendering or completed)
 */
export const FloatingQueueDock: React.FC<{
  items: QueueRenderItem[];
  onOpenQueue: () => void;
}> = ({ items, onOpenQueue }) => {
  const activeRendering = items.filter((i) => i.status === 'rendering' || i.status === 'preparing');
  const queuedItems = items.filter((i) => i.status === 'queued');
  const completedItems = items.filter((i) => i.status === 'completed');

  if (activeRendering.length === 0 && queuedItems.length === 0 && completedItems.length === 0) {
    return null;
  }

  const primaryItem = activeRendering[0] || queuedItems[0] || completedItems[0];

  return (
    <div
      onClick={onOpenQueue}
      className="fixed bottom-5 right-5 z-40 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/95 border border-sky-400/30 text-white shadow-2xl shadow-black/40 backdrop-blur-md cursor-pointer hover:bg-slate-800 transition-all hover:scale-[1.02] active:scale-[0.98]"
      title="Click to view full Render Queue"
    >
      {activeRendering.length > 0 ? (
        <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-sky-500/20 text-sky-400 border border-sky-400/30">
          <Loader2 className="w-4 h-4 animate-spin text-sky-400" />
        </div>
      ) : queuedItems.length > 0 ? (
        <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-400/30">
          <Clock className="w-4 h-4 text-amber-400" />
        </div>
      ) : (
        <div className="flex items-center justify-center w-7 h-7 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-400/30">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        </div>
      )}

      <div className="text-left font-mono">
        <div className="flex items-center gap-1.5 text-xs font-bold text-white">
          <span>
            {activeRendering.length > 0
              ? `Rendering (${primaryItem.progress}%)`
              : queuedItems.length > 0
              ? `In Queue (${queuedItems.length})`
              : 'Render Ready!'}
          </span>
          {queuedItems.length > 0 && activeRendering.length > 0 && (
            <span className="text-[10px] text-amber-300 font-normal">
              +{queuedItems.length} queued
            </span>
          )}
        </div>
        <div className="text-[11px] text-slate-400 truncate max-w-[200px]">
          {primaryItem.outputFileName || primaryItem.title}
        </div>
      </div>

      <div className="pl-2 border-l border-slate-700/80 text-[11px] font-mono font-bold text-sky-400 flex items-center gap-1">
        <span>View Queue</span>
        <ChevronUp className="w-3.5 h-3.5" />
      </div>
    </div>
  );
};
