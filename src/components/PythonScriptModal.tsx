'use client';

import React, { useState } from 'react';
import { Terminal, Copy, Check, X, Zap, Cpu, ArrowRight } from 'lucide-react';
import { MotionSettings } from '@/lib/types';

interface PythonScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  motionSettings?: MotionSettings;
}

export const PythonScriptModal: React.FC<PythonScriptModalProps> = ({
  isOpen,
  onClose,
  motionSettings,
}) => {
  const [copied, setCopied] = useState(false);
  const [cliMode, setCliMode] = useState<'single' | 'clips_zip'>('single');

  if (!isOpen) return null;

  const isZip = cliMode === 'clips_zip';
  let customCommand = isZip
    ? 'python vtt_slideshow_generator.py --vtt subtitles.vtt --script script.txt --images img1.jpg img2.jpg img3.jpg --output my_clips.zip --export-mode clips_zip --resolution 1080p'
    : 'python vtt_slideshow_generator.py --vtt subtitles.vtt --script script.txt --images img1.jpg img2.jpg img3.jpg --output my_video.mp4 --export-mode single --resolution 1080p';

  if (motionSettings && (motionSettings.enabled || motionSettings.zoomEnabled)) {
    if (motionSettings.zoomEnabled) {
      customCommand += ` --zoom ${motionSettings.zoomIntensity}`;
      if (motionSettings.zoomDirection && motionSettings.zoomDirection !== 'random') {
        customCommand += ` --zoom-direction ${motionSettings.zoomDirection}`;
      }
    }
    if (motionSettings.enabled && motionSettings.transitionEnabled && !isZip) {
      customCommand += ` --transition ${motionSettings.transitionType}`;
    }
  }

  const handleCopyCommand = () => {
    navigator.clipboard.writeText(customCommand);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 sm:p-8 space-y-6">
        
        {/* Modal Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-amber-500/20 to-orange-500/20 text-amber-400 border border-amber-500/30">
              <Zap className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                Native Python & Local FFmpeg Acceleration
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30">
                  Native CLI
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Executes directly via local Python and system FFmpeg binaries
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Comparison Banner */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800">
            <div className="text-slate-500 font-semibold uppercase text-[10px]">Browser Execution</div>
            <div className="text-slate-300 font-medium mt-1">Client-side WebAssembly sandbox</div>
          </div>

          <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30">
            <div className="text-emerald-400 font-semibold uppercase text-[10px]">Host System Execution</div>
            <div className="text-slate-200 font-medium mt-1">Direct OS process with hardware codecs</div>
          </div>
        </div>

        {/* Mode Selector */}
        <div className="flex items-center gap-2 text-xs font-mono">
          <button
            type="button"
            onClick={() => setCliMode('single')}
            className={`px-3 py-1.5 rounded-lg border font-semibold transition-all cursor-pointer ${
              cliMode === 'single'
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            Single Video (.mp4)
          </button>
          <button
            type="button"
            onClick={() => setCliMode('clips_zip')}
            className={`px-3 py-1.5 rounded-lg border font-semibold transition-all cursor-pointer ${
              cliMode === 'clips_zip'
                ? 'bg-sky-600 text-white border-sky-600'
                : 'bg-slate-950 text-slate-400 border-slate-800 hover:text-white'
            }`}
          >
            Clips ZIP Archive (.zip)
          </button>
        </div>

        {/* Execution Command */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5 text-sky-400" />
              <span>CLI Execution Command:</span>
            </label>
            <button
              onClick={handleCopyCommand}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-white text-xs transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Copied!' : 'Copy Command'}</span>
            </button>
          </div>
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-xs text-sky-300 overflow-x-auto whitespace-pre-wrap">
            <code>{customCommand}</code>
          </div>
        </div>

        {/* Instructions & File location */}
        <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-300">File location in this workspace:</div>
          <code className="text-sky-300 text-[11px] block bg-slate-900 px-2.5 py-1 rounded border border-slate-800 font-mono">
            c:\Users\zafee\Desktop\august\vtttool\vtt_slideshow_generator.py
          </code>
          <p className="text-[11px] text-slate-500">
            Automatically handles VTT parsing, script mapping, Pillow image downscaling to 1080p/720p, and executes native FFmpeg with ultrafast presets.
          </p>
        </div>

        {/* Close Button */}
        <div className="flex justify-end pt-2 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-sky-500 hover:bg-sky-400 text-white transition-colors"
          >
            Got it
          </button>
        </div>

      </div>
    </div>
  );
};
