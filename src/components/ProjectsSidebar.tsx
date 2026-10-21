'use client';

import React, { useState } from 'react';
import {
  FolderPlus,
  Folder,
  FolderOpen,
  Trash2,
  Edit2,
  Check,
  X,
  Copy,
  ChevronLeft,
  ChevronRight,
  Layers,
  Clock,
  Image as ImageIcon,
  Download,
  Upload,
} from 'lucide-react';
import { ProjectItem } from '@/lib/types';

interface ProjectsSidebarProps {
  projects: ProjectItem[];
  activeProjectId: string;
  onSelectProject: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteProject: (projectId: string) => void;
  onRenameProject: (projectId: string, newName: string) => void;
  onDuplicateProject?: (projectId: string) => void;
  onExportProject?: (projectId: string) => void;
  onImportProject?: (file: File) => void;
}

export const ProjectsSidebar: React.FC<ProjectsSidebarProps> = ({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onRenameProject,
  onDuplicateProject,
  onExportProject,
  onImportProject,
}) => {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState<string>('');
  const importInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleStartRename = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(project.id);
    setEditName(project.name);
  };

  const handleSaveRename = (projectId: string, e?: React.FormEvent | React.MouseEvent) => {
    if (e) e.stopPropagation();
    const trimmed = editName.trim();
    if (trimmed) {
      onRenameProject(projectId, trimmed);
    }
    setEditingId(null);
  };

  const handleCancelRename = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(null);
  };

  const handleDelete = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (projects.length <= 1) {
      if (!confirm(`Delete "${project.name}" and start a fresh project?`)) return;
    } else {
      if (!confirm(`Are you sure you want to delete "${project.name}"? This cannot be undone.`)) return;
    }
    onDeleteProject(project.id);
  };

  const handleDuplicate = (project: ProjectItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (onDuplicateProject) {
      onDuplicateProject(project.id);
    }
  };

  const formatDuration = (sec?: number) => {
    if (!sec || isNaN(sec) || sec <= 0) return null;
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  if (isCollapsed) {
    return (
      <aside className="w-14 shrink-0 bg-slate-900/90 border-r border-slate-800 flex flex-col items-center py-3 transition-all duration-300 z-20 select-none">
        <button
          onClick={() => setIsCollapsed(false)}
          title="Expand Projects Sidebar"
          className="p-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white transition shadow-sm mb-4 cursor-pointer"
        >
          <ChevronRight className="w-4 h-4" />
        </button>

        <button
          onClick={onCreateProject}
          title="Create New Project"
          className="w-8 h-8 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center transition active:scale-95 mb-5 cursor-pointer shadow-sm shadow-indigo-600/30"
        >
          <FolderPlus className="w-4 h-4" />
        </button>

        <div className="w-full flex-1 overflow-y-auto space-y-2 px-1">
          {projects.map((proj, idx) => {
            const isActive = proj.id === activeProjectId;
            return (
              <button
                key={proj.id}
                onClick={() => onSelectProject(proj.id)}
                title={`${proj.name} (${proj.images?.length || 0} slides)`}
                className={`w-9 h-9 mx-auto rounded-lg flex items-center justify-center text-xs font-bold transition cursor-pointer ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-400'
                    : 'bg-slate-800/60 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                {idx + 1}
              </button>
            );
          })}
        </div>
      </aside>
    );
  }

  return (
    <aside className="w-64 shrink-0 bg-slate-900/90 border-r border-slate-800 flex flex-col h-full transition-all duration-300 z-20">
      {/* Header (h-14) */}
      <div className="h-14 px-4 border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold">
            <Folder className="w-3.5 h-3.5" />
          </div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs font-bold text-white tracking-wide">
              Projects
            </h2>
            <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-800 text-slate-400 border border-slate-700/60 font-mono">
              {projects.length}
            </span>
          </div>
        </div>

        <button
          onClick={() => setIsCollapsed(true)}
          title="Collapse Sidebar"
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      {/* CTA: + Create Project and Import Project */}
      <div className="p-3 border-b border-slate-800 shrink-0 space-y-1.5">
        <button
          onClick={onCreateProject}
          className="w-full py-2 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs shadow-sm transition-all flex items-center justify-center gap-2 active:scale-[0.98] cursor-pointer"
        >
          <FolderPlus className="w-3.5 h-3.5" />
          <span>+ Create Project</span>
        </button>
        {onImportProject && (
          <>
            <input
              type="file"
              ref={importInputRef}
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onImportProject(file);
                  e.target.value = '';
                }
              }}
            />
            <button
              onClick={() => importInputRef.current?.click()}
              className="w-full py-1.5 px-3 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 text-slate-300 hover:text-white font-medium text-[11px] border border-slate-700/60 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
            >
              <Upload className="w-3 h-3 text-slate-400" />
              <span>Import Project (.json)</span>
            </button>
          </>
        )}
      </div>

      {/* Projects List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {projects.length === 0 ? (
          <div className="p-6 text-center text-slate-500 text-xs">
            <Folder className="w-6 h-6 mx-auto mb-2 opacity-40 text-slate-400" />
            <p>No projects yet.</p>
          </div>
        ) : (
          projects.map((proj, idx) => {
            const isActive = proj.id === activeProjectId;
            const isEditing = editingId === proj.id;
            const slideCount = proj.images?.length || 0;
            const durationFormatted = formatDuration(proj.voiceoverDuration);

            return (
              <div
                key={proj.id}
                onClick={() => !isEditing && onSelectProject(proj.id)}
                className={`group relative rounded-xl border p-2.5 transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-500/10 border-indigo-500/40 text-white shadow-xs'
                    : 'bg-slate-900/40 border-slate-800/80 hover:bg-slate-800/70 hover:border-slate-700 text-slate-400 hover:text-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div
                      className={`w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0 ${
                        isActive
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'bg-slate-800 text-slate-400 group-hover:text-slate-200'
                      }`}
                    >
                      {isActive ? <FolderOpen className="w-3 h-3" /> : idx + 1}
                    </div>

                    {isEditing ? (
                      <div
                        className="flex items-center gap-1 flex-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(proj.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          className="flex-1 bg-slate-950 border border-indigo-500 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                        />
                        <button
                          onClick={(e) => handleSaveRename(proj.id, e)}
                          className="p-1 text-emerald-400 hover:bg-slate-800 rounded"
                          title="Save"
                        >
                          <Check className="w-3 h-3" />
                        </button>
                        <button
                          onClick={handleCancelRename}
                          className="p-1 text-slate-400 hover:bg-slate-800 rounded"
                          title="Cancel"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="min-w-0 flex-1">
                        <h3
                          className={`text-xs font-semibold truncate ${
                            isActive ? 'text-white' : 'text-slate-300'
                          }`}
                          title={proj.name}
                        >
                          {proj.name}
                        </h3>
                      </div>
                    )}
                  </div>

                  {/* Action icons on hover */}
                  {!isEditing && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={(e) => handleStartRename(proj, e)}
                        title="Rename Project"
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {onDuplicateProject && (
                        <button
                          onClick={(e) => handleDuplicate(proj, e)}
                          title="Duplicate Project"
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                      )}
                      {onExportProject && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onExportProject(proj.id);
                          }}
                          title="Export Project (JSON)"
                          className="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 transition"
                        >
                          <Download className="w-3 h-3" />
                        </button>
                      )}
                      <button
                        onClick={(e) => handleDelete(proj, e)}
                        title="Delete Project"
                        className="p-1 rounded text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Bottom Row: Slide Count, Duration Badge, Step Indicator */}
                <div className="mt-2 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="flex items-center gap-0.5">
                      <ImageIcon className="w-2.5 h-2.5" />
                      <span>{slideCount} slides</span>
                    </span>
                    {durationFormatted && (
                      <>
                        <span>•</span>
                        <span className="flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          <span>{durationFormatted}</span>
                        </span>
                      </>
                    )}
                  </div>
                  <span className={isActive ? 'text-indigo-400' : 'text-slate-500'}>
                    Step {proj.activeStep || 1}/5
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Footer Info */}
      <div className="h-10 px-3 border-t border-slate-800 bg-slate-950/40 text-[10px] text-slate-500 flex items-center justify-between shrink-0">
        <span className="flex items-center gap-1">
          <Layers className="w-3 h-3 text-slate-400" />
          <span>Local Studio Store</span>
        </span>
        <span className="font-mono text-slate-400">
          {projects.length} Active
        </span>
      </div>
    </aside>
  );
};
