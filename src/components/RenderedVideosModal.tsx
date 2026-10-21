'use client';

import React, { useState, useEffect } from 'react';
import {
  Film,
  Download,
  Trash2,
  Play,
  X,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Calendar,
  Archive,
  FolderArchive,
  FileVideo,
} from 'lucide-react';
import { RenderedVideoItem } from '@/lib/types';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';

interface RenderedVideosModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectVideoForWorkspace?: (video: RenderedVideoItem) => void;
  onLibraryUpdated?: () => void;
}

export const RenderedVideosModal: React.FC<RenderedVideosModalProps> = ({
  isOpen,
  onClose,
  onSelectVideoForWorkspace,
  onLibraryUpdated,
}) => {
  const [videos, setVideos] = useState<RenderedVideoItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [activePreviewVideo, setActivePreviewVideo] = useState<RenderedVideoItem | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchVideos = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch('/api/renders');
      const data = await resp.json();
      if (data.success && Array.isArray(data.videos)) {
        setVideos(data.videos);
        onLibraryUpdated?.();
      } else {
        setError(data.error || 'Failed to load exported files library.');
      }
    } catch (err: any) {
      setError(err.message || 'Could not connect to exported files library.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchVideos();
    } else {
      setActivePreviewVideo(null);
    }
  }, [isOpen]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('Delete this file from 24-hour local storage? (Downloaded files on your computer will not be touched).')) {
      return;
    }

    setDeletingId(id);
    try {
      const resp = await fetch(`/api/renders/${id}`, { method: 'DELETE' });
      const data = await resp.json();
      if (data.success) {
        setVideos((prev) => prev.filter((v) => v.id !== id));
        if (activePreviewVideo?.id === id) {
          setActivePreviewVideo(null);
        }
        onLibraryUpdated?.();
      } else {
        alert(data.error || 'Could not delete file.');
      }
    } catch (err: any) {
      alert('Failed to remove file: ' + err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(1)} KB`;
  };

  const getRelativeTime = (isoString: string): string => {
    try {
      const diffMs = Date.now() - new Date(isoString).getTime();
      const diffSec = Math.floor(diffMs / 1000);
      if (diffSec < 45) return 'just now';
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDays = Math.floor(diffHr / 24);
      return `${diffDays}d ago`;
    } catch {
      return '';
    }
  };

  const getRemainingTime = (expiresAtStr: string) => {
    const diffMs = new Date(expiresAtStr).getTime() - Date.now();
    if (diffMs <= 0) {
      return { text: 'Expiring now', isUrgent: true, color: 'text-rose-400 bg-rose-500/15 border-rose-500/30' };
    }
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    if (hours > 12) {
      return {
        text: `⏳ ${hours}h ${minutes}m left`,
        isUrgent: false,
        color: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30',
      };
    } else if (hours > 2) {
      return {
        text: `⏳ ${hours}h ${minutes}m left`,
        isUrgent: false,
        color: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
      };
    } else {
      return {
        text: `⚠️ ${hours}h ${minutes}m left`,
        isUrgent: true,
        color: 'text-rose-400 bg-rose-500/15 border-rose-500/30 animate-pulse',
      };
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto animate-fade-in">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 text-sky-400 border border-sky-500/30">
              <FolderArchive className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h3 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  Exported Files Library
                </h3>
                <span className="text-xs px-2.5 py-0.5 rounded-full font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 font-mono">
                  {videos.length} Available
                </span>
              </div>
              <p className="text-xs text-slate-400">
                All exported files (Unified MP4 videos &amp; Clips ZIP packages) with timings, sizes, and direct downloads.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchVideos}
              disabled={loading}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Refresh Library"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-sky-400' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 24-Hour Policy Notice Banner */}
        <div className="px-6 py-3 bg-sky-950/30 border-b border-sky-900/40 flex items-center justify-between text-xs text-sky-200 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-sky-400 shrink-0" />
            <span>
              <strong>24-Hour Auto-Reset Notice:</strong> Exported files are preserved in local storage for 24 hours. After 24 hours, they automatically reset and delete from local server storage to save disk space. Files already downloaded to your computer will <u>never</u> be deleted.
            </span>
          </div>
          <span className="text-[11px] opacity-80 font-mono shrink-0">Auto-resets after 24h</span>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar">
          {/* Active In-Modal Preview Player */}
          {activePreviewVideo && (
            <div className="p-4 sm:p-5 rounded-2xl bg-slate-950 border border-sky-500/40 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-xs font-bold text-sky-400 uppercase tracking-wider">
                    {activePreviewVideo.exportMode === 'clips_zip' || activePreviewVideo.filename.endsWith('.zip')
                      ? 'Clips Archive'
                      : 'Video Preview'}
                  </span>
                  <span className="text-xs font-semibold text-slate-300 line-clamp-1 truncate max-w-sm">
                    {activePreviewVideo.filename || activePreviewVideo.title}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={activePreviewVideo.downloadUrl}
                    download={activePreviewVideo.filename}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>
                      {activePreviewVideo.exportMode === 'clips_zip' || activePreviewVideo.filename.endsWith('.zip')
                        ? 'Download ZIP'
                        : 'Download MP4'}
                    </span>
                  </a>
                  <button
                    type="button"
                    onClick={() => setActivePreviewVideo(null)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Video Player or Archive Card */}
              {activePreviewVideo.exportMode === 'clips_zip' || activePreviewVideo.filename.endsWith('.zip') ? (
                <div className="p-6 rounded-xl bg-slate-900/90 border border-sky-500/30 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
                      <Archive className="w-8 h-8" />
                    </div>
                    <div className="space-y-1">
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>Clips ZIP Package</span>
                        <span className="px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 text-[10px] font-mono font-bold">
                          {activePreviewVideo.slideCount} Clips
                        </span>
                      </h4>
                      <p className="text-xs text-slate-400 max-w-md">
                        Every slide was rendered into an individual synchronized video clip with exact timeline duration and audio sync.
                      </p>
                    </div>
                  </div>
                  <a
                    href={activePreviewVideo.downloadUrl}
                    download={activePreviewVideo.filename}
                    className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-sky-500/20 flex items-center gap-2 shrink-0 transition-transform active:scale-95 cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Clips Archive (.zip)</span>
                  </a>
                </div>
              ) : (
                <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-slate-800 shadow-inner">
                  <video
                    src={activePreviewVideo.streamUrl}
                    controls
                    autoPlay
                    playsInline
                    className="w-full h-full object-contain"
                  />
                </div>
              )}

              {/* Metadata strip below preview */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 pt-1">
                <div className="flex items-center gap-4">
                  <span>Duration: <strong className="text-slate-200">{formatSecondsToTimestamp(activePreviewVideo.duration)}</strong></span>
                  <span>Size: <strong className="text-slate-200">{formatFileSize(activePreviewVideo.fileSizeBytes)}</strong></span>
                  <span>Resolution: <strong className="text-slate-200">{activePreviewVideo.resolution}</strong></span>
                  <span>Slides: <strong className="text-slate-200">{activePreviewVideo.slideCount}</strong></span>
                </div>
                {onSelectVideoForWorkspace && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectVideoForWorkspace(activePreviewVideo);
                      onClose();
                    }}
                    className="px-3 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/30 font-semibold cursor-pointer transition-colors"
                  >
                    Load into Main Workspace
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Videos Grid */}
          {loading && videos.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-sky-400 animate-spin mx-auto" />
              <p className="text-sm font-semibold text-slate-300">Checking 24-hour exported files...</p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-red-950/40 border border-red-800/80 text-center space-y-2">
              <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
              <p className="text-sm font-bold text-red-200">{error}</p>
              <button
                type="button"
                onClick={fetchVideos}
                className="px-4 py-1.5 rounded-xl bg-red-800/80 hover:bg-red-700 text-white font-semibold text-xs transition-colors cursor-pointer"
              >
                Try Again
              </button>
            </div>
          ) : videos.length === 0 ? (
            <div className="py-16 text-center space-y-3 bg-slate-950/40 rounded-3xl border border-slate-800/80">
              <FolderArchive className="w-12 h-12 text-slate-600 mx-auto" />
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-200">No Exported Files Yet</h4>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  When you export a Single Unified Video (.mp4) or Clips ZIP Archive (.zip), your finished files will appear here with timings and file sizes, staying available for 24 hours.
                </p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {videos.map((video) => {
                const isZip = video.exportMode === 'clips_zip' || video.filename.endsWith('.zip');
                const remaining = getRemainingTime(video.expiresAt);
                const isSelected = activePreviewVideo?.id === video.id;
                const createdDate = new Date(video.createdAt);
                const formattedDate = createdDate.toLocaleString(undefined, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                });
                const relativeTime = getRelativeTime(video.createdAt);

                return (
                  <div
                    key={video.id}
                    onClick={() => setActivePreviewVideo(video)}
                    className={`group relative rounded-2xl border p-4 transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                      isSelected
                        ? 'bg-slate-900 border-sky-500 ring-2 ring-sky-500/20 shadow-xl'
                        : 'bg-slate-950/70 hover:bg-slate-900/90 border-slate-800 hover:border-slate-700 shadow-md'
                    }`}
                  >
                    {/* Top Row: Thumbnail + Info */}
                    <div className="flex gap-3.5">
                      {/* Video Thumbnail Frame */}
                      <div className="relative aspect-video w-32 sm:w-36 rounded-xl bg-black border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                        {video.hasThumbnail ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={video.thumbnailUrl}
                            alt={video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : isZip ? (
                          <Archive className="w-8 h-8 text-sky-400" />
                        ) : (
                          <FileVideo className="w-8 h-8 text-indigo-400" />
                        )}

                        {/* Duration pill on thumbnail */}
                        <div className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 backdrop-blur-xs text-[10px] font-mono font-bold text-white">
                          {formatSecondsToTimestamp(video.duration)}
                        </div>

                        {/* Play / Inspect hover overlay */}
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <div className={`p-2 rounded-full text-white shadow-lg ${isZip ? 'bg-sky-600' : 'bg-indigo-600'}`}>
                            {isZip ? <Archive className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
                          </div>
                        </div>
                      </div>

                      {/* Video Info */}
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Format Mode Badge */}
                        <div>
                          {isZip ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-sky-500/15 text-sky-300 border border-sky-500/30">
                              <Archive className="w-3 h-3 text-sky-400" />
                              <span>Clips ZIP Archive (.zip)</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold font-mono bg-violet-500/15 text-violet-300 border border-violet-500/30">
                              <Film className="w-3 h-3 text-violet-400" />
                              <span>Unified Video (.mp4)</span>
                            </span>
                          )}
                        </div>

                        <div className="flex items-start justify-between gap-1">
                          <h4 className="text-xs sm:text-sm font-bold text-white line-clamp-1 truncate group-hover:text-sky-300 transition-colors font-mono" title={video.filename || video.title}>
                            {video.filename || video.title}
                          </h4>
                        </div>

                        {/* Date Created ("When Made") */}
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                          <Calendar className="w-3 h-3 text-slate-500 shrink-0" />
                          <span>
                            {formattedDate} {relativeTime ? `(${relativeTime})` : ''}
                          </span>
                        </div>

                        {/* Badges: Resolution, Size, Slides */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono font-semibold text-slate-300">
                            {video.resolution}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono font-bold text-emerald-300">
                            {formatFileSize(video.fileSizeBytes)}
                          </span>
                          <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 text-[10px] font-mono font-semibold text-slate-300">
                            {video.slideCount} {isZip ? 'clips' : 'slides'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Expiration Badge + Actions */}
                    <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between gap-2">
                      {/* Remaining retention time */}
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${remaining.color}`} title="Auto-resets after 24h">
                        {remaining.text}
                      </span>

                      {/* Action buttons */}
                      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => setActivePreviewVideo(video)}
                          className="px-2.5 py-1 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                          title={isZip ? 'Inspect clips archive' : 'Watch video preview'}
                        >
                          {isZip ? (
                            <>
                              <Archive className="w-3 h-3" />
                              <span>Inspect</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Watch</span>
                            </>
                          )}
                        </button>

                        <a
                          href={video.downloadUrl}
                          download={video.filename}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1 shadow-sm transition-colors cursor-pointer"
                          title={`Download ${video.filename} to your device`}
                        >
                          <Download className="w-3 h-3" />
                          <span>{isZip ? 'Download ZIP' : 'Download MP4'}</span>
                        </a>

                        <button
                          type="button"
                          onClick={(e) => handleDelete(e, video.id)}
                          disabled={deletingId === video.id}
                          className="p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors cursor-pointer"
                          title="Delete from 24h local storage"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Files downloaded to your device remain permanently safe on your computer.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
