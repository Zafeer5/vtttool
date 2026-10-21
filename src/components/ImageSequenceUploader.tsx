'use client';

import React, { useState, useRef, DragEvent, ChangeEvent } from 'react';
import {
  ImageIcon,
  UploadCloud,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  Trash2,
  Plus,
  CheckCircle2,
  AlertCircle,
  Eye,
  X,
  List,
  LayoutGrid,
  Grid3X3,
} from 'lucide-react';
import { ImageItem, ScriptParagraph } from '../lib/types';

type ViewMode = 'list' | 'grid' | 'compact';

interface ImageSequenceUploaderProps {
  images: ImageItem[];
  paragraphs?: ScriptParagraph[];
  onImagesChange: (images: ImageItem[]) => void;
  onClear: () => void;
}

export const ImageSequenceUploader: React.FC<ImageSequenceUploaderProps> = ({
  images,
  paragraphs = [],
  onImagesChange,
  onClear,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [previewImage, setPreviewImage] = useState<{ item: ImageItem; index: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = (files: FileList | File[]) => {
    const newItems: ImageItem[] = [];
    const validFiles = Array.from(files).filter((file) =>
      file.type.startsWith('image/') || /\.(jpe?g|png|webp|svg|gif)$/i.test(file.name)
    );

    validFiles.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

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

  const moveImage = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= images.length) return;
    const updated = [...images];
    const [moved] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, moved);
    onImagesChange(updated);
  };

  const removeImage = (index: number) => {
    const updated = [...images];
    const removed = updated.splice(index, 1);
    if (removed[0]?.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(removed[0].previewUrl);
    }
    onImagesChange(updated);
  };

  const hasParagraphs = paragraphs.length > 0;
  const isCountMatched = hasParagraphs && images.length === paragraphs.length;

  return (
    <div className="flex flex-col h-full rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
      {/* Card Header */}
      <div className="flex items-center justify-between pb-3 mb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs sm:text-sm font-bold font-mono text-gray-900 flex items-center gap-1.5">
              ImageSequencer.tsx
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                Visual Assets
              </span>
            </h2>
            <p className="text-[11px] text-gray-500 font-sans">1 image per script paragraph</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {images.length > 0 && (
            <>
              {hasParagraphs ? (
                isCountMatched ? (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <CheckCircle2 className="w-3 h-3" />
                    {images.length}/{paragraphs.length} Matched
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                    <AlertCircle className="w-3 h-3" />
                    {images.length} of {paragraphs.length}
                  </span>
                )
              ) : (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-gray-100 text-gray-700 border border-gray-200">
                  {images.length} Images
                </span>
              )}
              <button
                onClick={onClear}
                className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
                title="Clear all images"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Main Container */}
      {images.length === 0 ? (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex-1 flex flex-col items-center justify-center border border-dashed rounded-lg p-6 text-center cursor-pointer transition-all min-h-[220px] ${
            isDragging
              ? 'border-red-500 bg-red-50/50'
              : 'border-gray-300 hover:border-gray-400 bg-gray-50/50 hover:bg-gray-50'
          }`}
        >
          <div className="w-10 h-10 rounded-full bg-white border border-gray-200 shadow-2xs flex items-center justify-center text-red-600 mb-2.5">
            <UploadCloud className="w-5 h-5" />
          </div>
          <p className="text-xs font-semibold text-gray-900">
            Drag &amp; drop slide images here
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">JPG, PNG, WebP supported</p>
          <button
            type="button"
            className="mt-3 px-3 py-1 text-xs font-mono font-medium rounded-md bg-white border border-gray-200 hover:bg-gray-100 text-gray-800 shadow-2xs transition-all"
          >
            Browse Files
          </button>
        </div>
      ) : (
        <div className="flex-1 flex flex-col space-y-2">
          <div className="flex items-center justify-between text-xs font-mono text-gray-600 px-0.5">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-800">Sequence Preview ({images.length} slides)</span>
              {/* 3-way View Mode Switcher */}
              <div className="flex items-center border border-gray-200 rounded-md overflow-hidden bg-gray-50 p-0.5 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-medium cursor-pointer transition-colors ${
                    viewMode === 'list'
                      ? 'bg-white text-red-600 shadow-xs font-bold'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="List View (Clear large thumbnails & script alignment)"
                >
                  <List className="w-3 h-3" />
                  <span>List</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-medium cursor-pointer transition-colors ${
                    viewMode === 'grid'
                      ? 'bg-white text-red-600 shadow-xs font-bold'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="Grid Cards"
                >
                  <LayoutGrid className="w-3 h-3" />
                  <span>Grid</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('compact')}
                  className={`flex items-center gap-1 px-2 py-0.5 text-[11px] rounded font-medium cursor-pointer transition-colors ${
                    viewMode === 'compact'
                      ? 'bg-white text-red-600 shadow-xs font-bold'
                      : 'text-gray-500 hover:text-gray-800'
                  }`}
                  title="Compact Thumbnails"
                >
                  <Grid3X3 className="w-3 h-3" />
                  <span>Compact</span>
                </button>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center gap-1 text-[11px] text-red-600 hover:text-red-700 font-semibold cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>Add Images</span>
            </button>
          </div>

          {/* 1. LIST VIEW: Spacious, crystal-clear thumbnails, paragraph triggers & reordering */}
          {viewMode === 'list' ? (
            <div className="flex flex-col gap-2 overflow-y-auto max-h-[420px] p-1.5 bg-gray-50/70 rounded-xl border border-gray-200 custom-scrollbar">
              {images.map((img, idx) => {
                const linkedPara = paragraphs[idx];
                return (
                  <div
                    key={img.id}
                    className="group relative flex items-center justify-between gap-3 p-2.5 rounded-xl bg-white border border-gray-200 hover:border-gray-400 hover:shadow-sm transition-all"
                  >
                    {/* Left: Large Crisp 16:9 Thumbnail (w-36 sm:w-44) */}
                    <div
                      className="relative aspect-video w-36 sm:w-44 rounded-lg bg-black/95 overflow-hidden shrink-0 cursor-pointer shadow-xs border border-gray-300 group/img"
                      onClick={() => setPreviewImage({ item: img, index: idx })}
                    >
                      <img
                        src={img.previewUrl}
                        alt={img.name}
                        className="w-full h-full object-cover group-hover/img:scale-105 transition-transform duration-200"
                        loading="lazy"
                      />
                      <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/85 text-white font-mono text-[10px] font-bold shadow-xs border border-white/10">
                        Slide #{idx + 1}
                      </div>

                      {/* Click to Enlarge Eye Overlay */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="p-1 rounded-full bg-black/80 text-white shadow-md">
                          <Eye className="w-3.5 h-3.5" />
                        </span>
                      </div>
                    </div>

                    {/* Middle: Detailed Slide Info & Script Paragraph Preview */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-gray-900 truncate" title={img.name}>
                          {img.name}
                        </span>
                        {img.size && (
                          <span className="text-[10px] font-mono text-gray-400 shrink-0">
                            {(img.size / 1024).toFixed(0)} KB
                          </span>
                        )}
                      </div>

                      {/* Script Paragraph Connection */}
                      {linkedPara ? (
                        <div className="p-1.5 rounded-lg bg-indigo-50/80 border border-indigo-100 text-xs">
                          <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold text-indigo-700">
                            <span>Paragraph #{idx + 1}</span>
                            <span className="text-gray-400">&bull;</span>
                            <span className="text-gray-600 font-normal truncate">
                              Trigger: &ldquo;{linkedPara.startingSentence || linkedPara.text.slice(0, 40)}&rdquo;
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-700 truncate mt-0.5">
                            {linkedPara.text}
                          </p>
                        </div>
                      ) : (
                        <p className="text-[11px] text-gray-400 italic">
                          Assigned to Slide #{idx + 1}
                        </p>
                      )}
                    </div>

                    {/* Right: Sequence Reordering & Action Buttons */}
                    <div className="flex flex-col items-center gap-1 shrink-0 pl-1 border-l border-gray-100">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveImage(idx, idx - 1)}
                          className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 disabled:opacity-20 cursor-pointer transition-colors"
                          title="Move Earlier / Up in sequence"
                        >
                          <ArrowUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === images.length - 1}
                          onClick={() => moveImage(idx, idx + 1)}
                          className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 hover:text-gray-900 disabled:opacity-20 cursor-pointer transition-colors"
                          title="Move Later / Down in sequence"
                        >
                          <ArrowDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setPreviewImage({ item: img, index: idx })}
                          className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-100 text-gray-600 hover:text-sky-600 cursor-pointer transition-colors"
                          title="Enlarge preview"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeImage(idx)}
                          className="p-1.5 rounded-lg border border-gray-200 hover:bg-red-50 text-gray-400 hover:text-red-600 cursor-pointer transition-colors"
                          title="Remove image"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* 2. GRID / COMPACT VIEW */
            <div
              className={`grid ${
                viewMode === 'grid' ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-3 sm:grid-cols-4 md:grid-cols-5'
              } gap-2.5 overflow-y-auto max-h-[420px] p-1.5 bg-gray-50/70 rounded-xl border border-gray-200 custom-scrollbar`}
            >
              {images.map((img, idx) => (
                <div
                  key={img.id}
                  className="group relative flex flex-col rounded-lg bg-white border border-gray-200 overflow-hidden shadow-2xs hover:border-gray-400 hover:shadow-sm transition-all"
                >
                  <div
                    className="relative aspect-video w-full bg-black/90 overflow-hidden cursor-pointer"
                    onClick={() => setPreviewImage({ item: img, index: idx })}
                  >
                    <img
                      src={img.previewUrl}
                      alt={img.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                      loading="lazy"
                    />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/80 text-white font-mono text-[10px] font-bold shadow-2xs border border-white/10">
                      #{idx + 1}
                    </div>

                    {/* Eye preview trigger */}
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
                      <span className="p-1.5 rounded-full bg-black/70 text-white shadow-md">
                        <Eye className="w-3.5 h-3.5" />
                      </span>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeImage(idx);
                      }}
                      className="absolute top-1 right-1 p-1 rounded bg-black/80 text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer z-10"
                      title="Remove"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <div className="p-1.5 flex items-center justify-between gap-1 text-[10px] font-mono text-gray-600 bg-white">
                    <span className="truncate flex-1 font-medium" title={img.name}>
                      {img.name}
                    </span>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        disabled={idx === 0}
                        onClick={() => moveImage(idx, idx - 1)}
                        className="p-1 hover:text-gray-900 disabled:opacity-20 cursor-pointer rounded hover:bg-gray-100"
                        title="Move left / earlier"
                      >
                        <ArrowLeft className="w-3 h-3" />
                      </button>
                      <button
                        disabled={idx === images.length - 1}
                        onClick={() => moveImage(idx, idx + 1)}
                        className="p-1 hover:text-gray-900 disabled:opacity-20 cursor-pointer rounded hover:bg-gray-100"
                        title="Move right / later"
                      >
                        <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Lightbox / Full-size Preview Modal */}
      {previewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4 animate-fade-in"
          onClick={() => setPreviewImage(null)}
        >
          <div
            className="relative max-w-3xl max-h-[85vh] bg-white rounded-xl overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 bg-gray-50 text-xs">
              <span className="font-semibold text-gray-800">
                Slide #{previewImage.index + 1}: {previewImage.item.name}
              </span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="p-1 rounded-md text-gray-500 hover:text-gray-800 hover:bg-gray-200 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-2 bg-black flex items-center justify-center max-h-[70vh]">
              <img
                src={previewImage.item.previewUrl}
                alt={previewImage.item.name}
                className="max-h-[65vh] w-auto object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
