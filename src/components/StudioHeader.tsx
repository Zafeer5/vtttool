'use client';

import React from 'react';
import {
  Film,
  Layers,
  Undo2,
  Redo2,
  CheckCircle2,
  FolderOpen,
  ChevronDown,
  Plus,
  Play,
  ShieldCheck,
  Video,
  Archive,
} from 'lucide-react';
import { ProjectItem, SyncMode, ExportMode } from '@/lib/types';

interface StudioHeaderProps {
  projects: ProjectItem[];
  activeProject: ProjectItem;
  onSelectProject: (id: string) => void;
  onCreateProject: () => void;
  onRenameProject: (id: string, name: string) => void;
  syncMode: SyncMode;
  onSyncModeChange: (mode: SyncMode) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onOpenValidation: () => void;
  onCompileAndRender: () => void;
  isRendering: boolean;
  exportMode: ExportMode;
  onExportModeChange: (mode: ExportMode) => void;
  queueCount: number;
  activeRenderCount: number;
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  libraryCount: number;
  onOpenLibrary: () => void;
  hasUnsavedChanges?: boolean;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onCreateProject,
  onRenameProject,
  syncMode,
  onSyncModeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onOpenValidation,
  onCompileAndRender,
  isRendering,
  exportMode,
  onExportModeChange,
  queueCount,
  activeRenderCount,
  onToggleQueue,
  isQueueOpen,
  libraryCount,
  onOpenLibrary,
  hasUnsavedChanges = false,
}) => {
  const [isEditingTitle, setIsEditingTitle] = React.useState(false);
  const [titleInput, setTitleInput] = React.useState(activeProject.name);
  const [showProjectMenu, setShowProjectMenu] = React.useState(false);

  React.useEffect(() => {
    setTitleInput(activeProject.name);
  }, [activeProject.name]);

  const handleFinishTitleEdit = () => {
    setIsEditingTitle(false);
    if (titleInput.trim() && titleInput !== activeProject.name) {
      onRenameProject(activeProject.id, titleInput.trim());
    } else {
      setTitleInput(activeProject.name);
    }
  };

  const syncModeLabels: Record<SyncMode, { title: string; desc: string }> = {
    vtt_driven: { title: 'VTT-Driven', desc: 'Subtitle cues dictate slide timing' },
    audio_script: { title: 'Audio & Script', desc: 'Voiceover & silence gaps dictate cuts' },
    manual: { title: 'Manual', desc: 'Direct precision boundary control' },
    guided_auto: { title: 'Guided Auto', desc: 'Hybrid sync with silence snapping' },
  };

  return (
    <header className="h-14 border-b border-slate-200 bg-white px-4 flex items-center justify-between gap-3 select-none z-30 shadow-xs">
      {/* LEFT: BRANDING & PROJECT SELECTOR */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#F97316] to-[#EA580C] flex items-center justify-center shadow-md shadow-orange-500/20 text-white">
            <Film className="w-4 h-4" />
          </div>
          <div className="hidden sm:block leading-tight">
            <h1 className="text-xs font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
              <span>VTT SlideSync</span>
              <span className="px-1.5 py-0.2 rounded bg-orange-50 text-orange-700 border border-orange-200 text-[9px] font-mono font-bold tracking-wide">
                Studio
              </span>
            </h1>
            <p className="text-[10px] text-slate-500 font-medium">Video Synchronization Engine</p>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-200 hidden md:block" />

        {/* Project Dropdown / Rename */}
        <div className="relative">
          {isEditingTitle ? (
            <input
              type="text"
              value={titleInput}
              autoFocus
              onChange={(e) => setTitleInput(e.target.value)}
              onBlur={handleFinishTitleEdit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleFinishTitleEdit();
                if (e.key === 'Escape') {
                  setTitleInput(activeProject.name);
                  setIsEditingTitle(false);
                }
              }}
              className="px-2.5 py-1 rounded-md bg-white border-2 border-orange-500 text-xs font-semibold text-slate-900 outline-none shadow-xs"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="px-2.5 py-1 rounded-md bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-1.5 transition cursor-pointer max-w-[180px] truncate shadow-2xs"
                title="Switch project"
              >
                <span className="truncate">{activeProject.name}</span>
                <ChevronDown className="w-3 h-3 text-slate-500" />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition text-[10px]"
                title="Rename project"
              >
                Edit
              </button>
            </div>
          )}

          {/* Project Menu Dropdown */}
          {showProjectMenu && (
            <div className="absolute top-full left-0 mt-1.5 w-52 rounded-lg bg-white border border-slate-200 shadow-xl p-1.5 z-50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-2 py-1">
                Projects ({projects.length})
              </div>
              <div className="max-h-48 overflow-y-auto space-y-0.5">
                {projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      onSelectProject(p.id);
                      setShowProjectMenu(false);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded text-xs flex items-center justify-between transition cursor-pointer ${
                      p.id === activeProject.id
                        ? 'bg-orange-50 text-orange-700 font-semibold'
                        : 'text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.id === activeProject.id && <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-orange-600" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-slate-100 mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onCreateProject();
                    setShowProjectMenu(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs text-orange-600 hover:bg-orange-50 flex items-center gap-1.5 transition cursor-pointer font-medium"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create New Project</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* CENTER: SYNC MODE SELECTOR & UNDO/REDO */}
      <div className="hidden lg:flex items-center gap-2">
        {/* Undo / Redo */}
        <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 p-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title="Undo timeline adjustment (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded text-slate-500 hover:text-slate-900 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title="Redo timeline adjustment (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Sync Mode Pill */}
        <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 p-0.5">
          {(['vtt_driven', 'audio_script', 'guided_auto', 'manual'] as SyncMode[]).map((mode) => {
            const isSelected = syncMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onSyncModeChange(mode)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                  isSelected
                    ? 'bg-orange-600 text-white shadow-xs font-bold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                }`}
                title={syncModeLabels[mode].desc}
              >
                {syncModeLabels[mode].title}
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: LIBRARY, QUEUE, VALIDATE & RENDER ACTIONS */}
      <div className="flex items-center gap-2">
        {/* Rendered Videos Library Modal Toggle */}
        <button
          type="button"
          onClick={onOpenLibrary}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-orange-50/60 hover:border-orange-300 text-slate-700 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
          title="Open Rendered Videos Library"
        >
          <FolderOpen className="w-3.5 h-3.5 text-orange-600" />
          <span className="hidden sm:inline">Library</span>
          {libraryCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-700 font-mono text-[10px]">
              {libraryCount}
            </span>
          )}
        </button>

        {/* Render Queue Drawer Toggle */}
        <button
          type="button"
          onClick={onToggleQueue}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-2xs ${
            isQueueOpen
              ? 'border-orange-500 bg-orange-50 text-orange-700'
              : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
          }`}
          title="Toggle Background Render Queue"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Queue</span>
          {queueCount > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                activeRenderCount > 0
                  ? 'bg-orange-600 text-white animate-pulse'
                  : 'bg-slate-100 text-slate-700'
              }`}
            >
              {queueCount}
            </span>
          )}
        </button>

        {/* Pre-Render Validate Button */}
        <button
          type="button"
          onClick={onOpenValidation}
          className="px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 hover:text-slate-900 text-xs font-medium flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
          title="Run pre-render diagnostic checklist"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-orange-600" />
          <span className="hidden md:inline">Validate</span>
        </button>

        {/* Export Mode Toggle: Single MP4 vs Clips ZIP */}
        <div className="flex items-center bg-slate-100 rounded-lg border border-slate-200 p-0.5" title="Select export output format">
          <button
            type="button"
            onClick={() => onExportModeChange('single')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              exportMode === 'single'
                ? 'bg-orange-600 text-white font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
            title="Export as a single continuous MP4 video"
          >
            <Video className="w-3 h-3" />
            <span>Single</span>
          </button>
          <button
            type="button"
            onClick={() => onExportModeChange('clips_zip')}
            className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition cursor-pointer ${
              exportMode === 'clips_zip'
                ? 'bg-orange-600 text-white font-bold shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
            }`}
            title="Export as individual slide video clips in a ZIP package"
          >
            <Archive className="w-3 h-3" />
            <span>Clips</span>
          </button>
        </div>

        {/* Master Compile & Render Action */}
        <button
          type="button"
          onClick={onCompileAndRender}
          disabled={isRendering}
          className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-700 hover:to-orange-600 active:from-orange-800 active:to-orange-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md shadow-orange-500/25 transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          <Play className="w-3.5 h-3.5 fill-white" />
          <span>{exportMode === 'clips_zip' ? 'Render Clips ZIP' : 'Render Video'}</span>
        </button>
      </div>
    </header>
  );
};
