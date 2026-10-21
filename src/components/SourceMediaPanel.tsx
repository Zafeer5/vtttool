'use client';

import React, { useState, useRef } from 'react';
import {
  FileText,
  Music,
  Subtitles,
  ImageIcon,
  UploadCloud,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  AlertCircle,
  Layers,
  Search,
  Plus,
  Clock,
  Check,
} from 'lucide-react';
import {
  ImageItem,
  VttCue,
  ScriptParagraph,
  ReviewQueueItem,
  SyncMatch,
} from '@/lib/types';
import { ScriptSplitMode } from '@/lib/script-parser';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';

interface SourceMediaPanelProps {
  // Tab 1: Sources
  voiceoverFile: File | null;
  voiceoverUrl: string | null;
  voiceoverDuration: number;
  onVoiceoverFileChange: (file: File | null) => void;
  rawScript: string;
  scriptSplitMode: ScriptSplitMode;
  paragraphs: ScriptParagraph[];
  onScriptChange: (val: string) => void;
  onSplitModeChange: (mode: ScriptSplitMode) => void;
  rawVtt: string;
  cues: VttCue[];
  onVttChange: (val: string) => void;

  // Tab 2: Visual Assets
  images: ImageItem[];
  onImagesChange: (images: ImageItem[]) => void;
  selectedSlideIndex: number | null;
  onAssignImageToSlide?: (image: ImageItem, slideIndex: number) => void;

  // Tab 3: Review Queue
  reviewItems: ReviewQueueItem[];
  matches: SyncMatch[];
  onSelectSlide: (index: number) => void;
  onConfirmAllTiming?: () => void;
}

export const SourceMediaPanel: React.FC<SourceMediaPanelProps> = ({
  voiceoverFile,
  voiceoverUrl: _voiceoverUrl,
  voiceoverDuration,
  onVoiceoverFileChange,
  rawScript,
  scriptSplitMode,
  paragraphs: _paragraphs,
  onScriptChange,
  onSplitModeChange,
  rawVtt,
  cues: _cues,
  onVttChange,
  images,
  onImagesChange,
  selectedSlideIndex,
  onAssignImageToSlide,
  reviewItems,
  matches,
  onSelectSlide,
  onConfirmAllTiming,
}) => {
  const [activeTab, setActiveTab] = useState<'sources' | 'assets' | 'review'>('sources');
  const [imageSearch, setImageSearch] = useState('');
  const [isDraggingImages, setIsDraggingImages] = useState(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState(false);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Compute unused images in pool
  const assignedImageIds = new Set(
    matches.map((m) => m.image?.id).filter(Boolean) as string[]
  );
  const unusedImagesCount = images.filter((img) => !assignedImageIds.has(img.id)).length;

  // Handle Image Files Drop/Select
  const handleImageFiles = (files: FileList | File[]) => {
    const newItems: ImageItem[] = [];
    const arr = Array.from(files).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    arr.forEach((file, idx) => {
      if (file.type.startsWith('image/')) {
        const previewUrl = URL.createObjectURL(file);
        newItems.push({
          id: `img_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
          file,
          previewUrl,
          name: file.name,
          size: file.size,
          width: 1920,
          height: 1080,
        });
      }
    });

    if (newItems.length > 0) {
      onImagesChange([...images, ...newItems]);
    }
  };

  return (
    <div className="flex flex-col h-full bg-white text-slate-900 select-none min-w-0">
      {/* TAB SELECTOR HEADER */}
      <div className="h-10 px-3 border-b border-slate-200 bg-slate-50/80 flex items-center justify-between gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('sources')}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'sources'
              ? 'bg-white text-orange-700 border border-slate-200 shadow-2xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Sources</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('assets')}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'assets'
              ? 'bg-white text-orange-700 border border-slate-200 shadow-2xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Visuals</span>
          {images.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-mono text-[10px]">
              {images.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer relative ${
            activeTab === 'review'
              ? 'bg-white text-orange-700 border border-slate-200 shadow-2xs font-bold'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Review</span>
          {reviewItems.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-100 text-amber-800 font-mono text-[10px] font-bold">
              {reviewItems.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB CONTENT BODY */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5 min-h-0 bg-white">
        {/* ==================== TAB 1: SOURCES ==================== */}
        {activeTab === 'sources' && (
          <div className="space-y-3.5">
            {/* 1. Voiceover Audio Uploader */}
            <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-bold text-slate-900">Voiceover Audio</span>
                </div>
                {voiceoverDuration > 0 && (
                  <span className="px-2 py-0.5 rounded bg-orange-50 border border-orange-200 text-orange-700 font-mono text-[10px] font-bold">
                    {formatSecondsToTimestamp(voiceoverDuration)}
                  </span>
                )}
              </div>

              {voiceoverFile ? (
                <div className="p-2.5 rounded-lg bg-white border border-slate-200 flex items-center justify-between gap-2 shadow-2xs">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-800 truncate">{voiceoverFile.name}</p>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {(voiceoverFile.size / (1024 * 1024)).toFixed(2)} MB • {formatSecondsToTimestamp(voiceoverDuration)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onVoiceoverFileChange(null)}
                    className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-slate-100 transition"
                    title="Remove audio file"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDraggingAudio(true);
                  }}
                  onDragLeave={() => setIsDraggingAudio(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDraggingAudio(false);
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      onVoiceoverFileChange(e.dataTransfer.files[0]);
                    }
                  }}
                  onClick={() => audioInputRef.current?.click()}
                  className={`border border-dashed rounded-lg p-3 text-center transition cursor-pointer ${
                    isDraggingAudio
                      ? 'border-orange-500 bg-orange-50'
                      : 'border-slate-300 hover:border-orange-400 bg-white hover:bg-orange-50/20'
                  }`}
                >
                  <UploadCloud className="w-5 h-5 mx-auto text-orange-600 mb-1" />
                  <p className="text-xs font-medium text-slate-700">Drop Voiceover Audio</p>
                  <p className="text-[10px] text-slate-400 font-mono">MP3, WAV, AAC, M4A</p>
                  <input
                    ref={audioInputRef}
                    type="file"
                    accept="audio/*"
                    className="hidden"
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        onVoiceoverFileChange(e.target.files[0]);
                      }
                    }}
                  />
                </div>
              )}
            </div>

            {/* 2. Script Paragraphs */}
            <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <FileText className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-bold text-slate-900">Script Content</span>
                </div>
                <div className="flex items-center gap-1 bg-white border border-slate-200 rounded p-0.5 text-[10px]">
                  <button
                    type="button"
                    onClick={() => onSplitModeChange('paragraph')}
                    className={`px-1.5 py-0.5 rounded transition ${
                      scriptSplitMode === 'paragraph'
                        ? 'bg-orange-600 text-white font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Paragraphs
                  </button>
                  <button
                    type="button"
                    onClick={() => onSplitModeChange('sentence')}
                    className={`px-1.5 py-0.5 rounded transition ${
                      scriptSplitMode === 'sentence'
                        ? 'bg-orange-600 text-white font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Sentences
                  </button>
                </div>
              </div>
              <textarea
                value={rawScript}
                onChange={(e) => onScriptChange(e.target.value)}
                placeholder="Paste your voiceover script or video presentation paragraphs here..."
                rows={5}
                className="w-full rounded-lg bg-white border border-slate-200 p-2.5 text-xs text-slate-800 leading-relaxed outline-none focus:border-orange-500 font-sans shadow-2xs resize-none"
              />
            </div>

            {/* 3. Subtitles (VTT) */}
            <div className="rounded-xl bg-slate-50/70 border border-slate-200 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Subtitles className="w-4 h-4 text-orange-600" />
                  <span className="text-xs font-bold text-slate-900">VTT Subtitles</span>
                </div>
              </div>
              <textarea
                value={rawVtt}
                onChange={(e) => onVttChange(e.target.value)}
                placeholder="WEBVTT&#10;&#10;00:00:01.000 --> 00:00:04.500&#10;Your speech subtitles here..."
                rows={5}
                className="w-full rounded-lg bg-white border border-slate-200 p-2.5 text-xs text-slate-800 font-mono leading-relaxed outline-none focus:border-orange-500 shadow-2xs resize-none"
              />
            </div>
          </div>
        )}

        {/* ==================== TAB 2: VISUAL ASSETS ==================== */}
        {activeTab === 'assets' && (
          <div className="space-y-3">
            {/* Image Dropzone & Pool Stats */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImages(true);
              }}
              onDragLeave={() => setIsDraggingImages(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingImages(false);
                if (e.dataTransfer.files) handleImageFiles(e.dataTransfer.files);
              }}
              onClick={() => imageInputRef.current?.click()}
              className={`border border-dashed rounded-xl p-3 text-center transition cursor-pointer ${
                isDraggingImages
                  ? 'border-orange-500 bg-orange-50'
                  : 'border-slate-300 hover:border-orange-400 bg-slate-50/60 hover:bg-orange-50/20'
              }`}
            >
              <UploadCloud className="w-6 h-6 mx-auto text-orange-600 mb-1" />
              <p className="text-xs font-bold text-slate-800">Drop Slide Images Here</p>
              <p className="text-[10px] text-slate-500 font-mono">PNG, JPG, WEBP • Click to browse</p>
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleImageFiles(e.target.files);
                }}
              />
            </div>

            {/* Search Images Filter */}
            {images.length > 0 && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter images by name..."
                  value={imageSearch}
                  onChange={(e) => setImageSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 outline-none focus:border-orange-500 shadow-2xs"
                />
              </div>
            )}

            {/* Unused Count Info */}
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 font-medium">
              <span>{images.length} Total Visuals</span>
              {unusedImagesCount > 0 && (
                <span className="text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.2 rounded font-mono">
                  {unusedImagesCount} unassigned
                </span>
              )}
            </div>

            {/* Grid of Images */}
            <div className="grid grid-cols-2 gap-2 max-h-[460px] overflow-y-auto pr-1">
              {images
                .filter((img) =>
                  imageSearch ? img.name.toLowerCase().includes(imageSearch.toLowerCase()) : true
                )
                .map((img) => {
                  const isAssignedToSelected =
                    selectedSlideIndex !== null &&
                    matches[selectedSlideIndex]?.image?.id === img.id;
                  const isAssignedAnywhere = assignedImageIds.has(img.id);

                  return (
                    <div
                      key={img.id}
                      onClick={() => {
                        if (selectedSlideIndex !== null && onAssignImageToSlide) {
                          onAssignImageToSlide(img, selectedSlideIndex);
                        }
                      }}
                      className={`group relative aspect-video rounded-lg overflow-hidden border transition cursor-pointer shadow-2xs ${
                        isAssignedToSelected
                          ? 'border-orange-500 ring-2 ring-orange-500/40'
                          : isAssignedAnywhere
                          ? 'border-slate-200 hover:border-slate-400 opacity-90'
                          : 'border-slate-300 hover:border-orange-500'
                      }`}
                      title={
                        selectedSlideIndex !== null
                          ? `Click to assign to Slide ${selectedSlideIndex + 1}`
                          : img.name
                      }
                    >
                      <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1.5">
                        <p className="text-[9px] font-mono text-white truncate">{img.name}</p>
                      </div>

                      {/* Status Badges */}
                      {isAssignedToSelected && (
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-orange-600 text-white font-mono text-[9px] font-bold flex items-center gap-0.5 shadow-sm">
                          <Check className="w-2.5 h-2.5" /> Slide {selectedSlideIndex! + 1}
                        </div>
                      )}

                      {/* Delete Action */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onImagesChange(images.filter((i) => i.id !== img.id));
                        }}
                        className="opacity-0 group-hover:opacity-100 absolute top-1 right-1 p-1 rounded bg-black/70 hover:bg-rose-600 text-white transition"
                        title="Delete image from pool"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

        {/* ==================== TAB 3: REVIEW QUEUE ==================== */}
        {activeTab === 'review' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-800">
                Action Items ({reviewItems.length})
              </span>
              {onConfirmAllTiming && (
                <button
                  type="button"
                  onClick={onConfirmAllTiming}
                  className="px-2 py-1 rounded bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 text-[10px] font-bold transition cursor-pointer"
                >
                  Confirm All
                </button>
              )}
            </div>

            {reviewItems.length === 0 ? (
              <div className="p-6 text-center text-slate-400 space-y-2 border border-slate-200 rounded-xl bg-slate-50/50">
                <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-500" />
                <p className="text-xs font-bold text-slate-800">Timeline Fully Synchronized</p>
                <p className="text-[11px] text-slate-500">All slides have high confidence matches and assigned visuals.</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[460px] overflow-y-auto pr-1">
                {reviewItems.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => onSelectSlide(item.slideIndex)}
                    className="p-2.5 rounded-lg border border-slate-200 bg-slate-50/80 hover:bg-white hover:border-orange-400 transition cursor-pointer space-y-1.5 shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 font-mono">
                        Slide {item.slideIndex + 1}
                      </span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold capitalize ${
                          item.severity === 'error'
                            ? 'bg-rose-50 text-rose-700 border border-rose-200'
                            : 'bg-amber-50 text-amber-700 border border-amber-200'
                        }`}
                      >
                        {item.type.replace('_', ' ')}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-700 leading-snug font-medium">
                      {item.description || item.title}
                    </p>

                    <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-200">
                      <span>{item.timeRange || item.title}</span>
                      <span className="text-orange-600 font-bold hover:underline">Inspect →</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
