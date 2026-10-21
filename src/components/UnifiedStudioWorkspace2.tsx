'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  FolderOpen,
  Sliders,
  Sparkles,
  X,
  Layers,
  ChevronRight,
  Maximize2,
  Film,
  CheckCircle2,
} from 'lucide-react';
import {
  SyncMatch,
  VttCue,
  ScriptParagraph,
  ImageItem,
  MotionSettings,
  ExportMode,
  ZoomDirection,
} from '@/lib/types';
import { ScriptSplitMode } from '@/lib/script-parser';
import { VideoResolution } from '@/lib/image-helper';
import { extractSyncReviewItems } from '@/lib/matcher';
import { SourceMediaPanel } from './SourceMediaPanel';
import { StudioPreviewPlayer } from './StudioPreviewPlayer';
import { SlideInspector } from './SlideInspector';
import { ProMultiTrackTimeline } from './ProMultiTrackTimeline';

interface UnifiedStudioWorkspace2Props {
  matches: SyncMatch[];
  cues: VttCue[];
  paragraphs: ScriptParagraph[];
  images: ImageItem[];
  rawScript: string;
  rawVtt: string;
  scriptSplitMode: ScriptSplitMode;
  voiceoverFile: File | null;
  voiceoverUrl: string | null;
  voiceoverDuration: number;
  activeTotalDuration: number;
  selectedResolution: VideoResolution;
  motionSettings: MotionSettings;
  exportMode: ExportMode;
  onScriptChange: (val: string) => void;
  onSplitModeChange: (mode: ScriptSplitMode) => void;
  onVttChange: (val: string) => void;
  onVoiceoverFileChange: (file: File | null) => void;
  onImagesChange: (images: ImageItem[]) => void;
  onResolutionChange: (res: VideoResolution) => void;
  onExportModeChange: (mode: ExportMode) => void;
  onUpdateMatches: (updatedMatches: SyncMatch[]) => void;
  onMotionSettingsChange: (settings: MotionSettings) => void;
  onAutoSyncOptimize?: () => void;
}

export const UnifiedStudioWorkspace2: React.FC<UnifiedStudioWorkspace2Props> = ({
  matches,
  cues,
  paragraphs,
  images,
  rawScript,
  rawVtt,
  scriptSplitMode,
  voiceoverFile,
  voiceoverUrl,
  voiceoverDuration,
  activeTotalDuration,
  selectedResolution,
  motionSettings,
  exportMode: _exportMode,
  onScriptChange,
  onSplitModeChange,
  onVttChange,
  onVoiceoverFileChange,
  onImagesChange,
  onResolutionChange,
  onExportModeChange: _onExportModeChange,
  onUpdateMatches,
  onMotionSettingsChange: _onMotionSettingsChange,
  onAutoSyncOptimize,
}) => {
  const [selectedSlideIndex, setSelectedSlideIndex] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  
  // Clean Embedded UI: Flyout Drawers instead of permanent bulky columns!
  const [activeDrawer, setActiveDrawer] = useState<'media' | 'inspector' | null>(null);

  // Extract review items
  const reviewItems = useMemo(() => {
    return extractSyncReviewItems(matches, images, cues, voiceoverDuration);
  }, [matches, images, cues, voiceoverDuration]);

  // Selected slide
  const selectedSlide = useMemo(() => {
    if (matches.length === 0) return null;
    const safeIdx = Math.max(0, Math.min(selectedSlideIndex, matches.length - 1));
    return matches[safeIdx] || null;
  }, [matches, selectedSlideIndex]);

  // Update slide timing
  const handleUpdateSlideTiming = useCallback(
    (index: number, newStart: number, newEnd: number) => {
      if (index < 0 || index >= matches.length) return;
      const cleanStart = Number(newStart.toFixed(3));
      const cleanEnd = Number(newEnd.toFixed(3));
      const newDur = Math.max(0.2, Number((cleanEnd - cleanStart).toFixed(3)));

      const updated = matches.map((m) => ({ ...m }));
      updated[index].startTime = cleanStart;
      updated[index].endTime = cleanEnd;
      updated[index].duration = newDur;
      updated[index].isManualEdit = true;
      updated[index].status = 'confirmed';

      // Connect prior and next slide boundaries
      if (index > 0 && updated[index - 1].endTime !== cleanStart) {
        updated[index - 1].endTime = cleanStart;
        updated[index - 1].duration = Math.max(0.2, Number((cleanStart - updated[index - 1].startTime).toFixed(3)));
      }
      if (index < updated.length - 1 && updated[index + 1].startTime !== cleanEnd) {
        const diff = cleanEnd - updated[index + 1].startTime;
        for (let j = index + 1; j < updated.length; j++) {
          updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
          updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
        }
      }

      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Update slide duration
  const handleUpdateSlideDuration = useCallback(
    (index: number, newDuration: number) => {
      if (index < 0 || index >= matches.length) return;
      const cleanDur = Math.max(0.2, Number(newDuration.toFixed(3)));
      const diff = cleanDur - matches[index].duration;

      const updated = matches.map((m) => ({ ...m }));
      updated[index].duration = cleanDur;
      updated[index].endTime = Number((updated[index].startTime + cleanDur).toFixed(3));
      updated[index].isManualEdit = true;
      updated[index].status = 'confirmed';

      // Ripple diff to remaining slides
      if (diff !== 0 && index < updated.length - 1) {
        for (let j = index + 1; j < updated.length; j++) {
          updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
          updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
        }
      }

      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Update slide image
  const handleUpdateSlideImage = useCallback(
    (index: number, image: ImageItem | null) => {
      if (index < 0 || index >= matches.length) return;
      const updated = matches.map((m) => ({ ...m }));
      updated[index].image = image;
      updated[index].isManualEdit = true;
      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Update zoom direction
  const handleUpdateZoomDirection = useCallback(
    (index: number, dir: Exclude<ZoomDirection, 'random'>) => {
      if (index < 0 || index >= matches.length) return;
      const updated = matches.map((m) => ({ ...m }));
      updated[index].zoomDirection = dir;
      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Confirm slide timing
  const handleConfirmSlideTiming = useCallback(
    (index: number) => {
      if (index < 0 || index >= matches.length) return;
      const updated = matches.map((m) => ({ ...m }));
      const currentlyConfirmed = updated[index].isManualEdit || updated[index].status === 'confirmed';
      updated[index].isManualEdit = !currentlyConfirmed;
      updated[index].status = !currentlyConfirmed ? 'confirmed' : 'auto_high';
      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Confirm all timing
  const handleConfirmAllTiming = useCallback(() => {
    const updated = matches.map((m) => ({
      ...m,
      isManualEdit: true,
      status: 'confirmed' as const,
    }));
    onUpdateMatches(updated);
  }, [matches, onUpdateMatches]);

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50 text-slate-900 select-none relative">
      {/* EMBEDDED CONTEXTUAL ACTION BAR */}
      <div className="h-11 px-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3 shrink-0 shadow-2xs z-20">
        <div className="flex items-center gap-2">
          {/* Media & Sources Drawer Toggle */}
          <button
            type="button"
            onClick={() => setActiveDrawer(activeDrawer === 'media' ? null : 'media')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-2xs ${
              activeDrawer === 'media'
                ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-orange-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}
            title="Open Media, Script, VTT & Images Manager"
          >
            <FolderOpen className="w-3.5 h-3.5 text-orange-600" />
            <span>Media &amp; Assets</span>
            <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 font-mono text-[10px]">
              {images.length} imgs {voiceoverFile ? '• audio' : ''}
            </span>
          </button>

          {/* Slide Inspector Drawer Toggle */}
          <button
            type="button"
            onClick={() => setActiveDrawer(activeDrawer === 'inspector' ? null : 'inspector')}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-2 transition cursor-pointer shadow-2xs ${
              activeDrawer === 'inspector'
                ? 'border-orange-500 bg-orange-50 text-orange-700 shadow-orange-500/10'
                : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
            }`}
            title="Open Slide Inspector for fine-tuning timing & Ken Burns motion"
          >
            <Sliders className="w-3.5 h-3.5 text-orange-600" />
            <span>Slide Details</span>
            {selectedSlide && (
              <span className="px-1.5 py-0.2 rounded bg-orange-100/60 text-orange-800 font-mono text-[10px]">
                #{selectedSlideIndex + 1}
              </span>
            )}
          </button>
        </div>

        {/* Center: Smart Auto-Sync Action */}
        <div className="flex items-center gap-2">
          {onAutoSyncOptimize && (
            <button
              type="button"
              onClick={onAutoSyncOptimize}
              className="px-3 py-1 rounded-lg border border-orange-200 bg-orange-50/70 hover:bg-orange-100 text-orange-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              title="One-click intelligent alignment between voiceover cues and slides"
            >
              <Sparkles className="w-3.5 h-3.5 text-orange-600" />
              <span>Smart Auto-Sync</span>
            </button>
          )}

          <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            <span>{matches.length} Slides Synchronized</span>
          </div>
        </div>
      </div>

      {/* UPPER SECTION: UNCLUTTERED FULL-WIDTH PREVIEW STAGE */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* CENTER HERO PREVIEW PLAYER (occupies 100% of workspace width) */}
        <div className="flex-1 min-w-0 h-full overflow-hidden bg-slate-50">
          <StudioPreviewPlayer
            matches={matches}
            cues={cues}
            totalDuration={voiceoverDuration || activeTotalDuration}
            voiceoverUrl={voiceoverUrl}
            selectedResolution={selectedResolution}
            onResolutionChange={onResolutionChange}
            motionSettings={motionSettings}
            activeSlideIndex={selectedSlideIndex}
            onSelectSlide={(idx) => {
              setSelectedSlideIndex(idx);
              if (matches[idx]) setCurrentTime(matches[idx].startTime);
            }}
            currentTime={currentTime}
            onSeek={(t) => setCurrentTime(t)}
            isPlaying={isPlaying}
            onTogglePlay={() => setIsPlaying(!isPlaying)}
          />
        </div>

        {/* EMBEDDED SLIDE-OVER DRAWER: MEDIA & SOURCES (Slides in over canvas on demand) */}
        {activeDrawer === 'media' && (
          <div className="absolute inset-y-0 left-0 z-40 w-96 max-w-full bg-white border-r border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-left duration-200">
            <div className="h-10 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <FolderOpen className="w-4 h-4 text-orange-600" />
                <span>Media &amp; Assets Manager</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
                title="Close drawer (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SourceMediaPanel
                voiceoverFile={voiceoverFile}
                voiceoverUrl={voiceoverUrl}
                voiceoverDuration={voiceoverDuration}
                onVoiceoverFileChange={onVoiceoverFileChange}
                rawScript={rawScript}
                scriptSplitMode={scriptSplitMode}
                paragraphs={paragraphs}
                onScriptChange={onScriptChange}
                onSplitModeChange={onSplitModeChange}
                rawVtt={rawVtt}
                cues={cues}
                onVttChange={onVttChange}
                images={images}
                onImagesChange={onImagesChange}
                selectedSlideIndex={selectedSlideIndex}
                onAssignImageToSlide={(img, idx) => handleUpdateSlideImage(idx, img)}
                reviewItems={reviewItems}
                matches={matches}
                onSelectSlide={(idx) => {
                  setSelectedSlideIndex(idx);
                  if (matches[idx]) setCurrentTime(matches[idx].startTime);
                }}
                onConfirmAllTiming={handleConfirmAllTiming}
              />
            </div>
          </div>
        )}

        {/* EMBEDDED SLIDE-OVER DRAWER: SLIDE INSPECTOR (Slides in over canvas on demand) */}
        {activeDrawer === 'inspector' && (
          <div className="absolute inset-y-0 right-0 z-40 w-88 max-w-full bg-white border-l border-slate-200 shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
            <div className="h-10 px-4 border-b border-slate-200 flex items-center justify-between bg-slate-50 shrink-0">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                <Sliders className="w-4 h-4 text-orange-600" />
                <span>Slide #{selectedSlideIndex + 1} Inspector</span>
              </div>
              <button
                type="button"
                onClick={() => setActiveDrawer(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition cursor-pointer"
                title="Close drawer (Esc)"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <SlideInspector
                slide={selectedSlide}
                slideIndex={selectedSlideIndex}
                totalSlides={matches.length}
                voiceoverUrl={voiceoverUrl}
                motionSettings={motionSettings}
                onUpdateSlideTiming={handleUpdateSlideTiming}
                onUpdateSlideDuration={handleUpdateSlideDuration}
                onUpdateSlideImage={handleUpdateSlideImage}
                onUpdateSlideZoomDirection={handleUpdateZoomDirection}
                onConfirmSlideTiming={handleConfirmSlideTiming}
              />
            </div>
          </div>
        )}
      </div>

      {/* LOWER SECTION: PRO MULTI-TRACK TIMELINE */}
      <ProMultiTrackTimeline
        matches={matches}
        cues={cues}
        totalDuration={voiceoverDuration || activeTotalDuration}
        currentTime={currentTime}
        onSeek={(t) => setCurrentTime(t)}
        isPlaying={isPlaying}
        onTogglePlay={() => setIsPlaying(!isPlaying)}
        activeSlideIndex={selectedSlideIndex}
        onSelectSlide={(idx) => {
          setSelectedSlideIndex(idx);
        }}
        onUpdateMatches={onUpdateMatches}
        onAutoSyncOptimize={onAutoSyncOptimize}
      />
    </div>
  );
};
