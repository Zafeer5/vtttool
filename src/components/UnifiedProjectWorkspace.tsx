'use client';

import React, { useState, useRef } from 'react';
import {
  Film,
  UploadCloud,
  FileText,
  ImageIcon,
  Layers,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Archive,
  Sliders,
  ChevronDown,
  ChevronUp,
  Music,
  Settings2,
} from 'lucide-react';
import {
  ProjectItem,
  VttCue,
  ScriptParagraph,
  ImageItem,
  SyncMatch,
  MotionSettings,
  LogoSettings,
  ExportMode,
} from '@/lib/types';
import { VideoResolution } from '@/lib/image-helper';
import { formatSecondsToTimestamp } from '@/lib/vtt-parser';
import { ScriptSplitMode } from '@/lib/script-parser';
import { TimelineEditor } from './TimelineEditor';

interface UnifiedProjectWorkspaceProps {
  project: ProjectItem;
  cues: VttCue[];
  paragraphs: ScriptParagraph[];
  images: ImageItem[];
  rawScript: string;
  rawVtt: string;
  scriptSplitMode: ScriptSplitMode;
  voiceoverFile: File | null;
  voiceoverUrl: string | null;
  voiceoverDuration: number;
  activeMatches: SyncMatch[];
  activeTotalDuration: number;
  selectedResolution: VideoResolution;
  exportMode: ExportMode;
  outputFileName: string;
  selectedFolder: string;
  autoDownloadEnabled: boolean;
  motionSettings: MotionSettings;
  logoSettings: LogoSettings;
  isRendering: boolean;
  queueCount: number;
  onScriptChange: (val: string) => void;
  onSplitModeChange: (mode: ScriptSplitMode) => void;
  onVttChange: (val: string) => void;
  onVoiceoverFileChange: (file: File | null) => void;
  onImagesChange: (images: ImageItem[]) => void;
  onResolutionChange: (res: VideoResolution) => void;
  onExportModeChange: (mode: ExportMode) => void;
  onOutputFileNameChange: (name: string) => void;
  onBrowseFolder: () => void;
  onMotionSettingsChange: (settings: MotionSettings) => void;
  onLogoSettingsChange: (settings: LogoSettings) => void;
  onCompileAndQueue: () => void;
  onUpdateSlideDuration?: (index: number, newDuration: number) => void;
}

export const UnifiedProjectWorkspace: React.FC<UnifiedProjectWorkspaceProps> = ({
  project: _project,
  cues,
  paragraphs,
  images,
  rawScript,
  rawVtt,
  scriptSplitMode,
  voiceoverFile,
  voiceoverUrl,
  voiceoverDuration,
  activeMatches,
  activeTotalDuration,
  selectedResolution,
  exportMode,
  outputFileName,
  selectedFolder: _selectedFolder,
  autoDownloadEnabled: _autoDownloadEnabled,
  motionSettings,
  logoSettings: _logoSettings,
  isRendering: _isRendering,
  queueCount: _queueCount,
  onScriptChange,
  onSplitModeChange,
  onVttChange,
  onVoiceoverFileChange,
  onImagesChange,
  onResolutionChange,
  onExportModeChange,
  onOutputFileNameChange,
  onBrowseFolder: _onBrowseFolder,
  onMotionSettingsChange,
  onLogoSettingsChange: _onLogoSettingsChange,
  onCompileAndQueue,
  onUpdateSlideDuration,
}) => {
  const [showTimelineEditor, setShowTimelineEditor] = useState<boolean>(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState<boolean>(false);
  const [isDraggingImages, setIsDraggingImages] = useState<boolean>(false);
  const [isDraggingAudio, setIsDraggingAudio] = useState<boolean>(false);
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const hasMatches = activeMatches.length > 0;
  const isReady = hasMatches && activeMatches.every((m) => !!m.image);
  const missingImagesCount = paragraphs.length > images.length ? paragraphs.length - images.length : 0;

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

  // Handle Audio/SRT Drop/Select
  const handleAudioOrSrtFile = async (file: File) => {
    if (file.name.endsWith('.srt') || file.name.endsWith('.vtt')) {
      const text = await file.text();
      onVttChange(text);
    } else if (file.type.startsWith('audio/') || file.name.match(/\.(mp3|wav|m4a|aac|ogg|flac)$/i)) {
      onVoiceoverFileChange(file);
    }
  };

  const handleRemoveImage = (index: number) => {
    const updated = images.filter((_, i) => i !== index);
    onImagesChange(updated);
  };

  const handleClearImages = () => {
    if (confirm('Clear all attached images for this project?')) {
      onImagesChange([]);
    }
  };

  const formatSec = (seconds: number) => {
    if (isNaN(seconds) || seconds <= 0) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-full space-y-4">
      {/* ROW 1: 3-COLUMN INPUT WORKBENCH (SRT, SCRIPT, IMAGES) */}
      <div className="grid grid-cols-12 gap-4">
        {/* CARD 1: SUBTITLES / SRT / AUDIO (col-span-4) */}
        <div className="col-span-12 lg:col-span-4 p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                <Music className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200">1. Subtitles / SRT / Audio</h3>
                <p className="text-[10px] text-slate-400">Paste SRT/VTT or attach voiceover</p>
              </div>
            </div>
            {cues.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] font-mono font-semibold">
                {cues.length} cues • {formatSec(voiceoverDuration || (cues[cues.length - 1]?.endTime || 0))}
              </span>
            )}
          </div>

          {/* Paste SRT Textarea */}
          <div className="flex-1 flex flex-col space-y-2">
            <textarea
              value={rawVtt}
              onChange={(e) => onVttChange(e.target.value)}
              placeholder="Paste SRT or WebVTT content here...&#10;&#10;1&#10;00:00:00,000 --> 00:00:05,000&#10;First voiceover scene text...&#10;&#10;2&#10;00:00:05,000 --> 00:00:10,000&#10;Second voiceover scene text..."
              className="w-full h-44 p-3 rounded-lg border border-slate-800 bg-slate-950/60 font-mono text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 resize-none transition"
            />

            {/* Audio Dropzone / Picker Button */}
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
                  handleAudioOrSrtFile(e.dataTransfer.files[0]);
                }
              }}
              onClick={() => audioInputRef.current?.click()}
              className={`h-9 px-3 rounded-lg border border-dashed transition flex items-center justify-between gap-2 cursor-pointer ${
                isDraggingAudio
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : voiceoverFile
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                  : 'border-slate-700 hover:border-indigo-500/60 bg-slate-950/40 text-slate-400 hover:text-slate-200'
              }`}
            >
              <input
                ref={audioInputRef}
                type="file"
                accept=".srt,.vtt,audio/*,.mp3,.wav,.m4a"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleAudioOrSrtFile(e.target.files[0]);
                  }
                }}
              />
              <div className="flex items-center gap-2 min-w-0">
                <UploadCloud className={`w-3.5 h-3.5 shrink-0 ${voiceoverFile ? 'text-emerald-400' : 'text-slate-400'}`} />
                <span className="text-xs truncate">
                  {voiceoverFile ? voiceoverFile.name : 'Upload voiceover (.mp3 / .wav) or .srt'}
                </span>
              </div>
              {voiceoverFile && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onVoiceoverFileChange(null);
                  }}
                  className="p-1 rounded text-slate-400 hover:text-rose-400 transition"
                  title="Remove voiceover file"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* CARD 2: SCRIPT LINES (col-span-4) */}
        <div className="col-span-12 lg:col-span-4 p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200">2. Script Lines / Scenes</h3>
                <p className="text-[10px] text-slate-400">1 line/paragraph = 1 slide</p>
              </div>
            </div>
            {paragraphs.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] font-mono font-semibold">
                {paragraphs.length} slides
              </span>
            )}
          </div>

          {/* Paste Script Textarea */}
          <div className="flex-1 flex flex-col space-y-2">
            <textarea
              value={rawScript}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder="Paste your script text here...&#10;&#10;Line 1: In the beginning of our story, everything was quiet.&#10;&#10;Line 2: Suddenly, a mysterious light appeared on the horizon.&#10;&#10;Line 3: We embarked on an unforgettable journey."
              className="w-full h-44 p-3 rounded-lg border border-slate-800 bg-slate-950/60 font-mono text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500/80 resize-none transition"
            />

            {/* Split Mode Selector Bar */}
            <div className="h-9 px-3 rounded-lg bg-slate-950/40 border border-slate-800 flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium text-[11px]">Slide Split Mode:</span>
              <div className="flex items-center gap-1">
                {(['paragraph', 'line', 'sentence'] as ScriptSplitMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => onSplitModeChange(mode)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold capitalize transition cursor-pointer ${
                      scriptSplitMode === mode
                        ? 'bg-indigo-600 text-white shadow-xs'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* CARD 3: SLIDE IMAGES (col-span-4) */}
        <div className="col-span-12 lg:col-span-4 p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
                <ImageIcon className="w-3.5 h-3.5" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-slate-200">3. Slide Images</h3>
                <p className="text-[10px] text-slate-400">Attach 1 image per slide</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {images.length > 0 && (
                <>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold border ${
                      images.length === paragraphs.length && paragraphs.length > 0
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                        : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                    }`}
                  >
                    {images.length} / {paragraphs.length || 0} images
                  </span>
                  <button
                    type="button"
                    onClick={handleClearImages}
                    title="Clear images"
                    className="p-1 rounded text-slate-400 hover:text-rose-400 transition"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Image Dropzone */}
          <div className="flex-1 flex flex-col justify-between space-y-2">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingImages(true);
              }}
              onDragLeave={() => setIsDraggingImages(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingImages(false);
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                  handleImageFiles(e.dataTransfer.files);
                }
              }}
              onClick={() => imageInputRef.current?.click()}
              className={`h-[176px] rounded-lg border-2 border-dashed transition flex flex-col items-center justify-center text-center cursor-pointer p-4 ${
                isDraggingImages
                  ? 'border-indigo-500 bg-indigo-500/10'
                  : 'border-slate-800 hover:border-indigo-500/60 bg-slate-950/40 text-slate-400'
              }`}
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    handleImageFiles(e.target.files);
                  }
                }}
              />
              <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center mb-1.5">
                <UploadCloud className="w-4 h-4" />
              </div>
              <p className="text-xs font-semibold text-slate-200">Drop images here, or click to browse</p>
              <p className="text-[10px] text-slate-500 mt-0.5">Supports PNG, JPG, WebP (multi-select)</p>
            </div>

            {/* Thumbnail Preview Strip */}
            {images.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto py-1">
                {images.map((img, i) => (
                  <div
                    key={img.id}
                    className="relative group shrink-0 w-10 h-10 rounded-lg border border-slate-800 overflow-hidden"
                    title={`Slide ${i + 1}: ${img.name}`}
                  >
                    <img src={img.previewUrl} alt={img.name} className="w-full h-full object-cover" />
                    <span className="absolute bottom-0 right-0 px-1 rounded-tl bg-black/80 text-white text-[8px] font-mono font-bold">
                      {i + 1}
                    </span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveImage(i);
                      }}
                      className="absolute top-0 right-0 p-0.5 rounded-bl bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ROW 2: SYNCHRONIZED SLIDE TIMELINE */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
              <Film className="w-3.5 h-3.5" />
            </div>
            <div>
              <h2 className="text-xs font-bold text-slate-200 flex items-center gap-2">
                <span>Synchronized Slide Timeline</span>
                {activeMatches.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 text-[10px] font-mono font-semibold">
                    {activeMatches.length} slides • {formatSec(activeTotalDuration)}
                  </span>
                )}
              </h2>
              <p className="text-[10px] text-slate-400">
                Each slide synchronizes image + voiceover timing + script sentence
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowTimelineEditor(!showTimelineEditor)}
              className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
            >
              <Sliders className="w-3 h-3 text-indigo-400" />
              <span>{showTimelineEditor ? 'Hide Multi-Track Timeline' : 'Open Multi-Track Timeline'}</span>
              {showTimelineEditor ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
        </div>

        {/* Collapsible Multi-Track Timeline Editor */}
        {showTimelineEditor && (
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800">
            <TimelineEditor
              matches={activeMatches}
              cues={cues}
              totalDuration={voiceoverDuration || activeTotalDuration}
              voiceoverUrl={voiceoverUrl}
              onUpdateMatches={(_updatedMatches: SyncMatch[]) => {}}
              paragraphs={paragraphs}
              images={images}
              motionSettings={motionSettings}
              onUpdateMotionSettings={onMotionSettingsChange}
            />
          </div>
        )}

        {/* Empty State vs Slide Cards */}
        {activeMatches.length === 0 ? (
          <div className="h-36 rounded-lg border border-dashed border-slate-800 bg-slate-950/40 flex flex-col items-center justify-center text-center p-4">
            <Film className="w-8 h-8 text-slate-600 mb-1.5" />
            <h4 className="text-xs font-semibold text-slate-400">No slides generated yet</h4>
            <p className="text-[11px] text-slate-500 mt-0.5 max-w-md">
              Paste your SRT cues and script lines above, and your synchronized visual slides will appear right here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {activeMatches.map((m, idx) => {
              const hasImage = !!m.image;
              const timingLabel = `${formatSecondsToTimestamp(m.startTime, false)} - ${formatSecondsToTimestamp(m.endTime, false)}`;
              const durationFormatted = `${m.duration.toFixed(1)}s`;

              return (
                <div
                  key={idx}
                  className={`rounded-xl border p-3 flex flex-col justify-between transition ${
                    hasImage
                      ? 'bg-slate-950/60 border-slate-800 hover:border-slate-700'
                      : 'bg-amber-500/5 border-amber-500/30'
                  }`}
                >
                  <div className="space-y-2">
                    {/* Top Row: Slide Index & Duration */}
                    <div className="flex items-center justify-between">
                      <span className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-300 font-mono text-[10px] font-bold">
                        Slide {idx + 1}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-slate-300 font-mono text-[10px] font-semibold">
                        {timingLabel} ({durationFormatted})
                      </span>
                    </div>

                    {/* Image Thumbnail */}
                    <div className="relative aspect-video rounded-lg overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center">
                      {hasImage ? (
                        <>
                          <img
                            src={m.image!.previewUrl}
                            alt={m.image!.name}
                            className="w-full h-full object-cover cursor-pointer hover:scale-105 transition"
                            onClick={() => setSelectedPreviewImage(m.image!.previewUrl)}
                          />
                          <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/80 text-slate-200 font-mono text-[9px] truncate max-w-[80%]">
                            {m.image!.name}
                          </span>
                        </>
                      ) : (
                        <div className="text-center p-2 text-amber-400">
                          <ImageIcon className="w-5 h-5 mx-auto mb-1 opacity-60" />
                          <span className="text-[10px] font-semibold">Missing Image</span>
                        </div>
                      )}
                    </div>

                    {/* Script Snippet */}
                    <div className="text-[11px] text-slate-300 font-sans line-clamp-2 leading-relaxed">
                      {m.paragraph?.text || m.searchPhrase || 'No text snippet'}
                    </div>
                  </div>

                  {/* Manual Duration Adjuster */}
                  <div className="mt-2.5 pt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px]">
                    <span className="text-slate-500 font-mono text-[10px]">Duration:</span>
                    <div className="flex items-center gap-1 font-mono">
                      <button
                        type="button"
                        onClick={() => onUpdateSlideDuration && onUpdateSlideDuration(idx, Math.max(0.5, m.duration - 0.5))}
                        className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold"
                        title="-0.5s"
                      >
                        -
                      </button>
                      <span className="w-12 text-center font-bold text-slate-200">{m.duration.toFixed(1)}s</span>
                      <button
                        type="button"
                        onClick={() => onUpdateSlideDuration && onUpdateSlideDuration(idx, m.duration + 0.5)}
                        className="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 flex items-center justify-center text-xs font-bold"
                        title="+0.5s"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ROW 3: DOCKED BOTTOM EXPORT & RENDER BAR */}
      <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-wrap lg:flex-nowrap items-center justify-between gap-4 shadow-xl">
        {/* Left/Center Controls */}
        <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
          {/* Export Mode Toggle */}
          <div className="flex items-center bg-slate-950/60 p-0.5 rounded-lg border border-slate-800">
            <button
              type="button"
              onClick={() => onExportModeChange('single')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                exportMode === 'single'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Film className="w-3.5 h-3.5" />
              <span>Single MP4</span>
            </button>
            <button
              type="button"
              onClick={() => onExportModeChange('clips_zip')}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer ${
                exportMode === 'clips_zip'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Archive className="w-3.5 h-3.5" />
              <span>Clips ZIP</span>
            </button>
          </div>

          {/* Resolution Selector */}
          <select
            value={selectedResolution}
            onChange={(e) => onResolutionChange(e.target.value as VideoResolution)}
            className="px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-semibold text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="1080p">1080p Full HD (1920 × 1080 - 16:9)</option>
            <option value="4k">4K Ultra HD (3840 × 2160 - 16:9)</option>
            <option value="720p">720p HD (1280 × 720 - 16:9)</option>
            <option value="tiktok">9:16 Vertical TikTok (1080 × 1920)</option>
            <option value="square">1:1 Square (1080 × 1080)</option>
          </select>

          {/* Output Filename */}
          <input
            type="text"
            value={outputFileName}
            onChange={(e) => onOutputFileNameChange(e.target.value)}
            className="w-44 px-3 py-1.5 rounded-lg border border-slate-800 bg-slate-950/60 text-xs font-mono text-slate-200 focus:outline-none focus:border-indigo-500"
            placeholder="output_video.mp4"
          />

          {/* Motion & Watermark Popover Trigger */}
          <button
            type="button"
            onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
            className="px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
            <span>Motion Zoom</span>
            {showAdvancedSettings ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>

          {/* Inline Status Caption */}
          <div className="text-xs flex items-center gap-1.5">
            {isReady ? (
              <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                <span>All {activeMatches.length} slides ready</span>
              </span>
            ) : missingImagesCount > 0 ? (
              <span className="flex items-center gap-1.5 text-amber-400 font-semibold">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Need {missingImagesCount} more image{missingImagesCount === 1 ? '' : 's'}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-slate-500">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>Paste SRT &amp; script</span>
              </span>
            )}
          </div>
        </div>

        {/* Right Primary CTA: Compile & Add to Render Queue */}
        <button
          type="button"
          onClick={onCompileAndQueue}
          disabled={!isReady}
          className={`px-5 py-2.5 rounded-lg text-xs sm:text-sm font-semibold flex items-center gap-2 transition-all shadow-md active:scale-95 cursor-pointer shrink-0 ${
            isReady
              ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-600/30'
              : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
          }`}
        >
          <Layers className="w-4 h-4" />
          <span>Compile &amp; Add to Render Queue</span>
        </button>
      </div>

      {/* Advanced Motion Settings Drawer */}
      {showAdvancedSettings && (
        <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-xs">
          <div>
            <span className="font-bold text-slate-200">Intel QSV Hardware Ken Burns Zoom</span>
            <p className="text-[11px] text-slate-400">Smooth sub-pixel hardware-accelerated pan and zoom motion</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer text-slate-300">
              <input
                type="checkbox"
                checked={motionSettings.zoomEnabled}
                onChange={(e) => onMotionSettingsChange({ ...motionSettings, zoomEnabled: e.target.checked })}
                className="w-4 h-4 text-indigo-600 rounded bg-slate-950 border-slate-700"
              />
              <span>Enabled</span>
            </label>
          </div>
        </div>
      )}

      {/* Image Preview Lightbox */}
      {selectedPreviewImage && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-pointer"
          onClick={() => setSelectedPreviewImage(null)}
        >
          <img src={selectedPreviewImage} alt="Preview" className="max-w-4xl max-h-[90vh] rounded-xl object-contain shadow-2xl" />
        </div>
      )}
    </div>
  );
};
