'use client';

import React, { useState } from 'react';
import { Film, BookOpen, X, FolderArchive, Layers } from 'lucide-react';

interface HeaderProps {
  onOpenLibrary?: () => void;
  libraryCount?: number;
  onOpenQueue?: () => void;
  isQueueOpen?: boolean;
  queueCount?: number;
  activeRenderCount?: number;
  activeProjectName?: string;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenLibrary,
  libraryCount = 0,
  onOpenQueue,
  isQueueOpen = false,
  queueCount = 0,
  activeRenderCount = 0,
  activeProjectName,
}) => {
  const [showDocsModal, setShowDocsModal] = useState(false);

  return (
    <>
      <header className="h-14 px-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/60 backdrop-blur-md sticky top-0 z-40 select-none">
        {/* Left: App Logo, Title, Active Project Pill, Micro-Badge */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-indigo-600/90 text-white flex items-center justify-center shadow-sm shadow-indigo-500/30">
              <Film className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-100 tracking-tight">
              SlideSync Studio
            </span>
          </div>

          <span className="text-slate-600 font-mono text-xs">/</span>

          {activeProjectName && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/25 text-indigo-300 text-xs font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />
              <span>{activeProjectName}</span>
            </div>
          )}

          <span className="hidden sm:inline-flex items-center text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
            VIDEO WORKSPACE
          </span>
        </div>

        {/* Right: Segmented toolbar for Exported Files, Docs, and Render Queue */}
        <div className="flex items-center gap-2">
          {/* Exported Files Button */}
          <button
            type="button"
            onClick={onOpenLibrary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-200 text-xs font-semibold transition-all cursor-pointer"
            title="View Exported Files (Videos & ZIPs with timings, file size, download)"
          >
            <FolderArchive className="w-3.5 h-3.5 text-indigo-400" />
            <span>Exported Files</span>
            {libraryCount > 0 && (
              <span className="px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-indigo-500 text-white leading-none">
                {libraryCount}
              </span>
            )}
          </button>

          {/* Documentation Modal Toggle */}
          <button
            type="button"
            onClick={() => setShowDocsModal(true)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-300 hover:text-slate-100 text-xs font-medium transition-colors cursor-pointer"
            title="Open Studio Documentation"
          >
            <BookOpen className="w-3.5 h-3.5 text-slate-400" />
            <span>Documentation</span>
          </button>

          {/* Render Queue Drawer Toggle Button */}
          <button
            type="button"
            onClick={onOpenQueue}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all cursor-pointer ${
              isQueueOpen
                ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/40 ring-1 ring-indigo-500/30'
                : activeRenderCount > 0
                ? 'border-indigo-400 bg-indigo-500/20 text-indigo-200 ring-2 ring-indigo-400/30'
                : 'border-slate-700/80 bg-slate-800/60 hover:bg-slate-800 text-slate-300'
            }`}
            title="Toggle Render Queue Drawer"
          >
            <Layers className={`w-3.5 h-3.5 ${activeRenderCount > 0 ? 'text-indigo-400 animate-pulse' : 'text-slate-400'}`} />
            <span>Render Queue</span>
            {queueCount > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold text-white leading-none ${
                  activeRenderCount > 0 ? 'bg-indigo-500 animate-pulse' : 'bg-slate-700'
                }`}
              >
                {queueCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Studio Workflow Documentation Modal */}
      {showDocsModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-slate-900 rounded-2xl border border-slate-800 shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-indigo-400" />
                <h3 className="font-mono text-sm font-bold text-slate-100">
                  Studio Workflow Documentation
                </h3>
              </div>
              <button
                onClick={() => setShowDocsModal(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-300 leading-relaxed font-sans">
              <div className="space-y-1.5">
                <h4 className="font-mono font-bold text-slate-100 flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-400 font-bold">1</span>
                  Audio &amp; Voiceover Transcription
                </h4>
                <p className="text-slate-400">
                  Upload your voiceover audio file (.wav, .mp3) or paste a .VTT subtitle file. High-speed speech-to-text generates precise cues with pause-aware start time marking.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-mono font-bold text-slate-100 flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-400 font-bold">2</span>
                  Script Paragraphs &amp; Slide Images
                </h4>
                <p className="text-slate-400">
                  Paste your text script. Each paragraph represents exactly one slide image. Upload your slide images in order. The engine auto-matches 1 image per paragraph slide.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-mono font-bold text-slate-100 flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-400 font-bold">3</span>
                  Alignment Verification &amp; Timeline Preview
                </h4>
                <p className="text-slate-400">
                  Review the slide timing triggers in the Synchronized Slide Timeline. Open the Multi-Track Timeline to adjust durations, audition audio sentences, and fine-tune Ken Burns motion zoom.
                </p>
              </div>

              <div className="space-y-1.5">
                <h4 className="font-mono font-bold text-slate-100 flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 border border-slate-700 text-indigo-400 font-bold">4</span>
                  Hardware Acceleration &amp; Parallel Render
                </h4>
                <p className="text-slate-400">
                  Rendering executes using Intel Quick Sync Video (<code className="text-indigo-400 font-mono">h264_qsv</code>) and a 4-core worker pool. Scene segments compile in parallel with zero re-encode concatenation in under 2 seconds.
                </p>
              </div>

              <div className="space-y-1.5 p-3 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
                <h4 className="font-mono font-bold text-indigo-300 flex items-center gap-1.5 text-xs">
                  <span className="px-1.5 py-0.5 rounded bg-indigo-600 text-white font-bold">5</span>
                  24-Hour Exported Files Protection
                </h4>
                <p className="text-indigo-200/80 text-[11px]">
                  Every exported video (.mp4) or clips package (.zip) is preserved in your local library for <strong>24 hours</strong>. If you refresh or close your browser, your ready files remain accessible. Files downloaded to your computer stay permanently safe.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-800 bg-slate-950/60 flex items-center justify-end">
              <button
                onClick={() => setShowDocsModal(false)}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-500 transition-colors cursor-pointer"
              >
                Close Documentation
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
