import React, { ChangeEvent, useState } from 'react';
import { FileText, CheckCircle2, Trash2, Sparkles, Zap, AlignRight } from 'lucide-react';
import { ScriptParagraph } from '../lib/types';
import { ScriptSplitMode } from '../lib/script-parser';

interface ScriptEditorProps {
  rawScript: string;
  paragraphs: ScriptParagraph[];
  splitMode?: ScriptSplitMode;
  onScriptChange: (val: string, mode?: ScriptSplitMode) => void;
  onClear: () => void;
}

export const ScriptEditor: React.FC<ScriptEditorProps> = ({
  rawScript,
  paragraphs,
  splitMode = 'paragraph',
  onScriptChange,
  onClear,
}) => {
  const [currentMode, setCurrentMode] = useState<ScriptSplitMode>(splitMode);

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    onScriptChange(e.target.value, currentMode);
  };

  const handleModeSelect = (mode: ScriptSplitMode) => {
    setCurrentMode(mode);
    onScriptChange(rawScript, mode);
  };

  const totalWords = paragraphs.reduce((acc, p) => acc + p.words.length, 0);

  return (
    <div className="flex flex-col h-full rounded-xl bg-white border border-gray-200 p-4 shadow-sm">
      {/* Card Header (Next.js Dev Overlay Frame Header) */}
      <div className="flex items-center justify-between pb-3 mb-2.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
            <FileText className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs sm:text-sm font-bold font-mono text-gray-900 flex items-center gap-1.5">
              ScriptEditor.tsx
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-200">
                English Script
              </span>
            </h2>
            <p className="text-[11px] text-gray-500 font-sans">1 paragraph = 1 slide frame</p>
          </div>
        </div>

        {paragraphs.length > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <CheckCircle2 className="w-3 h-3" />
              {paragraphs.length} Slide{paragraphs.length === 1 ? '' : 's'}
            </span>
            <button
              onClick={onClear}
              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors cursor-pointer"
              title="Clear script"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Split Mode Selector */}
      <div className="flex items-center justify-between gap-2 mb-2 text-xs">
        <span className="text-gray-500 font-mono text-[11px] flex items-center gap-1">
          <AlignRight className="w-3 h-3 text-red-500" />
          <span>Script Split Mode:</span>
        </span>
        <div className="flex items-center rounded-lg bg-gray-100 border border-gray-200 p-0.5">
          {[
            { id: 'paragraph', label: 'Paragraphs' },
            { id: 'line', label: 'Lines' },
            { id: 'auto', label: 'Auto' },
          ].map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => handleModeSelect(m.id as ScriptSplitMode)}
              className={`px-2 py-0.5 rounded text-[11px] font-mono font-medium transition-all cursor-pointer ${
                currentMode === m.id
                  ? 'bg-white text-gray-900 shadow-sm border border-gray-200 font-bold'
                  : 'text-gray-500 hover:text-gray-900'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Textarea: English Ready */}
      <div className="flex-1 flex flex-col relative min-h-[190px]">
        <textarea
          value={rawScript}
          onChange={handleTextChange}
          placeholder="Paste your English script here...&#10;&#10;Each paragraph will become one slide frame and automatically sync second-by-second with your voiceover audio."
          className="w-full flex-1 p-3 rounded-lg bg-gray-50/80 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-red-500 focus:border-red-500 transition-all text-sm sm:text-base resize-none font-sans leading-relaxed"
        />

        {/* Status bar */}
        <div className="flex items-center justify-between px-3 py-1.5 mt-2 rounded-md bg-gray-50 border border-gray-200 text-xs font-mono text-gray-600">
          <div className="flex items-center gap-2">
            <span>{totalWords} words</span>
            <span>&bull;</span>
            <span className="text-red-600 font-semibold">
              {paragraphs.length} paragraph slide{paragraphs.length === 1 ? '' : 's'}
            </span>
          </div>
          <span className="text-[11px] text-gray-500">
            English Script Ready
          </span>
        </div>
      </div>

      {/* Detected Paragraphs Breakdown */}
      {paragraphs.length > 0 && (
        <div className="mt-3 pt-2 border-t border-gray-100">
          <div className="text-[11px] font-mono font-semibold text-gray-500 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
            <Zap className="w-3 h-3 text-red-500" />
            <span>Detected Paragraph Slides ({paragraphs.length})</span>
          </div>
          <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
            {paragraphs.map((p, idx) => (
              <div
                key={p.id}
                className="p-2 rounded-lg bg-gray-50 border border-gray-200 text-xs space-y-1 hover:border-gray-300 transition-colors"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span className="px-1.5 py-0.5 rounded bg-red-100/70 text-red-700 text-[10px] font-mono font-bold">
                    Slide #{idx + 1}
                  </span>
                  <span className="text-[10px] font-mono text-gray-500">
                    {p.words.length} words
                  </span>
                </div>
                <p className="text-gray-800 text-xs leading-relaxed font-sans">
                  {p.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
