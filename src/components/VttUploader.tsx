'use client';

import React, { useState, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import {
  Subtitles,
  UploadCloud,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Eye,
  ClipboardPaste,
  FileText,
  Sparkles,
  RotateCcw,
  Check,
  Zap,
} from 'lucide-react';
import { VttCue } from '../lib/types';
import { parseVtt, formatSecondsToTimestamp, SAMPLE_ENGLISH_VTT } from '../lib/vtt-parser';

interface VttUploaderProps {
  cues: VttCue[];
  vttFileName: string;
  rawVttContent?: string;
  initialTab?: 'upload' | 'paste';
  onVttLoaded: (content: string, fileName: string, cues: VttCue[]) => void;
  onVttCleared: () => void;
}

export const VttUploader: React.FC<VttUploaderProps> = ({
  cues,
  vttFileName,
  rawVttContent = '',
  initialTab = 'upload',
  onVttLoaded,
  onVttCleared,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'paste'>(initialTab);
  const [pastedText, setPastedText] = useState<string>(rawVttContent || '');
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [justApplied, setJustApplied] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync activeTab when initialTab prop changes externally
  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Sync internal pastedText if rawVttContent changes externally
  useEffect(() => {
    if (rawVttContent && !pastedText) {
      setPastedText(rawVttContent);
    }
  }, [rawVttContent]);

  // Live parse status for the pasted text
  const liveParsedCues = React.useMemo(() => {
    if (!pastedText.trim()) return [];
    try {
      return parseVtt(pastedText);
    } catch {
      return [];
    }
  }, [pastedText]);

  const liveDuration = liveParsedCues.length > 0 ? liveParsedCues[liveParsedCues.length - 1].endTime : 0;

  // Process uploaded file
  const processFile = (file: File) => {
    setError(null);
    if (!file.name.toLowerCase().endsWith('.vtt') && !file.name.toLowerCase().endsWith('.srt') && !file.name.toLowerCase().endsWith('.txt')) {
      setError('Please upload a valid .vtt (WebVTT) or .srt subtitle file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content || !content.trim()) {
        setError('The uploaded file is empty.');
        return;
      }
      const parsed = parseVtt(content);
      if (parsed.length === 0) {
        setError('Could not find any valid timestamped subtitle cues in this file.');
        return;
      }
      setPastedText(content);
      onVttLoaded(content, file.name, parsed);
    };
    reader.onerror = () => {
      setError('Failed to read subtitle file.');
    };
    reader.readAsText(file);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  // Handle Apply Pasted VTT
  const handleApplyPastedVtt = () => {
    setError(null);
    if (!pastedText.trim()) {
      setError('Please paste your WebVTT subtitle text before applying.');
      return;
    }

    const parsed = parseVtt(pastedText);
    if (parsed.length === 0) {
      setError('Could not parse any valid subtitle cues. Ensure timestamps are in "00:00:00.000 --> 00:00:04.000" format.');
      return;
    }

    onVttLoaded(pastedText, 'pasted-subtitles.vtt', parsed);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2000);
  };

  const handleInsertSample = () => {
    setPastedText(SAMPLE_ENGLISH_VTT);
    const parsed = parseVtt(SAMPLE_ENGLISH_VTT);
    onVttLoaded(SAMPLE_ENGLISH_VTT, 'sample-english.vtt', parsed);
    setJustApplied(true);
    setTimeout(() => setJustApplied(false), 2000);
  };

  const handleClear = () => {
    setPastedText('');
    setError(null);
    onVttCleared();
  };

  const totalDuration = cues.length > 0 ? cues[cues.length - 1].endTime : 0;

  return (
    <div className="flex flex-col h-full rounded-xl bg-white border border-gray-200 p-4 shadow-sm space-y-3">
      {/* Card Header */}
      <div className="flex items-center justify-between pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-red-50 text-red-600 border border-red-200">
            <Subtitles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-xs sm:text-sm font-bold font-mono text-gray-900 flex items-center gap-1.5">
              VTT Subtitles
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                Speech Timings
              </span>
            </h2>
            <p className="text-[11px] text-gray-500 font-sans">
              Sentence speech timestamps for intelligent frame synchronization
            </p>
          </div>
        </div>

        {cues.length > 0 && (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-2xs">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            <span>{cues.length} Cues Ready</span>
          </span>
        )}
      </div>

      {/* Mode Selector Tabs (Upload vs Paste) */}
      <div className="flex items-center p-1 rounded-lg bg-gray-100 border border-gray-200 text-xs font-mono">
        <button
          type="button"
          onClick={() => setActiveTab('upload')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-3 rounded font-semibold transition-all cursor-pointer ${
            activeTab === 'upload'
              ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <UploadCloud className="w-3.5 h-3.5 text-red-600" />
          <span>Upload .VTT File</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('paste')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-1 px-3 rounded font-semibold transition-all cursor-pointer ${
            activeTab === 'paste'
              ? 'bg-white text-gray-900 shadow-2xs border border-gray-200'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <ClipboardPaste className="w-3.5 h-3.5 text-red-600" />
          <span>Paste VTT Text</span>
        </button>
      </div>

      {/* TAB 1: FILE UPLOAD DROPZONE */}
      {activeTab === 'upload' && (
        <div className="flex-1 flex flex-col justify-between space-y-3">
          {cues.length === 0 ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-all min-h-[200px] ${
                isDragging
                  ? 'border-red-500 bg-red-50/50 scale-[0.99]'
                  : 'border-gray-200 hover:border-red-400 bg-gray-50/50 hover:bg-red-50/20'
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".vtt,.srt,.txt"
                onChange={handleFileChange}
                className="hidden"
              />
              <div className="w-11 h-11 rounded-2xl bg-white border border-gray-200 shadow-sm flex items-center justify-center text-red-600 mb-2.5">
                <UploadCloud className="w-6 h-6" />
              </div>
              <p className="text-xs font-bold text-gray-900">
                Drag &amp; drop your <span className="text-red-600 font-mono">.vtt / .srt file</span> here
              </p>
              <p className="text-[11px] text-gray-500 mt-1">or click to browse from device</p>
            </div>
          ) : (
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-4 h-4 text-red-600 shrink-0" />
                  <span className="text-xs font-mono font-bold text-gray-900 truncate max-w-[220px]" title={vttFileName}>
                    {vttFileName}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onVttCleared}
                  className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                  title="Remove subtitle file"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2.5 rounded-lg bg-white border border-gray-200">
                  <span className="text-gray-500 text-[10px] block font-semibold uppercase">Total Cues</span>
                  <span className="font-bold text-gray-900 text-sm">{cues.length}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-white border border-gray-200">
                  <span className="text-gray-500 text-[10px] block font-semibold uppercase">Speech Duration</span>
                  <span className="font-bold text-emerald-700 text-sm">{formatSecondsToTimestamp(totalDuration)}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPreviewModal(true)}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-xs font-mono font-medium text-gray-800 shadow-2xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5 text-gray-500" />
                  <span>Inspect Cues ({cues.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="py-1.5 px-3 rounded-lg bg-gray-100 hover:bg-gray-200 text-xs font-mono font-medium text-gray-700 transition-colors cursor-pointer"
                >
                  Change File
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PASTE VTT TEXT */}
      {activeTab === 'paste' && (
        <div className="flex-1 flex flex-col space-y-2.5">
          {/* Textarea toolbar */}
          <div className="flex items-center justify-between text-xs">
            <span className="font-mono text-[11px] text-gray-500 flex items-center gap-1.5">
              <ClipboardPaste className="w-3.5 h-3.5 text-red-500" />
              <span>Paste Raw WebVTT / SRT:</span>
            </span>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleInsertSample}
                className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 flex items-center gap-1 transition-colors cursor-pointer"
                title="Paste a sample English WebVTT script"
              >
                <Sparkles className="w-3 h-3 text-red-500" />
                <span>Insert Sample VTT</span>
              </button>

              {pastedText && (
                <button
                  type="button"
                  onClick={handleClear}
                  className="p-1 text-gray-400 hover:text-red-600 rounded transition-colors cursor-pointer"
                  title="Clear text"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* VTT Textarea */}
          <div className="relative">
            <textarea
              rows={7}
              dir="auto"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="WEBVTT&#10;&#10;1&#10;00:00:00.000 --> 00:00:04.500&#10;یہاں اپنے سب ٹائٹلز پیسٹ کریں...&#10;&#10;2&#10;00:00:04.500 --> 00:00:09.000&#10;Next sentence timing here..."
              className="w-full rounded-lg border border-gray-300 p-2.5 font-mono text-xs leading-relaxed text-gray-900 bg-gray-50/70 focus:bg-white focus:border-red-500 focus:ring-1 focus:ring-red-500 outline-hidden transition-all resize-y"
            />
          </div>

          {/* Live cue parser inspector bar */}
          <div className="flex items-center justify-between text-xs font-mono bg-gray-50 border border-gray-200 rounded-lg p-2">
            <div className="flex items-center gap-2">
              <span className={`font-bold flex items-center gap-1 ${liveParsedCues.length > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                {liveParsedCues.length > 0 ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                    <span>{liveParsedCues.length} Cues Detected</span>
                  </>
                ) : (
                  <span>0 Cues Detected</span>
                )}
              </span>
              {liveDuration > 0 && (
                <span className="text-gray-500 text-[11px]">
                  &bull; Total: {formatSecondsToTimestamp(liveDuration)}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={handleApplyPastedVtt}
              disabled={liveParsedCues.length === 0}
              className={`px-3 py-1 rounded text-xs font-bold font-mono flex items-center gap-1.5 transition-all cursor-pointer ${
                liveParsedCues.length > 0
                  ? justApplied
                    ? 'bg-emerald-600 text-white'
                    : 'bg-red-600 hover:bg-red-700 text-white shadow-2xs hover:scale-[1.02] active:scale-[0.98]'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {justApplied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>VTT Applied!</span>
                </>
              ) : (
                <>
                  <Zap className="w-3.5 h-3.5 fill-current" />
                  <span>Apply Pasted VTT</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Error notification */}
      {error && (
        <div className="p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-600 flex items-center gap-1.5 font-mono">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Inspect Raw Cues Modal */}
      {showPreviewModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-xl border border-gray-200 shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50">
              <h3 className="font-mono text-xs font-bold text-gray-900 flex items-center gap-2">
                <Subtitles className="w-4 h-4 text-red-600" />
                <span>Raw WebVTT Cues ({cues.length})</span>
              </h3>
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="text-gray-400 hover:text-gray-700 text-base font-mono cursor-pointer"
              >
                &times;
              </button>
            </div>
            <div className="p-4 overflow-y-auto space-y-2 flex-1 font-mono text-xs">
              {cues.map((c, idx) => (
                <div key={c.id || idx} className="p-2.5 rounded-lg bg-gray-50 border border-gray-200 space-y-1">
                  <div className="text-[10px] text-red-600 font-bold flex items-center justify-between">
                    <span>Cue #{idx + 1}</span>
                    <span>{formatSecondsToTimestamp(c.startTime)} &rarr; {formatSecondsToTimestamp(c.endTime)} ({c.duration.toFixed(2)}s)</span>
                  </div>
                  <div className="text-gray-800 text-xs font-sans">
                    {c.cleanText}
                  </div>
                </div>
              ))}
            </div>
            <div className="px-4 py-2.5 border-t border-gray-200 bg-gray-50 flex justify-end">
              <button
                type="button"
                onClick={() => setShowPreviewModal(false)}
                className="px-4 py-1.5 text-xs font-mono font-bold rounded-lg bg-white border border-gray-300 hover:bg-gray-100 text-gray-800 cursor-pointer shadow-2xs"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
