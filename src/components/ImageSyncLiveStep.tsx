'use client';

import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import {
  UploadCloud,
  ImageIcon,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Trash2,
  Play,
  Pause,
  Clock,
  Film,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  X,
} from 'lucide-react';
import { ImageItem, ScriptParagraph, SyncMatch } from '../lib/types';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';

interface ImageSyncLiveStepProps {
  images: ImageItem[];
  paragraphs: ScriptParagraph[];
  matches: SyncMatch[];
  voiceoverUrl?: string | null;
  onImagesChange: (imgs: ImageItem[]) => void;
  onClearImages: () => void;
  onSendToTimeline: () => void;
}

export const ImageSyncLiveStep: React.FC<ImageSyncLiveStepProps> = ({
  images,
  paragraphs,
  matches,
  voiceoverUrl,
  onImagesChange,
  onClearImages,
  onSendToTimeline,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [previewModalImg, setPreviewModalImg] = useState<{ item: ImageItem; idx: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const processFiles = (files: FileList | File[]) => {
    const newItems: ImageItem[] = [];
    const validFiles = Array.from(files).filter(
      (f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|svg|gif)$/i.test(f.name)
    );

    // Sort naturally by filename
    validFiles.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    validFiles.forEach((file, index) => {
      const previewUrl = URL.createObjectURL(file);
      newItems.push({
        id: `img-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 7)}`,
        file,
        name: file.name,
        previewUrl,
        size: file.size,
      });
    });

    onImagesChange([...images, ...newItems]);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const moveImage = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= images.length) return;
    const updated = [...images];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    onImagesChange(updated);
  };

  const removeImage = (idx: number) => {
    const updated = [...images];
    const [removed] = updated.splice(idx, 1);
    if (removed.previewUrl.startsWith('blob:')) {
      URL.revokeObjectURL(removed.previewUrl);
    }
    onImagesChange(updated);
  };

  // Play audio snippet for this specific slide section
  const handlePlaySectionAudio = (match: SyncMatch, idx: number) => {
    if (!audioRef.current || !voiceoverUrl) return;

    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    if (playingIndex === idx) {
      audioRef.current.pause();
      setPlayingIndex(null);
      return;
    }

    audioRef.current.currentTime = match.startTime;
    audioRef.current.play().catch(() => {});
    setPlayingIndex(idx);

    const durationMs = Math.max(300, (match.endTime - match.startTime) * 1000);
    stopTimeoutRef.current = setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingIndex(null);
    }, durationMs);
  };

  // Validation status
  const targetCount = paragraphs.length;
  const currentCount = images.length;
  const hasImages = currentCount > 0;
  const isExactCount = targetCount > 0 && currentCount === targetCount;
  const isMissing = targetCount > 0 && currentCount < targetCount;
  const isExcess = targetCount > 0 && currentCount > targetCount;

  return (
    <div className="space-y-6">
      {voiceoverUrl && <audio ref={audioRef} src={voiceoverUrl} preload="auto" className="hidden" />}

      {/* Instant 1:1 Validation Banner */}
      <div
        className={`p-4 sm:p-5 rounded-2xl border transition-all ${
          hasImages
            ? 'bg-emerald-50/80 border-emerald-300 text-emerald-950 shadow-2xs'
            : 'bg-gray-50 border-gray-200 text-gray-800'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl border ${
                hasImages
                  ? 'bg-emerald-500 text-white border-emerald-600'
                  : 'bg-gray-400 text-white border-gray-500'
              }`}
            >
              {hasImages ? (
                <CheckCircle2 className="w-5 h-5" />
              ) : (
                <AlertTriangle className="w-5 h-5" />
              )}
            </div>

            <div className="space-y-0.5">
              <h4 className="text-sm font-bold font-mono">
                {isExactCount
                  ? `Validation Passed: Exactly ${currentCount} Images for ${targetCount} Paragraphs`
                  : targetCount === 0 && hasImages
                  ? `✓ ${currentCount} Images Ready • Auto-Syncing Across Speech Pauses`
                  : hasImages
                  ? `✓ ${currentCount} Images Ready (${targetCount} Script Paragraphs)`
                  : 'Upload Images to Match Voiceover Timeline'}
              </h4>
              <p className="text-xs opacity-80 font-sans">
                {hasImages
                  ? 'All images will be smoothly balanced across the voiceover, snapped to natural speech pauses. Ready for timeline!'
                  : 'Upload your image sequence below. Images will be automatically synchronized with audio.'}
              </p>
            </div>
          </div>

          {/* Action button inside banner */}
          <div className="flex items-center gap-2">
            {images.length > 0 && (
              <button
                type="button"
                onClick={onClearImages}
                className="px-3 py-1.5 rounded-lg text-xs font-mono font-semibold bg-white/80 hover:bg-white text-gray-700 border border-gray-300 transition-colors cursor-pointer"
              >
                Clear Images
              </button>
            )}

            <button
              type="button"
              onClick={onSendToTimeline}
              disabled={!hasImages}
              className={`px-5 py-2.5 rounded-xl font-mono text-xs sm:text-sm font-bold flex items-center gap-2 transition-all shadow-sm ${
                hasImages
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/30 scale-[1.02] active:scale-98 cursor-pointer'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Film className="w-4 h-4 fill-current" />
              <span>Send to Timeline 🎬</span>
            </button>
          </div>
        </div>
      </div>

      {/* Upload Dropzone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-all ${
          isDragging
            ? 'border-red-500 bg-red-50/50 scale-[1.01]'
            : 'border-gray-300 hover:border-red-400 bg-white hover:bg-gray-50/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        <div className="max-w-md mx-auto space-y-2 flex flex-col items-center">
          <div className="p-3 rounded-2xl bg-red-50 text-red-600 border border-red-200">
            <UploadCloud className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-bold font-mono text-gray-900">
              Drag &amp; drop images or click to select
            </p>
            <p className="text-xs text-gray-500 mt-0.5 font-sans">
              Images are automatically paired 1:1 with paragraphs by filename order (1.jpg, 2.jpg...)
            </p>
          </div>
        </div>
      </div>

      {/* Live Syncing Preview Grid */}
      {matches.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-2 border-b border-gray-200">
            <div className="flex items-center gap-2">
              <Layers className="w-4 h-4 text-red-600" />
              <h3 className="text-sm font-bold font-mono text-gray-900">
                Live Syncing Preview Grid
              </h3>
              <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 border border-gray-200">
                {Math.min(images.length, matches.length)} of {matches.length} Linked
              </span>
            </div>

            <p className="text-xs text-gray-500 font-mono hidden sm:block">
              Verify pairing, test voiceover sections, or reorder images
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {matches.map((match, idx) => {
              const image = images[idx] || null;
              const isPlayingThis = playingIndex === idx;

              return (
                <div
                  key={idx}
                  className={`rounded-2xl border transition-all overflow-hidden bg-white shadow-2xs flex flex-col ${
                    image ? 'border-gray-200 hover:border-gray-300' : 'border-dashed border-amber-300 bg-amber-50/20'
                  }`}
                >
                  {/* Top Image Preview Container */}
                  <div className="relative aspect-video w-full bg-gray-900 flex items-center justify-center overflow-hidden group">
                    {image ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={image.previewUrl}
                          alt={image.name}
                          className="w-full h-full object-contain transition-transform group-hover:scale-105 duration-300"
                        />
                        {/* Action buttons over thumbnail */}
                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPreviewModalImg({ item: image, idx });
                            }}
                            className="p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-white backdrop-blur-xs transition-colors cursor-pointer"
                            title="Maximize image"
                          >
                            <Maximize2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeImage(idx);
                            }}
                            className="p-1.5 rounded-lg bg-red-600/80 hover:bg-red-600 text-white backdrop-blur-xs transition-colors cursor-pointer"
                            title="Remove image"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>

                        {/* Reorder Arrows on bottom edges of image */}
                        <div className="absolute bottom-2 left-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveImage(idx, idx - 1);
                            }}
                            className="p-1 rounded-md bg-black/60 hover:bg-black/90 disabled:opacity-30 text-white text-xs cursor-pointer"
                            title="Move left / previous"
                          >
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx >= images.length - 1}
                            onClick={(e) => {
                              e.stopPropagation();
                              moveImage(idx, idx + 1);
                            }}
                            className="p-1 rounded-md bg-black/60 hover:bg-black/90 disabled:opacity-30 text-white text-xs cursor-pointer"
                            title="Move right / next"
                          >
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <div className="text-center p-4 space-y-1.5">
                        <ImageIcon className="w-8 h-8 text-amber-400 mx-auto" />
                        <p className="text-xs font-mono font-bold text-amber-200">
                          Awaiting Image #{idx + 1}
                        </p>
                        <p className="text-[10px] text-amber-300/70">
                          Drop an image to pair with this slide
                        </p>
                      </div>
                    )}

                    {/* Badge Overlay */}
                    <div className="absolute top-2 left-2 flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-xs text-[11px] font-mono font-bold text-white border border-white/10">
                        Slide #{idx + 1}
                      </span>
                    </div>
                  </div>

                  {/* Card Body: Paragraph details & Timings */}
                  <div className="p-3.5 flex-1 flex flex-col justify-between space-y-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] font-mono text-gray-500">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span>
                            {formatSecondsToTimestamp(match.startTime)} &rarr; {formatSecondsToTimestamp(match.endTime)}
                          </span>
                        </span>
                        <span className="font-bold text-gray-900 bg-gray-100 px-1.5 py-0.2 rounded">
                          {match.duration.toFixed(2)}s
                        </span>
                      </div>

                      {/* Paragraph Text Preview */}
                      <p className="text-xs text-gray-800 line-clamp-2 leading-relaxed">
                        {match.paragraph.text}
                      </p>
                    </div>

                    {/* Bottom Audio Section Player */}
                    <div className="pt-2 border-t border-gray-100 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-mono text-gray-400 truncate max-w-[130px]">
                        {image ? image.name : 'No image assigned'}
                      </span>

                      {voiceoverUrl && (
                        <button
                          type="button"
                          onClick={() => handlePlaySectionAudio(match, idx)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                            isPlayingThis
                              ? 'bg-red-600 text-white font-bold shadow-xs'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                        >
                          {isPlayingThis ? (
                            <>
                              <Pause className="w-3 h-3 fill-current" />
                              <span>Playing...</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Play Audio</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Send to Timeline Callout */}
          <div className="pt-4 flex items-center justify-between p-4 rounded-2xl bg-gray-50 border border-gray-200">
            <div className="text-xs font-mono text-gray-600">
              {isExactCount ? (
                <span className="text-emerald-700 font-bold">
                  All {currentCount} slides verified with exact speech timings.
                </span>
              ) : (
                <span className="text-amber-700 font-semibold">
                  Upload all required images to unlock the full CapCut-style timeline.
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={onSendToTimeline}
              disabled={!isExactCount}
              className={`px-6 py-3 rounded-xl font-mono text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer shadow-md ${
                isExactCount
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/30 scale-[1.02] active:scale-98'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Film className="w-4 h-4 fill-current" />
              <span>Send to Timeline Studio &rarr;</span>
            </button>
          </div>
        </div>
      )}

      {/* Modal for Full Image Preview */}
      {previewModalImg && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewModalImg(null)}
        >
          <div
            className="relative max-w-4xl max-h-[90vh] bg-gray-950 rounded-2xl overflow-hidden border border-gray-800 p-2"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewModalImg(null)}
              className="absolute top-4 right-4 z-10 p-2 rounded-full bg-black/60 hover:bg-black text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={previewModalImg.item.previewUrl}
              alt={previewModalImg.item.name}
              className="max-w-full max-h-[80vh] object-contain rounded-xl mx-auto"
            />
            <div className="p-3 text-center text-xs font-mono text-gray-300">
              Slide #{previewModalImg.idx + 1}: {previewModalImg.item.name}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
