'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Sliders,
  Sparkles,
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
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(true);
  const [isInspectorOpen, setIsInspectorOpen] = useState<boolean>(true);

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

      for (let j = index + 1; j < updated.length; j++) {
        updated[j].startTime = Number((updated[j].startTime + diff).toFixed(3));
        updated[j].endTime = Number((updated[j].endTime + diff).toFixed(3));
      }

      onUpdateMatches(updated);
    },
    [matches, onUpdateMatches]
  );

  // Update assigned image for a slide
  const handleUpdateSlideImage = useCallback(
    (index: number, image: ImageItem | null) => {
      if (index < 0 || index >= matches.length) return;
      const updated = matches.map((m) => ({ ...m }));
      updated[index].image = image;
      updated[index].isManualEdit = true;
      if (image) {
        updated[index].warning = undefined;
      }
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
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#0B0F14] text-[#F1F5F9] select-none">
      {/* UPPER SECTION: LEFT PANEL (SOURCES) | CENTER (PREVIEW) | RIGHT (INSPECTOR) */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* LEFT DOCKED PANEL: SOURCES & ASSETS */}
        {isLeftPanelOpen && (
          <div className="w-80 sm:w-88 shrink-0 h-full overflow-hidden">
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
        )}

        {/* Left Panel Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsLeftPanelOpen(!isLeftPanelOpen)}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20 w-4 h-12 rounded-r-md bg-[#18222D] hover:bg-[#202C38] border-y border-r border-[#2B3947] text-[#748396] hover:text-[#F1F5F9] flex items-center justify-center transition shadow-lg cursor-pointer"
          style={{ left: isLeftPanelOpen ? '20rem' : '0' }}
          title={isLeftPanelOpen ? 'Collapse sources panel' : 'Expand sources panel'}
        >
          {isLeftPanelOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        </button>

        {/* CENTER PREVIEW PLAYER */}
        <div className="flex-1 min-w-0 h-full overflow-hidden">
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

        {/* Right Inspector Collapse Toggle */}
        <button
          type="button"
          onClick={() => setIsInspectorOpen(!isInspectorOpen)}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20 w-4 h-12 rounded-l-md bg-[#18222D] hover:bg-[#202C38] border-y border-l border-[#2B3947] text-[#748396] hover:text-[#F1F5F9] flex items-center justify-center transition shadow-lg cursor-pointer"
          style={{ right: isInspectorOpen ? '20rem' : '0' }}
          title={isInspectorOpen ? 'Collapse inspector panel' : 'Expand inspector panel'}
        >
          {isInspectorOpen ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
        </button>

        {/* RIGHT DOCKED PANEL: SLIDE INSPECTOR */}
        {isInspectorOpen && (
          <div className="w-80 shrink-0 h-full overflow-hidden">
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
        onSelectSlide={(idx) => setSelectedSlideIndex(idx)}
        onUpdateMatches={onUpdateMatches}
        onAutoSyncOptimize={onAutoSyncOptimize}
      />
    </div>
  );
};
