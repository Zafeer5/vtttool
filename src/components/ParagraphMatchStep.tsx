'use client';

import React, { useState, useRef } from 'react';
import {
  FileText,
  Sparkles,
  Zap,
  CheckCircle2,
  Info,
  Play,
  Pause,
  Clock,
  ArrowRight,
  Trash2,
  RefreshCw,
  AlignRight,
} from 'lucide-react';
import { ScriptParagraph, SyncMatch, ParallelTranscripts } from '../lib/types';
import { ScriptSplitMode } from '../lib/script-parser';
import { formatSecondsToTimestamp } from '../lib/vtt-parser';

interface ParagraphMatchStepProps {
  rawScript: string;
  paragraphs: ScriptParagraph[];
  splitMode: ScriptSplitMode;
  matches: SyncMatch[];
  parallelTranscripts?: ParallelTranscripts | null;
  voiceoverUrl?: string | null;
  onScriptChange: (val: string, mode?: ScriptSplitMode) => void;
  onClearScript: () => void;
  onRunMatch: () => void;
  onProceedToImages: () => void;
}

export const ParagraphMatchStep: React.FC<ParagraphMatchStepProps> = ({
  rawScript,
  paragraphs,
  splitMode,
  matches,
  voiceoverUrl,
  onScriptChange,
  onClearScript,
  onRunMatch,
  onProceedToImages,
}) => {
  const [playingMatchIndex, setPlayingMatchIndex] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Play audio snippet corresponding to a specific paragraph match
  const handlePlaySnippet = (match: SyncMatch, index: number) => {
    if (!audioRef.current || !voiceoverUrl) return;

    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }

    if (playingMatchIndex === index) {
      audioRef.current.pause();
      setPlayingMatchIndex(null);
      return;
    }

    audioRef.current.currentTime = match.startTime;
    audioRef.current.play().catch(() => {});
    setPlayingMatchIndex(index);

    const durationMs = Math.max(200, (match.endTime - match.startTime) * 1000);
    stopTimeoutRef.current = setTimeout(() => {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingMatchIndex(null);
    }, durationMs);
  };

  // Stats calculation
  const totalParagraphs = paragraphs.length;
  const matchedCount = matches.filter((m) => m.confidenceScore && m.confidenceScore >= 70).length;
  const averageConfidence =
    matches.length > 0
      ? Math.round(matches.reduce((acc, m) => acc + (m.confidenceScore || 50), 0) / matches.length)
      : 0;

  return (
    <div className="space-y-6">
      {voiceoverUrl && <audio ref={audioRef} src={voiceoverUrl} preload="auto" className="hidden" />}

      {/* Main Grid: Left = Script Editor, Right = Alignment Results Side Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Script Editor (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-red-50 text-red-600 border border-red-200">
                <FileText className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-mono text-gray-900">
                  Script Input
                </h3>
                <p className="text-[11px] text-gray-500 font-sans">
                  Paste paragraphic script (1 paragraph = 1 slide)
                </p>
              </div>
            </div>

            {paragraphs.length > 0 && (
              <button
                type="button"
                onClick={onClearScript}
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                title="Clear script"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500 font-mono text-[11px] flex items-center gap-1">
              <AlignRight className="w-3 h-3 text-red-500" />
              <span>Split Mode:</span>
            </span>
            <div className="flex items-center rounded-lg bg-gray-100 border border-gray-200 p-0.5 font-mono text-[11px]">
              {(['paragraph', 'line', 'auto'] as ScriptSplitMode[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onScriptChange(rawScript, mode)}
                  className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                    splitMode === mode
                      ? 'bg-white text-gray-950 font-bold shadow-xs border border-gray-200'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Script Textarea */}
          <div className="relative">
            <textarea
              value={rawScript}
              onChange={(e) => onScriptChange(e.target.value)}
              placeholder="Paste your English script here...&#10;&#10;Each paragraph represents one slide frame and will automatically synchronize with your voiceover audio."
              className="w-full min-h-[320px] max-h-[480px] p-4 rounded-xl bg-gray-50/80 border border-gray-200 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all text-sm sm:text-base resize-y font-sans leading-relaxed"
            />
          </div>

          {/* Timing Alignment Best Practice Guidance */}
          <div className="p-3.5 rounded-xl bg-blue-50/80 border border-blue-200/70 text-blue-900 text-xs space-y-1.5 font-sans">
            <div className="flex items-center gap-1.5 font-bold font-mono text-[11px] text-blue-900">
              <Info className="w-3.5 h-3.5 text-blue-600 shrink-0" />
              <span>Timing &amp; Alignment Tip</span>
            </div>
            <p className="text-[11px] text-blue-700 leading-relaxed">
              Each paragraph represents 1 visual slide (~3 to 5 seconds of speech). Ensure your script covers your full voiceover length so the final slide isn&apos;t stretched across remaining unscripted audio.
            </p>
          </div>

          {/* Script Footer & Match Trigger Button */}
          <div className="flex items-center justify-between pt-2">
            <div className="text-xs font-mono text-gray-500">
              <span className="font-bold text-gray-900">{paragraphs.length}</span> paragraphs detected
            </div>

            <button
              type="button"
              onClick={onRunMatch}
              disabled={paragraphs.length === 0}
              className={`px-4 py-2.5 rounded-xl font-mono text-xs font-bold flex items-center gap-2 transition-all cursor-pointer shadow-sm ${
                paragraphs.length > 0
                  ? 'bg-red-600 hover:bg-red-700 text-white shadow-red-600/20 active:scale-98'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              <Zap className="w-4 h-4 fill-current text-amber-300" />
              <span>Match Paragraphs</span>
            </button>
          </div>
        </div>

        {/* Right Column: Multi-Script Match Results Side Panel (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-xl bg-purple-50 text-purple-600 border border-purple-200">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold font-mono text-gray-900 flex items-center gap-2">
                  Match Results Side Panel
                  {matches.length > 0 && (
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      {matches.length} Matched
                    </span>
                  )}
                </h3>
                <p className="text-[11px] text-gray-500 font-sans">
                  AI forced alignment &amp; phrase matching
                </p>
              </div>
            </div>
          </div>

          {/* Match Quality Banner */}
          {matches.length > 0 ? (
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {matchedCount} of {totalParagraphs} Paragraphs Aligned
                  </span>
                </div>
                <div className="h-4 w-px bg-gray-300" />
                <div className="text-gray-600">
                  Confidence: <span className="font-bold text-gray-900">{averageConfidence}%</span>
                </div>
              </div>

              <button
                type="button"
                onClick={onRunMatch}
                className="text-[11px] text-gray-600 hover:text-gray-900 flex items-center gap-1 cursor-pointer font-semibold"
              >
                <RefreshCw className="w-3 h-3" />
                <span>Re-align</span>
              </button>
            </div>
          ) : (
            <div className="p-8 text-center rounded-xl bg-gray-50 border border-dashed border-gray-200 space-y-2">
              <Sparkles className="w-8 h-8 text-gray-400 mx-auto" />
              <p className="text-xs font-mono font-semibold text-gray-700">
                Awaiting Script &amp; Match Trigger
              </p>
              <p className="text-xs text-gray-500 max-w-sm mx-auto font-sans">
                Paste your paragraphs on the left, then click &ldquo;Match Paragraphs&rdquo; to align each slide frame precisely with your voiceover audio timing.
              </p>
            </div>
          )}

          {/* Matched Paragraphs Scrollable Side List */}
          {matches.length > 0 && (
            <div className="space-y-3 max-h-[460px] overflow-y-auto pr-1">
              {matches.map((match, idx) => {
                const isPlayingThis = playingMatchIndex === idx;
                const score = match.confidenceScore || 85;
                const badgeColor =
                  score >= 90
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : score >= 75
                    ? 'bg-blue-50 text-blue-700 border-blue-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200';

                return (
                  <div
                    key={idx}
                    className="p-3.5 rounded-xl border border-gray-200 bg-white transition-all shadow-2xs space-y-2.5 hover:border-gray-300"
                  >
                    {/* Header Row: Paragraph #, Time Range, Confidence */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-gray-900 bg-gray-100 px-2 py-0.5 rounded-md">
                          Slide #{idx + 1}
                        </span>
                        <span className="text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-gray-400" />
                          <span>
                            {formatSecondsToTimestamp(match.startTime)} &rarr; {formatSecondsToTimestamp(match.endTime)}
                          </span>
                          <span className="text-[10px] text-gray-400">
                            ({match.duration.toFixed(2)}s)
                          </span>
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${badgeColor}`}>
                          {score}% Match
                        </span>
                      </div>
                    </div>

                    {/* Paragraph Text Snippet */}
                    <p className="text-xs sm:text-sm text-gray-800 line-clamp-2 leading-relaxed font-sans">
                      {match.paragraph.text}
                    </p>

                    {/* Matched Speech Phrase & Quick Audio Snippet Player */}
                    <div className="flex items-center justify-between pt-1 border-t border-gray-100 text-xs font-mono text-gray-500">
                      <div className="truncate max-w-[280px] sm:max-w-md text-[11px]">
                        <span className="text-gray-400">Matched trigger: </span>
                        <span className="font-semibold text-gray-700">
                          &ldquo;{match.matchedTextSnippet || match.searchPhrase || match.paragraph.text.slice(0, 30)}&rdquo;
                        </span>
                      </div>

                      {voiceoverUrl && (
                        <button
                          type="button"
                          onClick={() => handlePlaySnippet(match, idx)}
                          className={`px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer ${
                            isPlayingThis
                              ? 'bg-red-600 text-white font-bold'
                              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          }`}
                          title="Listen to this section in the voiceover"
                        >
                          {isPlayingThis ? (
                            <>
                              <Pause className="w-3 h-3 fill-current" />
                              <span>Pause</span>
                            </>
                          ) : (
                            <>
                              <Play className="w-3 h-3 fill-current" />
                              <span>Listen</span>
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Step 2 Proceed Button */}
          {matches.length > 0 && (
            <div className="pt-3 border-t border-gray-100 flex items-center justify-end">
              <button
                type="button"
                onClick={onProceedToImages}
                className="px-5 py-2.5 rounded-xl font-mono text-xs sm:text-sm font-bold bg-gray-900 hover:bg-black text-white flex items-center gap-2 transition-all cursor-pointer shadow-sm active:scale-98"
              >
                <span>Proceed to Step 3: Images &amp; Live Sync</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
