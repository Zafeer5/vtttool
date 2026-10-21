'use client';

import React from 'react';
import {
  Film,
  Layers,
  Undo2,
  Redo2,
  CheckCircle2,
  Sliders,
  FolderOpen,
  Sparkles,
  DownloadCloud,
  ChevronDown,
  Plus,
  Play,
  RotateCcw,
  ShieldCheck,
  Video,
} from 'lucide-react';
import { ProjectItem, SyncMode, ExportMode } from '@/lib/types';
import { VideoResolution } from '@/lib/image-helper';

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
    <header className="h-14 border-b border-[#2B3947] bg-[#111821] px-4 flex items-center justify-between gap-3 select-none z-30">
      {/* LEFT: BRANDING & PROJECT SELECTOR */}
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2DD4BF] to-[#0D9488] flex items-center justify-center shadow-[0_2px_10px_rgba(45,212,191,0.25)] text-[#0B0F14]">
            <Film className="w-4 h-4" />
          </div>
          <div className="hidden sm:block leading-tight">
            <h1 className="text-xs font-bold tracking-tight text-[#F1F5F9] flex items-center gap-1.5">
              <span>VTT SlideSync</span>
              <span className="px-1.5 py-0.2 rounded bg-[#2DD4BF]/15 text-[#2DD4BF] text-[9px] font-mono font-bold tracking-wide">
                2.0
              </span>
            </h1>
            <p className="text-[10px] text-[#748396]">Production Studio</p>
          </div>
        </div>

        <div className="h-5 w-px bg-[#2B3947] hidden md:block" />

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
              className="px-2 py-1 rounded bg-[#18222D] border border-[#2DD4BF] text-xs font-semibold text-[#F1F5F9] outline-none"
            />
          ) : (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setShowProjectMenu(!showProjectMenu)}
                className="px-2.5 py-1 rounded-md bg-[#18222D] hover:bg-[#202C38] border border-[#2B3947] text-xs font-semibold text-[#F1F5F9] flex items-center gap-1.5 transition cursor-pointer max-w-[180px] truncate"
                title="Switch project"
              >
                <span className="truncate">{activeProject.name}</span>
                <ChevronDown className="w-3 h-3 text-[#A4B1C0]" />
              </button>
              <button
                type="button"
                onClick={() => setIsEditingTitle(true)}
                className="p-1 rounded text-[#748396] hover:text-[#A4B1C0] hover:bg-[#18222D] transition text-[10px]"
                title="Rename project"
              >
                Edit
              </button>
            </div>
          )}

          {/* Project Menu Dropdown */}
          {showProjectMenu && (
            <div className="absolute top-full left-0 mt-1 w-52 rounded-lg bg-[#18222D] border border-[#2B3947] shadow-2xl p-1.5 z-50">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[#748396] px-2 py-1">
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
                        ? 'bg-[#2DD4BF]/15 text-[#2DD4BF] font-semibold'
                        : 'text-[#F1F5F9] hover:bg-[#202C38]'
                    }`}
                  >
                    <span className="truncate">{p.name}</span>
                    {p.id === activeProject.id && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                ))}
              </div>
              <div className="border-t border-[#2B3947] mt-1 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    onCreateProject();
                    setShowProjectMenu(false);
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded text-xs text-[#2DD4BF] hover:bg-[#2DD4BF]/10 flex items-center gap-1.5 transition cursor-pointer font-medium"
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
        <div className="flex items-center bg-[#18222D] rounded-lg border border-[#2B3947] p-0.5">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded text-[#A4B1C0] hover:text-[#F1F5F9] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title="Undo timeline adjustment (Ctrl+Z)"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded text-[#A4B1C0] hover:text-[#F1F5F9] disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
            title="Redo timeline adjustment (Ctrl+Y)"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Sync Mode Pill */}
        <div className="flex items-center bg-[#18222D] rounded-lg border border-[#2B3947] p-0.5">
          {(['vtt_driven', 'audio_script', 'guided_auto', 'manual'] as SyncMode[]).map((mode) => {
            const isSelected = syncMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => onSyncModeChange(mode)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold transition cursor-pointer ${
                  isSelected
                    ? 'bg-[#2DD4BF] text-[#0B0F14] shadow-sm font-bold'
                    : 'text-[#A4B1C0] hover:text-[#F1F5F9] hover:bg-[#202C38]'
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
          className="px-2.5 py-1.5 rounded-lg border border-[#2B3947] bg-[#18222D] hover:bg-[#202C38] text-[#F1F5F9] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          title="Open Rendered Videos Library"
        >
          <FolderOpen className="w-3.5 h-3.5 text-[#2DD4BF]" />
          <span className="hidden sm:inline">Library</span>
          {libraryCount > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-[#2B3947] text-[#A4B1C0] font-mono text-[10px]">
              {libraryCount}
            </span>
          )}
        </button>

        {/* Render Queue Drawer Toggle */}
        <button
          type="button"
          onClick={onToggleQueue}
          className={`px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition cursor-pointer ${
            isQueueOpen
              ? 'border-[#2DD4BF] bg-[#2DD4BF]/15 text-[#2DD4BF]'
              : 'border-[#2B3947] bg-[#18222D] hover:bg-[#202C38] text-[#F1F5F9]'
          }`}
          title="Toggle Background Render Queue"
        >
          <Layers className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Queue</span>
          {queueCount > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] font-mono font-bold ${
                activeRenderCount > 0
                  ? 'bg-[#2DD4BF] text-[#0B0F14] animate-pulse'
                  : 'bg-[#2B3947] text-[#A4B1C0]'
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
          className="px-2.5 py-1.5 rounded-lg border border-[#2B3947] bg-[#18222D] hover:bg-[#202C38] text-[#A4B1C0] hover:text-[#F1F5F9] text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          title="Run pre-render diagnostic checklist"
        >
          <ShieldCheck className="w-3.5 h-3.5 text-[#2DD4BF]" />
          <span className="hidden md:inline">Validate</span>
        </button>

        {/* Master Compile & Render Action */}
        <button
          type="button"
          onClick={onCompileAndRender}
          disabled={isRendering}
          className="px-3.5 py-1.5 rounded-lg bg-[#2DD4BF] hover:bg-[#5EEAD4] active:bg-[#14B8A6] text-[#0B0F14] text-xs font-bold flex items-center gap-1.5 shadow-[0_2px_12px_rgba(45,212,191,0.25)] transition cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
        >
          <Play className="w-3.5 h-3.5 fill-[#0B0F14]" />
          <span>Render Video</span>
        </button>
      </div>
    </header>
  );
};
