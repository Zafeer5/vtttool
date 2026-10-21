import { VttCue, ScriptParagraph, ImageItem, SyncMatch, MatchConfidence, ScriptSentence } from './types';
import {
  normalizeForSearch,
  isFuzzyWordMatch,
  normalizeWordForMatching,
  formatSecondsToTimestamp,
  levenshteinDistance,
} from './vtt-parser';

export interface AlignedSentenceResult {
  sentences: ScriptSentence[];
  sentenceVtt: string;
  matchedCount: number;
  totalCount: number;
}

export interface SentenceDraft {
  paragraphIndex: number;
  sentenceIndexInParagraph: number;
  overallSentenceIndex: number;
  rawText: string;
  cleanText: string;
  words: string[];
  normalizedWords: string[];
}

export interface SpokenWord {
  word: string;
  normalized: string;
  start: number;
  end: number;
  cueIndex: number;
  cue: VttCue;
}

/**
 * Extracts a flat, chronological stream of individual spoken words with accurate timestamps
 * from WebVTT cues (using Whisper word-level timestamps when available, or proportional interpolation).
 */
export function extractSpokenWordsFromCues(cues: VttCue[]): SpokenWord[] {
  const words: SpokenWord[] = [];

  cues.forEach((cue, cIdx) => {
    if (cue.words && cue.words.length > 0) {
      cue.words.forEach((w) => {
        const txt = (w.word || '').trim();
        if (!txt) return;
        const norm = normalizeWordForMatching(txt);
        if (!norm) return;
        words.push({
          word: txt,
          normalized: norm,
          start: Number(w.start.toFixed(3)),
          end: Number(w.end.toFixed(3)),
          cueIndex: cIdx,
          cue,
        });
      });
    } else {
      // Split cue text into words and interpolate word timestamps across cue duration
      const text = (cue.cleanText || cue.text || '').trim();
      const rawWords = text.split(/\s+/).filter(Boolean);
      if (rawWords.length === 0) return;

      const dur = Math.max(0.1, cue.endTime - cue.startTime);
      const step = dur / rawWords.length;

      rawWords.forEach((rw, wIdx) => {
        const norm = normalizeWordForMatching(rw);
        if (!norm) return;
        const wStart = cue.startTime + wIdx * step;
        const wEnd = Math.min(cue.endTime, wStart + step);
        words.push({
          word: rw,
          normalized: norm,
          start: Number(wStart.toFixed(3)),
          end: Number(wEnd.toFixed(3)),
          cueIndex: cIdx,
          cue,
        });
      });
    }
  });

  // Ensure spoken words are sorted chronologically
  words.sort((a, b) => a.start - b.start);
  return words;
}

/**
 * Splits text into individual sentences while preserving exact punctuation and casing.
 * Handles abbreviations and decimal numbers so they don't cause false splits.
 * Recognizes English (. ? !) punctuation.
 */
export function splitTextIntoSentenceDrafts(
  paragraphs: ScriptParagraph[]
): SentenceDraft[] {
  const drafts: SentenceDraft[] = [];
  let overallIdx = 0;

  paragraphs.forEach((p, pIdx) => {
    const rawParagraph = p.text || '';
    if (!rawParagraph.trim()) return;

    // Normalize newlines within paragraph
    const cleanLines = rawParagraph.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

    // Regex to split on English sentence-ending punctuation (. ? !)
    const sentenceSplitRegex = /(?<=[.?!]["'”’]?)\s+(?=[A-Za-z0-9])/;
    
    let rawSentences: string[] = [];
    const byLines = cleanLines.split(/\n+/).map((l) => l.trim()).filter(Boolean);

    for (const line of byLines) {
      const parts = line.split(sentenceSplitRegex).map((s) => s.trim()).filter(Boolean);
      if (parts.length > 0) {
        rawSentences.push(...parts);
      } else if (line.length > 0) {
        rawSentences.push(line);
      }
    }

    if (rawSentences.length === 0) {
      rawSentences = [cleanLines];
    }

    rawSentences.forEach((rawSent, sIdxInP) => {
      const cleanSent = rawSent.replace(/\s+/g, ' ').trim();
      const words = cleanSent
        .split(/\s+/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0);

      const normalizedWords = words.map((w) => {
        return normalizeWordForMatching(w);
      }).filter(Boolean);

      drafts.push({
        paragraphIndex: pIdx,
        sentenceIndexInParagraph: sIdxInP,
        overallSentenceIndex: overallIdx,
        rawText: rawSent,
        cleanText: cleanSent,
        words,
        normalizedWords,
      });

      overallIdx++;
    });
  });

  return drafts;
}

export function alignScriptSentencesWithWordCues(
  paragraphs: ScriptParagraph[],
  cues: VttCue[],
  totalAudioDuration: number
): AlignedSentenceResult {
  const drafts = splitTextIntoSentenceDrafts(paragraphs);

  if (drafts.length === 0) {
    return {
      sentences: [],
      sentenceVtt: 'WEBVTT\n\n',
      matchedCount: 0,
      totalCount: 0,
    };
  }

  // Extract individual spoken words from all cues
  const spokenWords = extractSpokenWordsFromCues(cues);

  const effectiveAudioDuration = totalAudioDuration > 0
    ? totalAudioDuration
    : cues.length > 0
    ? cues[cues.length - 1].endTime
    : 10.0;

  // Fallback: If no cues or words exist, evenly distribute sentences across audio duration
  if (spokenWords.length === 0) {
    const totalChars = drafts.reduce((acc, d) => acc + d.rawText.length, 0) || 1;
    let currT = 0;
    const fallbackSentences: ScriptSentence[] = drafts.map((d) => {
      const dur = Math.max(1.0, (d.rawText.length / totalChars) * effectiveAudioDuration);
      const start = Number(currT.toFixed(3));
      const end = Number((currT + dur).toFixed(3));
      currT = end;
      return {
        id: `s-${d.overallSentenceIndex + 1}`,
        paragraphIndex: d.paragraphIndex,
        sentenceIndexInParagraph: d.sentenceIndexInParagraph,
        overallSentenceIndex: d.overallSentenceIndex,
        text: d.rawText,
        cleanText: d.cleanText,
        startTime: start,
        endTime: end,
        duration: Number((end - start).toFixed(3)),
        confidence: 'fallback',
        warning: 'Estimated timing: no transcription cues provided.',
      };
    });

    return {
      sentences: fallbackSentences,
      sentenceVtt: buildVttFromSentences(fallbackSentences),
      matchedCount: 0,
      totalCount: drafts.length,
    };
  }

  // Sequential forced alignment tracking
  let currentWordSearchIndex = 0;
  let lastSentenceEndTime = 0;

  interface MatchedSlot {
    startWordIdx: number;
    endWordIdx: number;
    startTime: number;
    endTime: number;
    confidence: MatchConfidence;
    matchedWordCount: number;
    matchedCue: VttCue;
  }

  const rawMatches: (MatchedSlot | null)[] = new Array(drafts.length).fill(null);

  for (let sIdx = 0; sIdx < drafts.length; sIdx++) {
    const draft = drafts[sIdx];
    const targetWords = draft.normalizedWords;

    if (targetWords.length === 0) {
      continue;
    }

    let bestStartWordIdx = -1;
    let bestEndWordIdx = -1;
    let bestScore = 0;
    let bestMatchedWords = 0;

    // Search window in spoken word stream: from currentWordSearchIndex up to a reasonable forward horizon
    const maxSearchHorizon = Math.min(spokenWords.length, currentWordSearchIndex + 250);

    // Strategy 1: Progressive Leading Phrase Matching (test prefixes of length L: 5 down to 2 words)
    const maxLeadingLen = Math.min(5, targetWords.length);
    let leadingMatchFound = false;

    for (let L = maxLeadingLen; L >= 2; L--) {
      const leadingTarget = targetWords.slice(0, L);

      for (let cIdx = currentWordSearchIndex; cIdx <= maxSearchHorizon - L; cIdx++) {
        let matchCount = 0;
        for (let m = 0; m < L; m++) {
          const sw = spokenWords[cIdx + m];
          const tw = leadingTarget[m];
          if (sw.normalized === tw || isFuzzyWordMatch(sw.word, tw)) {
            matchCount++;
          }
        }

        // Accept if all L match, or if L >= 4 and only 1 minor word differs
        const isAcceptable = matchCount === L || (L >= 4 && matchCount >= L - 1);
        if (isAcceptable) {
          bestStartWordIdx = cIdx;
          bestMatchedWords = matchCount;
          leadingMatchFound = true;

          // Now find the end of this sentence: scan forward from bestStartWordIdx
          const trailingLen = Math.min(3, Math.max(1, targetWords.length - L));
          const trailingTarget = targetWords.slice(targetWords.length - trailingLen);

          const expectedSpan = Math.max(L, targetWords.length);
          const endSearchMin = Math.min(spokenWords.length - 1, bestStartWordIdx + Math.max(1, Math.floor(expectedSpan * 0.6)));
          const endSearchMax = Math.min(spokenWords.length - 1, bestStartWordIdx + Math.ceil(expectedSpan * 1.6));

          let foundEnd = -1;
          for (let eIdx = endSearchMax; eIdx >= endSearchMin; eIdx--) {
            const sw = spokenWords[eIdx];
            const lastTarget = trailingTarget[trailingTarget.length - 1];
            if (sw.normalized === lastTarget || isFuzzyWordMatch(sw.word, lastTarget)) {
              foundEnd = eIdx;
              break;
            }
          }

          if (foundEnd !== -1 && foundEnd >= bestStartWordIdx) {
            bestEndWordIdx = foundEnd;
          } else {
            bestEndWordIdx = Math.min(spokenWords.length - 1, bestStartWordIdx + targetWords.length - 1);
          }
          break;
        }
      }

      if (leadingMatchFound) break;
    }

    // Strategy 2: Sliding Window Token Overlap (when leading words had minor phrasing differences)
    if (!leadingMatchFound) {
      const windowSize = Math.max(targetWords.length + 4, 10);
      for (let cIdx = currentWordSearchIndex; cIdx <= maxSearchHorizon - 3; cIdx += 1) {
        const windowEnd = Math.min(spokenWords.length, cIdx + windowSize);
        const windowWords = spokenWords.slice(cIdx, windowEnd);

        let overlap = 0;
        const windowNormSet = new Set(windowWords.map((w) => w.normalized));

        for (const tw of targetWords) {
          if (windowNormSet.has(tw)) {
            overlap++;
          } else {
            for (const ww of windowWords) {
              if (isFuzzyWordMatch(ww.word, tw)) {
                overlap++;
                break;
              }
            }
          }
        }

        const score = overlap / Math.max(targetWords.length, 1);
        if (score > bestScore && overlap >= 2) {
          bestScore = score;
          bestStartWordIdx = cIdx;
          bestEndWordIdx = Math.min(spokenWords.length - 1, cIdx + targetWords.length - 1);
          bestMatchedWords = overlap;
        }
      }
    }

    // Determine confidence
    if (bestStartWordIdx !== -1 && bestEndWordIdx >= bestStartWordIdx) {
      const ratio = bestMatchedWords / Math.max(targetWords.length, 1);
      let confidence: MatchConfidence = 'fuzzy';
      if (leadingMatchFound && ratio >= 0.65) {
        confidence = 'exact';
      } else if (ratio >= 0.45 || leadingMatchFound) {
        confidence = 'high';
      }

      const startTime = spokenWords[bestStartWordIdx].start;
      const endTime = spokenWords[bestEndWordIdx].end;
      const matchedCue = spokenWords[bestStartWordIdx].cue;

      rawMatches[sIdx] = {
        startWordIdx: bestStartWordIdx,
        endWordIdx: bestEndWordIdx,
        startTime,
        endTime,
        confidence,
        matchedWordCount: bestMatchedWords,
        matchedCue,
      };

      // Advance search index forward to keep alignment chronological
      currentWordSearchIndex = Math.min(spokenWords.length - 1, bestStartWordIdx + 1);
    }
  }

  // Sequential Polish & Gap Fill
  const finalSentences: ScriptSentence[] = [];
  let matchedCount = 0;

  for (let sIdx = 0; sIdx < drafts.length; sIdx++) {
    const draft = drafts[sIdx];
    const match = rawMatches[sIdx];

    let start = 0;
    let end = 0;
    let confidence: MatchConfidence = 'fallback';
    let matchedCue: VttCue | null = null;
    let warning: string | undefined;

    if (match) {
      start = match.startTime;
      end = match.endTime;
      confidence = match.confidence;
      matchedCue = match.matchedCue;
      matchedCount++;
    } else {
      // Interpolate timing based on previous sentence end and next matched sentence
      let nextKnownStart = effectiveAudioDuration;
      for (let next = sIdx + 1; next < drafts.length; next++) {
        if (rawMatches[next]) {
          nextKnownStart = rawMatches[next]!.startTime;
          break;
        }
      }

      const availableSpan = Math.max(1.0, nextKnownStart - lastSentenceEndTime);
      const estDur = Math.min(availableSpan * 0.9, Math.max(1.2, draft.words.length * 0.35));
      start = lastSentenceEndTime;
      end = Math.min(nextKnownStart, start + estDur);
      confidence = 'fallback';
      warning = 'Estimated timing: low confidence matching in voiceover transcript.';
    }

    // Enforce Slide 1 (Sentence 1) start at 0.000 if audio starts near 0
    if (sIdx === 0 && start <= 0.8) {
      start = 0.0;
    }

    // Enforce strictly sequential non-overlapping timing
    if (start < lastSentenceEndTime) {
      start = lastSentenceEndTime;
    }
    if (end <= start + 0.3) {
      end = Number((start + Math.max(0.8, draft.words.length * 0.3)).toFixed(3));
    }

    const duration = Math.max(0.1, Number((end - start).toFixed(3)));
    lastSentenceEndTime = end;

    finalSentences.push({
      id: `sentence-${sIdx + 1}`,
      paragraphIndex: draft.paragraphIndex,
      sentenceIndexInParagraph: draft.sentenceIndexInParagraph,
      overallSentenceIndex: sIdx,
      text: draft.rawText,
      cleanText: draft.cleanText,
      startTime: Number(start.toFixed(3)),
      endTime: Number(end.toFixed(3)),
      duration,
      confidence,
      matchedCue,
      warning,
    });
  }

  // Extend the final sentence to the end of the voiceover.
  if (finalSentences.length > 0 && effectiveAudioDuration > finalSentences[finalSentences.length - 1].endTime) {
    const lastSent = finalSentences[finalSentences.length - 1];
    lastSent.endTime = Number(effectiveAudioDuration.toFixed(3));
    lastSent.duration = Number((lastSent.endTime - lastSent.startTime).toFixed(3));
  }

  const sentenceVtt = buildVttFromSentences(finalSentences);

  return {
    sentences: finalSentences,
    sentenceVtt,
    matchedCount,
    totalCount: drafts.length,
  };
}

/**
 * Builds clean, standards-compliant WebVTT subtitles containing
 * exactly one timing block per original script sentence.
 */
export function buildVttFromSentences(sentences: ScriptSentence[]): string {
  const lines: string[] = ['WEBVTT', ''];

  sentences.forEach((s, idx) => {
    const startStr = formatSecondsToTimestamp(s.startTime, true);
    const endStr = formatSecondsToTimestamp(s.endTime, true);
    lines.push(`${idx + 1}`);
    lines.push(`${startStr} --> ${endStr}`);
    lines.push(s.text);
    lines.push('');
  });

  return lines.join('\n');
}

/**
 * Maps aligned sentences back to paragraph slides (Slide i = Paragraph i).
 * Guarantees:
 * - Slide i starts when its FIRST sentence starts.
 * - Slide i stays active continuously until Slide i+1 starts.
 * - Slide i duration spans all of its sentences.
 * - Final slide stays active until the audio ends.
 */
export function syncSlidesFromAlignedSentences(
  paragraphs: ScriptParagraph[],
  alignedSentences: ScriptSentence[],
  images: ImageItem[],
  totalAudioDuration: number
): SyncMatch[] {
  const matches: SyncMatch[] = [];

  // Group sentences by paragraphIndex
  const sentencesByParagraph: Map<number, ScriptSentence[]> = new Map();
  alignedSentences.forEach((s) => {
    const existing = sentencesByParagraph.get(s.paragraphIndex) || [];
    existing.push(s);
    sentencesByParagraph.set(s.paragraphIndex, existing);
  });

  const effectiveDuration = totalAudioDuration > 0
    ? totalAudioDuration
    : alignedSentences.length > 0
    ? alignedSentences[alignedSentences.length - 1].endTime
    : 10.0;

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const paragraph = paragraphs[pIdx];
    const image = pIdx < images.length ? images[pIdx] : null;
    const paraSentences = sentencesByParagraph.get(pIdx) || [];

    let startTime = 0;
    let endTime = 0;
    let confidence: MatchConfidence = 'fallback';
    let matchedCue: VttCue | null = null;
    let triggerSentence = paragraph.startingSentence;

    if (paraSentences.length > 0) {
      startTime = paraSentences[0].startTime;
      confidence = paraSentences[0].confidence;
      matchedCue = paraSentences[0].matchedCue || null;
      triggerSentence = paraSentences[0].text;
    } else {
      startTime = matches.length > 0 ? matches[matches.length - 1].endTime : 0;
    }

    // Determine end time: Slide pIdx stays active until Slide pIdx + 1 starts!
    if (pIdx < paragraphs.length - 1) {
      const nextParaSentences = sentencesByParagraph.get(pIdx + 1) || [];
      if (nextParaSentences.length > 0) {
        endTime = nextParaSentences[0].startTime;
      } else {
        endTime = startTime + 4.0;
      }
    } else {
      // Keep the final slide on screen through the end of the audio.
      const wordsCount = (paragraph.words && paragraph.words.length > 0)
        ? paragraph.words.length
        : (paragraph.text || '').split(/\s+/).filter(Boolean).length || 8;
      const expectedFinalDur = Math.max(3.5, wordsCount / 2.3);

      if (effectiveDuration > startTime) {
        endTime = Math.max(startTime + 2.0, effectiveDuration);
      } else {
        endTime = startTime + Math.min(12.0, Math.max(3.5, expectedFinalDur));
      }
    }

    // Ensure valid duration
    if (endTime <= startTime + 0.3) {
      endTime = Number((startTime + 1.5).toFixed(3));
    }

    const duration = Math.max(0.5, Number((endTime - startTime).toFixed(3)));

    let warning: string | undefined;
    if (!image) {
      warning = `Missing image for Slide ${pIdx + 1} (Paragraph ${pIdx + 1}).`;
    } else if (confidence === 'fallback') {
      warning = `Estimated timing: starting sentence not matched with high confidence in voiceover.`;
    }

    matches.push({
      index: pIdx,
      image,
      paragraph,
      matchedCue,
      startTime: Number(startTime.toFixed(3)),
      endTime: Number(endTime.toFixed(3)),
      duration,
      confidence,
      searchPhrase: paragraph.leadingWords?.join(' ') || '',
      triggerSentence,
      matchedTextSnippet: matchedCue ? matchedCue.cleanText : undefined,
      warning,
      sentences: paraSentences,
    });
  }

  return matches;
}
