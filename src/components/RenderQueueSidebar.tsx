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
  ChevronLeft,
  ChevronRight,
  HardDrive,
  Film,
  Archive,
  Play,
  Zap,
} from 'lucide-react';
import { QueueRenderItem } from '@/lib/types';

interface RenderQueueSidebarProps {
  items: QueueRenderItem[];
  onCancelItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onClearCompleted: () => void;
  onDownloadItem: (item: QueueRenderItem) => void;
  onPreviewItem?: (item: QueueRenderItem) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

export const RenderQueueSidebar: React.FC<RenderQueueSidebarProps> = ({
  items,
  onCancelItem,
  onDeleteItem,
  onClearCompleted,
  onDownloadItem,
  onPreviewItem,
  isCollapsed: controlledIsCollapsed,
  onToggleCollapse,
}) => {
  const [internalIsCollapsed, setInternalIsCollapsed] = useState<boolean>(false);
  const [expandedLogsId, setExpandedLogsId] = useState<string | null>(null);

  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalIsCollapsed;

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalIsCollapsed((prev) => !prev);
    }
  };

  const activeRendering = items.filter((i) => i.status === 'rendering' || i.status === 'preparing');
  const queuedItems = items.filter((i) => i.status === 'queued');
  const hasFinished = items.some((i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled');

  const toggleLogs = (id: string) => {
    setExpandedLogsId((prev) => (prev === id ? null : id));
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

  if (isCollapsed) {
    return (
      <aside className="w-14 shrink-0 bg-slate-900/90 border-l border-slate-800 flex flex-col items-center py-3 transition-all duration-300 z-20 select-none">
        <button
          onClick={handleToggle}
          title="Expand Render Queue"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition shadow-sm mb-4 cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="relative mb-6 cursor-pointer" onClick={handleToggle}>
          <div className="w-8 h-8 rounded-lg bg-indigo-600/90 text-white flex items-center justify-center shadow-md shadow-indigo-600/20">
            <Layers className="w-4 h-4" />
          </div>
          {items.length > 0 && (
            <span className="absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full bg-indigo-500 text-white text-[9px] font-bold font-mono">
              {items.length}
            </span>
          )}
        </div>

        {activeRendering.length > 0 && (
          <div className="w-8 h-8 rounded-lg bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-indigo-400 mb-2 animate-pulse">
            <Loader2 className="w-4 h-4 animate-spin" />
          </div>
        )}

        <div className="w-full flex-1 overflow-y-auto space-y-2 px-1">
          {items.map((item) => (
            <div
              key={item.id}
              onClick={handleToggle}
              title={`${item.title} (${item.status})`}
              className={`w-9 h-9 mx-auto rounded-lg flex items-center justify-center text-[10px] font-bold cursor-pointer transition ${
                item.status === 'rendering'
                  ? 'bg-indigo-500/20 text-indigo-400 border border-indigo-500/40 animate-pulse'
                  : item.status === 'queued'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : item.status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {item.status === 'rendering' ? (
                `${item.progress}%`
              ) : item.status === 'queued' ? (
                <Clock className="w-3.5 h-3.5" />
              ) : item.status === 'completed' ? (
                <CheckCircle2 className="w-3.5 h-3.5" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5" />
              )}
            </div>
          ))}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-80 shrink-0 bg-slate-900/90 border-l border-slate-800 flex flex-col h-full transition-all duration-300 z-20">
      {/* Header (h-14) */}
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-600/90 text-white flex items-center justify-center shadow-sm">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-bold text-white tracking-wide">
              Render Queue
            </h2>
            {items.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-800 text-indigo-400 border border-slate-700/60 font-mono text-[10px] font-bold">
                {items.length}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1">
          {hasFinished && (
            <button
              onClick={onClearCompleted}
              title="Clear Finished Renders"
              className="px-2 py-1 rounded text-[11px] font-medium text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
            >
              Clear Done
            </button>
          )}
          <button
            onClick={handleToggle}
            title="Collapse Sidebar"
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Queue Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {items.length === 0 ? (
          <div className="p-8 text-center text-slate-500 text-xs">
            <div className="w-10 h-10 rounded-xl bg-slate-800/40 border border-slate-800 flex items-center justify-center mx-auto mb-2 text-slate-600">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-slate-400 mb-1">Queue is empty</h3>
            <p className="leading-relaxed text-[11px]">
              Click <strong className="text-slate-300">"Compile &amp; Add to Render Queue"</strong> to start a job.
            </p>
          </div>
        ) : (
          items.map((item) => {
            const isRendering = item.status === 'rendering' || item.status === 'preparing';
            const isQueued = item.status === 'queued';
            const isCompleted = item.status === 'completed';
            const isFailed = item.status === 'failed';
            const isCancelled = item.status === 'cancelled';
            const isLogsOpen = expandedLogsId === item.id;
            const fileSize = formatFileSize(item.outputSize);

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3 transition-all ${
                  isRendering
                    ? 'bg-slate-900 border-indigo-500/50 shadow-md shadow-indigo-500/10 ring-1 ring-indigo-500/30'
                    : isQueued
                    ? 'bg-slate-900 border-amber-500/30'
                    : isCompleted
                    ? 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    : 'bg-slate-900 border-rose-500/30'
                }`}
              >
                {/* Top Row: Filename + Status Pill */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <h4
                      className="text-xs font-semibold text-slate-100 truncate"
                      title={item.title || item.outputFileName}
                    >
                      {item.outputFileName || item.title || 'Untitled Video'}
                    </h4>
                  </div>

                  <div className="shrink-0">
                    {isRendering ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        {item.progress}%
                      </span>
                    ) : isQueued ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                        <Clock className="w-2.5 h-2.5" />
                        Queued
                      </span>
                    ) : isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Ready
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                        Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle Row: Metadata */}
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-mono mb-2">
                  <span>{item.resolution}</span>
                  <span>•</span>
                  <span>{item.slideCount} slides</span>
                  <span>•</span>
                  <span>{formatTimeAgo(item.createdAt)}</span>
                </div>

                {/* Progress Bar (Rendering & Queued) */}
                {(isRendering || isQueued) && (
                  <div className="space-y-1 mb-2">
                    <div className="w-full bg-slate-950 rounded-full h-1.5 overflow-hidden p-[1px]">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isRendering
                            ? 'bg-gradient-to-r from-indigo-500 to-purple-500 shadow-sm'
                            : 'bg-amber-500/30'
                        }`}
                        style={{ width: isRendering ? `${Math.max(4, item.progress)}%` : '0%' }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-400">
                      <span className="truncate pr-1 text-slate-300">
                        {item.message || (isQueued ? 'Waiting in queue...' : 'Encoding frames...')}
                      </span>
                      {isRendering && item.stats?.fps && (
                        <span className="font-mono text-indigo-400 shrink-0">
                          {item.stats.fps} fps
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Error message */}
                {isFailed && item.error && (
                  <div className="my-1.5 p-2 rounded-lg bg-rose-950/40 border border-rose-800/40 text-[10px] text-rose-300">
                    <p className="line-clamp-2">{item.error}</p>
                  </div>
                )}

                {/* Saved local destination notice */}
                {item.savedDestinationPath && (
                  <div className="my-1 flex items-center gap-1 text-[10px] text-emerald-400/90 truncate">
                    <HardDrive className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={item.savedDestinationPath}>
                      Saved: {item.savedDestinationPath}
                    </span>
                  </div>
                )}

                {/* Bottom Action Row */}
                <div className="pt-2 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {isCompleted && (
                      <>
                        <button
                          onClick={() => onDownloadItem(item)}
                          className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download {fileSize ? `(${fileSize})` : ''}</span>
                        </button>

                        {onPreviewItem && (
                          <button
                            onClick={() => onPreviewItem(item)}
                            title="Preview Video"
                            className="p-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    )}

                    {(isRendering || isQueued) && (
                      <button
                        onClick={() => onCancelItem(item.id)}
                        className="px-2 py-1 rounded-md bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/50 text-[10px] font-medium flex items-center gap-1 transition cursor-pointer"
                      >
                        <XCircle className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 ml-auto">
                    {item.logs && item.logs.length > 0 && (
                      <button
                        onClick={() => toggleLogs(item.id)}
                        title="Toggle Engine Logs"
                        className={`p-1 rounded text-[10px] transition cursor-pointer ${
                          isLogsOpen
                            ? 'bg-slate-800 text-white'
                            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                        }`}
                      >
                        <Terminal className="w-3 h-3" />
                      </button>
                    )}

                    {(isCompleted || isFailed || isCancelled) && (
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        title="Dismiss from Queue"
                        className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Logs Drawer */}
                {isLogsOpen && item.logs && item.logs.length > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-black/80 border border-slate-800 font-mono text-[9px] text-slate-300 max-h-32 overflow-y-auto space-y-0.5">
                    {item.logs.slice(-15).map((log, lIdx) => (
                      <div key={lIdx} className="leading-tight break-all">
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="h-10 px-3 border-t border-slate-800 bg-slate-950/40 text-[10px] text-slate-500 flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-indigo-400" />
          <span>Intel QSV Parallel Engine</span>
        </span>
        <span className="font-mono text-slate-400">
          {activeRendering.length > 0 ? 'Active' : 'Idle'}
        </span>
      </div>
    </aside>
  );
};
