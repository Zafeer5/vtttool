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
  HelpCircle,
  Layers,
  Sparkles,
  Search,
  Plus,
  Clock,
  Eye,
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
  voiceoverUrl,
  voiceoverDuration,
  onVoiceoverFileChange,
  rawScript,
  scriptSplitMode,
  paragraphs,
  onScriptChange,
  onSplitModeChange,
  rawVtt,
  cues,
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
      if (!file.type.startsWith('image/')) return;
      newItems.push({
        id: `img_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 6)}`,
        file,
        name: file.name,
        previewUrl: URL.createObjectURL(file),
        size: file.size,
      });
    });

    if (newItems.length > 0) {
      onImagesChange([...images, ...newItems]);
    }
  };

  // Filtered images in pool
  const filteredImages = images.filter((img) =>
    img.name.toLowerCase().includes(imageSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full bg-[#111821] border-r border-[#2B3947] text-[#F1F5F9] select-none min-w-0">
      {/* PANEL TABS */}
      <div className="flex items-center border-b border-[#2B3947] bg-[#0B0F14]/60 p-1.5 gap-1 shrink-0">
        <button
          type="button"
          onClick={() => setActiveTab('sources')}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
            activeTab === 'sources'
              ? 'bg-[#18222D] text-[#2DD4BF] border border-[#2B3947]'
              : 'text-[#A4B1C0] hover:text-[#F1F5F9]'
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
              ? 'bg-[#18222D] text-[#2DD4BF] border border-[#2B3947]'
              : 'text-[#A4B1C0] hover:text-[#F1F5F9]'
          }`}
        >
          <ImageIcon className="w-3.5 h-3.5" />
          <span>Visuals</span>
          {images.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#2B3947] text-[#A4B1C0] font-mono text-[10px]">
              {images.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('review')}
          className={`flex-1 py-1.5 px-2 rounded-md text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer relative ${
            activeTab === 'review'
              ? 'bg-[#18222D] text-[#2DD4BF] border border-[#2B3947]'
              : 'text-[#A4B1C0] hover:text-[#F1F5F9]'
          }`}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          <span>Review</span>
          {reviewItems.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-amber-500/20 text-amber-300 font-mono text-[10px] font-bold">
              {reviewItems.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB CONTENT BODY */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0">
        {/* ==================== TAB 1: SOURCES ==================== */}
        {activeTab === 'sources' && (
          <div className="space-y-4">
            {/* 1. Voiceover Audio Uploader */}
            <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Music className="w-4 h-4 text-[#2DD4BF]" />
                  <span className="text-xs font-bold text-[#F1F5F9]">Voiceover Audio</span>
                </div>
                {voiceoverDuration > 0 && (
                  <span className="px-2 py-0.5 rounded bg-[#202C38] text-[#2DD4BF] font-mono text-[10px] font-bold">
                    {formatSecondsToTimestamp(voiceoverDuration)}
                  </span>
                )}
              </div>

              {voiceoverFile ? (
                <div className="p-2.5 rounded-lg bg-[#202C38] border border-[#2B3947] flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[#F1F5F9] truncate">{voiceoverFile.name}</p>
                    <p className="text-[10px] text-[#A4B1C0] font-mono">
                      {(voiceoverFile.size / (1024 * 1024)).toFixed(2)} MB • {formatSecondsToTimestamp(voiceoverDuration)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onVoiceoverFileChange(null)}
                    className="p-1 rounded text-[#748396] hover:text-rose-400 hover:bg-[#18222D] transition"
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
                      ? 'border-[#2DD4BF] bg-[#2DD4BF]/10'
                      : 'border-[#2B3947] hover:border-[#748396] bg-[#0B0F14]/40'
                  }`}
                >
                  <UploadCloud className="w-5 h-5 mx-auto text-[#748396] mb-1" />
                  <p className="text-[11px] text-[#A4B1C0]">
                    Drop MP3 / WAV audio here or <span className="text-[#2DD4BF] font-semibold">browse</span>
                  </p>
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

            {/* 2. Script Editor */}
            <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-[#2DD4BF]" />
                  <span className="text-xs font-bold text-[#F1F5F9]">Script Text</span>
                </div>
                <div className="flex items-center gap-1">
                  {(['paragraph', 'sentence', 'line'] as ScriptSplitMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onSplitModeChange(mode)}
                      className={`px-1.5 py-0.5 rounded text-[10px] font-mono transition cursor-pointer capitalize ${
                        scriptSplitMode === mode
                          ? 'bg-[#2DD4BF]/20 text-[#2DD4BF] border border-[#2DD4BF]/40 font-bold'
                          : 'text-[#748396] hover:text-[#A4B1C0]'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>

              <textarea
                value={rawScript}
                onChange={(e) => onScriptChange(e.target.value)}
                placeholder="Paste narration script here... Each segment splits into a visual slide."
                rows={6}
                className="w-full rounded-lg bg-[#0B0F14] border border-[#2B3947] p-2 text-xs text-[#F1F5F9] placeholder-[#748396] focus:border-[#2DD4BF] outline-none font-sans leading-relaxed resize-none"
              />

              <div className="flex items-center justify-between text-[10px] text-[#748396] font-mono">
                <span>{paragraphs.length} slides generated</span>
                <span>{rawScript.split(/\s+/).filter(Boolean).length} words</span>
              </div>
            </div>

            {/* 3. Subtitles / VTT Cues */}
            <div className="rounded-xl bg-[#18222D] border border-[#2B3947] p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Subtitles className="w-4 h-4 text-[#2DD4BF]" />
                  <span className="text-xs font-bold text-[#F1F5F9]">WebVTT Subtitles</span>
                </div>
                {cues.length > 0 && (
                  <span className="px-2 py-0.5 rounded bg-[#202C38] text-[#2DD4BF] font-mono text-[10px] font-bold">
                    {cues.length} cues
                  </span>
                )}
              </div>

              <textarea
                value={rawVtt}
                onChange={(e) => onVttChange(e.target.value)}
                placeholder="WEBVTT&#10;&#10;00:00:00.000 --> 00:00:05.000&#10;First subtitle caption..."
                rows={5}
                className="w-full rounded-lg bg-[#0B0F14] border border-[#2B3947] p-2 text-[11px] text-[#F1F5F9] placeholder-[#748396] focus:border-[#2DD4BF] outline-none font-mono resize-none leading-relaxed"
              />

              <div className="flex items-center justify-between text-[10px] text-[#748396]">
                <span>{cues.length > 0 ? '✓ Timestamps loaded' : 'Subtitle cues required for VTT sync'}</span>
              </div>
            </div>
          </div>
        )}

        {/* ==================== TAB 2: VISUAL ASSETS ==================== */}
        {activeTab === 'assets' && (
          <div className="space-y-3">
            {/* Asset Pool Actions */}
            <div className="flex items-center justify-between gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[#748396] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Filter images..."
                  value={imageSearch}
                  onChange={(e) => setImageSearch(e.target.value)}
                  className="w-full pl-8 pr-2 py-1.5 rounded-lg bg-[#18222D] border border-[#2B3947] text-xs text-[#F1F5F9] placeholder-[#748396] outline-none focus:border-[#2DD4BF]"
                />
              </div>
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="px-2.5 py-1.5 rounded-lg bg-[#2DD4BF]/15 text-[#2DD4BF] hover:bg-[#2DD4BF]/25 border border-[#2DD4BF]/30 text-xs font-semibold flex items-center gap-1 transition cursor-pointer shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add</span>
              </button>
            </div>

            {/* Unused Images Alert */}
            {unusedImagesCount > 0 && (
              <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-between text-xs text-amber-300">
                <span className="text-[11px]">{unusedImagesCount} unused image(s) in pool</span>
                <span className="text-[10px] font-mono font-semibold">Available for assignment</span>
              </div>
            )}

            {/* Upload Dropzone */}
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
              className={`border border-dashed rounded-lg p-3 text-center transition cursor-pointer ${
                isDraggingImages
                  ? 'border-[#2DD4BF] bg-[#2DD4BF]/10'
                  : 'border-[#2B3947] hover:border-[#748396] bg-[#18222D]'
              }`}
            >
              <UploadCloud className="w-5 h-5 mx-auto text-[#748396] mb-1" />
              <p className="text-[11px] text-[#A4B1C0]">
                Drop images here or <span className="text-[#2DD4BF] font-semibold">browse</span>
              </p>
              <input
                ref={imageInputRef}
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleImageFiles(e.target.files);
                }}
              />
            </div>

            {/* Image Grid */}
            {filteredImages.length === 0 ? (
              <div className="py-8 text-center text-[#748396] text-xs">
                No visual assets found in project
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filteredImages.map((img, i) => {
                  const isAssigned = assignedImageIds.has(img.id);
                  return (
                    <div
                      key={img.id}
                      className="group relative rounded-lg overflow-hidden border border-[#2B3947] bg-[#18222D] aspect-video flex flex-col justify-end transition hover:border-[#2DD4BF]"
                    >
                      <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-90" />
                      <div className="absolute bottom-1 left-1.5 right-1.5 flex items-center justify-between">
                        <span className="text-[10px] text-[#F1F5F9] font-mono truncate max-w-[80%]">
                          {img.name}
                        </span>
                        {isAssigned ? (
                          <span className="w-2 h-2 rounded-full bg-[#2DD4BF]" title="Assigned to slide" />
                        ) : (
                          <span className="w-2 h-2 rounded-full bg-amber-400" title="Unused in pool" />
                        )}
                      </div>

                      {/* Click to Assign Overlay */}
                      {selectedSlideIndex !== null && onAssignImageToSlide && (
                        <button
                          type="button"
                          onClick={() => onAssignImageToSlide(img, selectedSlideIndex)}
                          className="absolute inset-0 bg-[#2DD4BF]/85 text-[#0B0F14] font-bold text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition cursor-pointer"
                        >
                          Assign to Slide {selectedSlideIndex + 1}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ==================== TAB 3: REVIEW QUEUE ==================== */}
        {activeTab === 'review' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-[#F1F5F9]">
                Synchronization Diagnostics ({reviewItems.length})
              </span>
              {onConfirmAllTiming && (
                <button
                  type="button"
                  onClick={onConfirmAllTiming}
                  className="px-2 py-1 rounded bg-[#2DD4BF]/15 text-[#2DD4BF] text-[10px] font-bold transition hover:bg-[#2DD4BF]/25"
                >
                  Confirm All
                </button>
              )}
            </div>

            {reviewItems.length === 0 ? (
              <div className="py-8 text-center rounded-xl bg-[#18222D] border border-[#2B3947] p-4 space-y-1.5">
                <CheckCircle2 className="w-8 h-8 text-[#2DD4BF] mx-auto" />
                <h4 className="text-xs font-bold text-[#F1F5F9]">Synchronization Ready</h4>
                <p className="text-[11px] text-[#748396]">
                  All slides have assigned visuals, valid speech timestamps, and positive durations.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {reviewItems.map((item) => {
                  const isError = item.severity === 'error';
                  return (
                    <div
                      key={item.id}
                      onClick={() => onSelectSlide(item.slideIndex)}
                      className={`p-2.5 rounded-lg border transition cursor-pointer flex flex-col gap-1 ${
                        isError
                          ? 'bg-rose-500/10 border-rose-500/30 hover:border-rose-400'
                          : 'bg-amber-500/10 border-amber-500/30 hover:border-amber-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-amber-400">
                          Slide {item.slideIndex + 1}
                        </span>
                        <span className="text-[10px] font-mono text-[#A4B1C0]">{item.timeRange}</span>
                      </div>
                      <p className="text-xs font-semibold text-[#F1F5F9]">{item.title}</p>
                      <p className="text-[10px] text-[#A4B1C0] leading-normal">{item.description}</p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
