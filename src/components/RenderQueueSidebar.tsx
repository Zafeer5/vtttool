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
  ChevronRight,
  HardDrive,
  Play,
  Zap,
  RotateCcw,
  Activity,
} from 'lucide-react';
import { QueueRenderItem } from '@/lib/types';

interface RenderQueueSidebarProps {
  items: QueueRenderItem[];
  onCancelItem: (id: string) => void;
  onDeleteItem: (id: string) => void;
  onClearCompleted: () => void;
  onDownloadItem: (item: QueueRenderItem) => void;
  onPreviewItem?: (item: QueueRenderItem) => void;
  onRetryItem?: (id: string) => void;
  onViewProgressItem?: (item: QueueRenderItem) => void;
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
  onRetryItem,
  onViewProgressItem,
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
  const hasFinished = items.some((i) => i.status === 'completed' || i.status === 'failed' || i.status === 'cancelled');

  const toggleLogs = (id: string) => {
    setExpandedLogsId((prev) => (prev === id ? null : id));
  };

  const formatTimeAgo = (ts?: number) => {
    if (!ts) return 'just now';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes || bytes <= 0) return null;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (isCollapsed) {
    return (
      <aside className="w-14 shrink-0 bg-slate-50 border-l border-slate-200 flex flex-col items-center py-3 transition-all duration-300 z-20 select-none">
        <button
          onClick={handleToggle}
          title="Expand Render Queue"
          className="p-1.5 rounded-lg bg-white hover:bg-slate-100 text-slate-600 hover:text-slate-900 border border-slate-200 transition shadow-2xs mb-4 cursor-pointer"
        >
          <Layers className="w-4 h-4 text-orange-600" />
        </button>

        {activeRendering.length > 0 && (
          <div className="w-2.5 h-2.5 rounded-full bg-orange-600 animate-ping mb-3" />
        )}

        <div className="w-full flex-1 overflow-y-auto space-y-2 px-1">
          {items.map((item) => (
            <div
              key={item.id}
              title={`${item.title || item.outputFileName} (${item.status})`}
              className={`w-9 h-9 mx-auto rounded-lg flex items-center justify-center text-[10px] font-bold border transition ${
                item.status === 'rendering'
                  ? 'bg-orange-50 text-orange-700 border-orange-300 animate-pulse'
                  : item.status === 'queued'
                  ? 'bg-amber-50 text-amber-700 border-amber-200'
                  : item.status === 'completed'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-rose-50 text-rose-700 border-rose-200'
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
    <aside className="w-80 shrink-0 bg-slate-50 border-l border-slate-200 flex flex-col h-full transition-all duration-300 z-20 select-none">
      {/* Header (h-14) */}
      <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0 bg-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-orange-50 border border-orange-200 text-orange-600 flex items-center justify-center shadow-2xs">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-bold text-slate-900 tracking-wide">
              Render Queue
            </h2>
            {items.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-mono text-[10px] font-bold">
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
              className="px-2 py-1 rounded text-[11px] font-medium text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
            >
              Clear Done
            </button>
          )}
          <button
            onClick={handleToggle}
            title="Collapse Sidebar"
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Queue Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
        {items.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-xs">
            <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center mx-auto mb-2 text-slate-400 shadow-2xs">
              <Layers className="w-5 h-5" />
            </div>
            <h3 className="text-xs font-semibold text-slate-700 mb-1">Queue is empty</h3>
            <p className="leading-relaxed text-[11px] text-slate-500">
              Click <strong className="text-orange-600">&quot;Render Video&quot;</strong> to start a job.
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
                    ? 'bg-white border-orange-400 shadow-xs ring-1 ring-orange-500/20'
                    : isQueued
                    ? 'bg-white border-amber-300 shadow-2xs'
                    : isCompleted
                    ? 'bg-white border-emerald-300 shadow-2xs'
                    : 'bg-white border-rose-300 shadow-2xs'
                }`}
              >
                {/* Top Row: Filename + Status Pill */}
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="min-w-0 flex-1">
                    <h4
                      className="text-xs font-semibold text-slate-900 truncate"
                      title={item.title || item.outputFileName}
                    >
                      {item.outputFileName || item.title || 'Untitled Video'}
                    </h4>
                  </div>

                  <div className="shrink-0">
                    {isRendering ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-orange-50 text-orange-700 border border-orange-200 animate-pulse">
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                        {item.progress}%
                      </span>
                    ) : isQueued ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        <Clock className="w-2.5 h-2.5" />
                        Queued
                      </span>
                    ) : isCompleted ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Ready
                      </span>
                    ) : item.status === 'interrupted' ? (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                        Interrupted
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                        Failed
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle Row: Metadata */}
                <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-mono mb-2">
                  <span>{item.resolution}</span>
                  <span>•</span>
                  <span>{item.slideCount} slides</span>
                  <span>•</span>
                  <span>{formatTimeAgo(item.createdAt)}</span>
                </div>

                {/* Progress Bar (Rendering & Queued) */}
                {(isRendering || isQueued) && (
                  <div className="space-y-1 mb-2">
                    <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden p-[1px] border border-slate-200">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          isRendering
                            ? 'bg-gradient-to-r from-orange-600 to-orange-500 shadow-xs'
                            : 'bg-amber-300'
                        }`}
                        style={{ width: isRendering ? `${Math.max(0, Math.min(100, item.progress))}%` : '0%' }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-slate-500">
                      <span className="truncate pr-1 text-slate-700">
                        {item.message || (isQueued ? 'Waiting in queue...' : 'Encoding frames...')}
                      </span>
                      {isRendering && item.stats?.fps && (
                        <span className="font-mono text-orange-600 shrink-0 font-bold">
                          {item.stats.fps} fps
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Error message */}
                {isFailed && item.error && (
                  <div className="my-1.5 p-2 rounded-lg bg-rose-50 border border-rose-200 text-[10px] text-rose-700">
                    <p className="line-clamp-2">{item.error}</p>
                  </div>
                )}

                {/* Saved local destination notice */}
                {item.savedDestinationPath && (
                  <div className="my-1 flex items-center gap-1 text-[10px] text-emerald-700 truncate">
                    <HardDrive className="w-3 h-3 shrink-0" />
                    <span className="truncate" title={item.savedDestinationPath}>
                      Saved: {item.savedDestinationPath}
                    </span>
                  </div>
                )}

                {/* Bottom Action Row */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {isCompleted && (
                      <>
                        <button
                          onClick={() => onDownloadItem(item)}
                          className="px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-700 text-white text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
                        >
                          <Download className="w-3 h-3" />
                          <span>Download {fileSize ? `(${fileSize})` : ''}</span>
                        </button>

                        {onPreviewItem && (
                          <button
                            onClick={() => onPreviewItem(item)}
                            title="Preview Video"
                            className="p-1.5 rounded-md bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 transition cursor-pointer"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                      </>
                    )}

                    {(isRendering || isQueued) && (
                      <div className="flex items-center gap-1">
                        {onViewProgressItem && (
                          <button
                            type="button"
                            onClick={() => onViewProgressItem(item)}
                            className="px-2 py-1 rounded-md bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-medium flex items-center gap-1 transition cursor-pointer"
                          >
                            <Activity className="w-3 h-3" />
                            <span>Progress</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onCancelItem(item.id)}
                          className="px-2 py-1 rounded-md bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[10px] font-medium flex items-center gap-1 transition cursor-pointer"
                        >
                          <XCircle className="w-3 h-3" />
                          <span>Cancel</span>
                        </button>
                      </div>
                    )}

                    {(isFailed || isCancelled || item.status === 'interrupted') && onRetryItem && (
                      <button
                        type="button"
                        onClick={() => onRetryItem(item.id)}
                        className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-700 border border-amber-200 text-[10px] font-semibold flex items-center gap-1 transition cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        <span>Retry</span>
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
                            ? 'bg-slate-200 text-slate-900'
                            : 'text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        <Terminal className="w-3 h-3" />
                      </button>
                    )}

                    {(isCompleted || isFailed || isCancelled) && (
                      <button
                        onClick={() => onDeleteItem(item.id)}
                        title="Dismiss from Queue"
                        className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Logs Drawer */}
                {isLogsOpen && item.logs && item.logs.length > 0 && (
                  <div className="mt-2 p-2 rounded-lg bg-slate-900 border border-slate-800 font-mono text-[9px] text-slate-200 max-h-32 overflow-y-auto space-y-0.5">
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
      <div className="h-10 px-3 border-t border-slate-200 bg-white text-[10px] text-slate-500 flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-orange-600" />
          <span>Intel QSV Parallel Engine</span>
        </span>
        <span className="font-mono text-slate-500 font-semibold">
          {activeRendering.length > 0 ? 'Active' : 'Idle'}
        </span>
      </div>
    </aside>
  );
};
