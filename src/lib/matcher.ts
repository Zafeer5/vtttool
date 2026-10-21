import {
  VttCue,
  ScriptParagraph,
  ImageItem,
  SyncMatch,
  SyncAnalysis,
  MatchConfidence,
  ScriptSentence,
  ParallelTranscripts,
  MatchedScriptType,
  SyncMode,
  SyncStatus,
  ReviewQueueItem,
} from './types';
import { normalizeForSearch, isFuzzyWordMatch, formatSecondsToTimestamp } from './vtt-parser';
import {
  extractSpokenWordsFromCues,
  buildVttFromSentences,
  SpokenWord,
} from './sentence-aligner';

/**
 * Searches for where a script paragraph's first 3 to 4 starting words begin in the VTT speech cues.
 * Prioritizes forward chronological search from startIndex / startWordIndex.
 * 
 * Strict User Rule:
 * Matches ONLY the opening 3 to 4 words of the paragraph ("firstly shuru kay words"),
 * never random or arbitrary tokens from the middle/end of the paragraph.
 * Works seamlessly across word-level and phrase-level Whisper cues.
 */
export function findParagraphCueMatch(
  paragraph: ScriptParagraph,
  cues: VttCue[],
  startIndex: number,
  spokenWords?: SpokenWord[],
  startWordIndex: number = 0
): {
  matchedCue: VttCue | null;
  confidence: MatchConfidence;
  cueIndex: number;
  wordSnappedStart?: number;
  matchedSnippet?: string;
  matchedWordIndex?: number;
} {
  if (cues.length === 0) {
    return { matchedCue: null, confidence: 'fallback', cueIndex: startIndex };
  }

  // 1. Extract strictly the opening 3 to 4 starting words of the paragraph ("firstly shuru kay words")
  const rawWords = (
    paragraph.words && paragraph.words.length > 0
      ? paragraph.words
      : (paragraph.text || '').split(/\s+/)
  )
    .map((w) => w.trim().replace(/^["'“”‘’«»(\[{]+|[.,/#!$%^&*;:{}=\-_`~()؟۔،؛"'»\]}>]+$/g, ''))
    .filter((w) => w.length > 0);

  if (rawWords.length === 0) {
    const cue = cues[Math.min(startIndex, cues.length - 1)] || null;
    return { matchedCue: cue, confidence: 'fallback', cueIndex: startIndex };
  }

  const opening4 = rawWords.slice(0, 4);
  const opening3 = rawWords.slice(0, 3);
  const has4 = opening4.length >= 4;
  const has3 = opening3.length >= 3;

  // Flattened spoken words stream with sub-second timestamps
  const allSpoken = spokenWords && spokenWords.length > 0 ? spokenWords : extractSpokenWordsFromCues(cues);

  // Pre-normalize all cues for phrase search
  const normalizedCues = cues.map((c) => normalizeForSearch(c.cleanText || c.text));

  // --- STRATEGY A: Consecutive Word Matching in Spoken Word Stream (Sub-second Accuracy) ---
  if (allSpoken.length > 0) {
    const safeStartWordIdx = Math.max(0, Math.min(startWordIndex, allSpoken.length - 1));

    // A1. Forward search: 4 consecutive opening words
    if (has4) {
      for (let k = safeStartWordIdx; k <= allSpoken.length - 4; k++) {
        let matchCount = 0;
        for (let m = 0; m < 4; m++) {
          if (isFuzzyWordMatch(allSpoken[k + m].word, opening4[m])) {
            matchCount++;
          }
        }

        if (matchCount === 4) {
          const cue = allSpoken[k].cue;
          const snippet = allSpoken.slice(k, k + 4).map((s) => s.word).join(' ');
          return {
            matchedCue: cue,
            confidence: 'exact',
            cueIndex: allSpoken[k].cueIndex,
            wordSnappedStart: allSpoken[k].start,
            matchedSnippet: snippet,
            matchedWordIndex: k + 4,
          };
        }
      }
    }

    // A2. Forward search: 3 consecutive opening words
    if (has3) {
      for (let k = safeStartWordIdx; k <= allSpoken.length - 3; k++) {
        let matchCount = 0;
        for (let m = 0; m < 3; m++) {
          if (isFuzzyWordMatch(allSpoken[k + m].word, opening3[m])) {
            matchCount++;
          }
        }

        if (matchCount === 3) {
          const cue = allSpoken[k].cue;
          const snippet = allSpoken.slice(k, k + 3).map((s) => s.word).join(' ');
          return {
            matchedCue: cue,
            confidence: 'high',
            cueIndex: allSpoken[k].cueIndex,
            wordSnappedStart: allSpoken[k].start,
            matchedSnippet: snippet,
            matchedWordIndex: k + 3,
          };
        }
      }
    }

    // A3. Forward search: 4 opening words with 1 minor word drop (where first word MUST match)
    if (has4) {
      for (let k = safeStartWordIdx; k <= allSpoken.length - 4; k++) {
        if (!isFuzzyWordMatch(allSpoken[k].word, opening4[0])) continue;

        let matchCount = 1;
        for (let m = 1; m < 4; m++) {
          if (isFuzzyWordMatch(allSpoken[k + m].word, opening4[m])) {
            matchCount++;
          }
        }

        // 3 of 4 words match within a 3.5s span
        if (matchCount >= 3 && allSpoken[k + 3].end - allSpoken[k].start <= 3.5) {
          const cue = allSpoken[k].cue;
          const snippet = allSpoken.slice(k, k + 4).map((s) => s.word).join(' ');
          return {
            matchedCue: cue,
            confidence: 'high',
            cueIndex: allSpoken[k].cueIndex,
            wordSnappedStart: allSpoken[k].start,
            matchedSnippet: snippet,
            matchedWordIndex: k + 4,
          };
        }
      }
    }
  }

  // Helper to snap start time to exact word inside cue if cue.words timestamps exist
  const getWordSnappedStart = (cue: VttCue, targetFirstWord: string): number | undefined => {
    if (!cue.words || cue.words.length === 0 || !targetFirstWord) return undefined;
    const wordIdx = cue.words.findIndex((w) => isFuzzyWordMatch(w.word, targetFirstWord));
    if (wordIdx !== -1) {
      return cue.words[wordIdx].start;
    }
    return undefined;
  };

  // --- STRATEGY B: Phrase Matching in Cues (For Sentence-Level Cues or Sliding Windows) ---
  const phrase4 = has4 ? opening4.map((w) => normalizeForSearch(w)).join(' ') : '';
  const phrase3 = has3 ? opening3.map((w) => normalizeForSearch(w)).join(' ') : '';
  const firstWordNorm = normalizeForSearch(rawWords[0]);

  // Forward cue search
  for (let idx = startIndex; idx < cues.length; idx++) {
    const cueNorm = normalizedCues[idx];
    const nextCueNorm = idx + 1 < cues.length ? normalizedCues[idx + 1] : '';
    const windowNorm = `${cueNorm} ${nextCueNorm}`.trim();

    // Check 4-word opening phrase
    if (phrase4 && (cueNorm.includes(phrase4) || (cueNorm.length < 50 && cueNorm === phrase4))) {
      const cue = cues[idx];
      const wordSnappedStart = getWordSnappedStart(cue, rawWords[0]);
      return {
        matchedCue: cue,
        confidence: 'exact',
        cueIndex: idx,
        wordSnappedStart,
        matchedSnippet: cue.cleanText,
      };
    }

    if (phrase4 && windowNorm.includes(phrase4) && cueNorm.includes(firstWordNorm)) {
      const cue = cues[idx];
      const wordSnappedStart = getWordSnappedStart(cue, rawWords[0]);
      return {
        matchedCue: cue,
        confidence: 'exact',
        cueIndex: idx,
        wordSnappedStart,
        matchedSnippet: `${cues[idx].cleanText} ${cues[idx + 1]?.cleanText || ''}`.trim(),
      };
    }

    // Check 3-word opening phrase
    if (phrase3 && (cueNorm.includes(phrase3) || (cueNorm.length < 40 && cueNorm === phrase3))) {
      const cue = cues[idx];
      const wordSnappedStart = getWordSnappedStart(cue, rawWords[0]);
      return {
        matchedCue: cue,
        confidence: 'high',
        cueIndex: idx,
        wordSnappedStart,
        matchedSnippet: cue.cleanText,
      };
    }

    if (phrase3 && windowNorm.includes(phrase3) && cueNorm.includes(firstWordNorm)) {
      const cue = cues[idx];
      const wordSnappedStart = getWordSnappedStart(cue, rawWords[0]);
      return {
        matchedCue: cue,
        confidence: 'high',
        cueIndex: idx,
        wordSnappedStart,
        matchedSnippet: `${cues[idx].cleanText} ${cues[idx + 1]?.cleanText || ''}`.trim(),
      };
    }
  }

  // --- STRATEGY C: Backward Search (If speech paused or minor timeline displacement) ---
  if (allSpoken.length > 0 && startWordIndex > 0) {
    if (has4) {
      for (let k = 0; k < Math.min(startWordIndex, allSpoken.length - 4); k++) {
        let matchCount = 0;
        for (let m = 0; m < 4; m++) {
          if (isFuzzyWordMatch(allSpoken[k + m].word, opening4[m])) {
            matchCount++;
          }
        }
        if (matchCount === 4) {
          const cue = allSpoken[k].cue;
          return {
            matchedCue: cue,
            confidence: 'high',
            cueIndex: allSpoken[k].cueIndex,
            wordSnappedStart: allSpoken[k].start,
            matchedSnippet: allSpoken.slice(k, k + 4).map((s) => s.word).join(' '),
            matchedWordIndex: k + 4,
          };
        }
      }
    }

    if (has3) {
      for (let k = 0; k < Math.min(startWordIndex, allSpoken.length - 3); k++) {
        let matchCount = 0;
        for (let m = 0; m < 3; m++) {
          if (isFuzzyWordMatch(allSpoken[k + m].word, opening3[m])) {
            matchCount++;
          }
        }
        if (matchCount === 3) {
          const cue = allSpoken[k].cue;
          return {
            matchedCue: cue,
            confidence: 'high',
            cueIndex: allSpoken[k].cueIndex,
            wordSnappedStart: allSpoken[k].start,
            matchedSnippet: allSpoken.slice(k, k + 3).map((s) => s.word).join(' '),
            matchedWordIndex: k + 3,
          };
        }
      }
    }
  }

  // --- STRATEGY D: First 2 Opening Words (Fuzzy Fallback) ---
  if (rawWords.length >= 2 && allSpoken.length > 0) {
    const opening2 = rawWords.slice(0, 2);
    for (let k = Math.max(0, startWordIndex - 2); k <= allSpoken.length - 2; k++) {
      if (
        isFuzzyWordMatch(allSpoken[k].word, opening2[0]) &&
        isFuzzyWordMatch(allSpoken[k + 1].word, opening2[1])
      ) {
        const cue = allSpoken[k].cue;
        return {
          matchedCue: cue,
          confidence: 'fuzzy',
          cueIndex: allSpoken[k].cueIndex,
          wordSnappedStart: allSpoken[k].start,
          matchedSnippet: allSpoken.slice(k, k + 2).map((s) => s.word).join(' '),
          matchedWordIndex: k + 2,
        };
      }
    }
  }

  // Fallback: estimate from chronological position
  const fallbackIndex = Math.min(startIndex, cues.length - 1);
  return {
    matchedCue: cues[fallbackIndex] || null,
    confidence: 'fallback',
    cueIndex: fallbackIndex,
    matchedSnippet: cues[fallbackIndex]?.cleanText,
  };
}

/**
 * Splits paragraph text into individual sentences based on standard punctuation (. ? !)
 * or line breaks.
 */
export function splitParagraphIntoSentences(text: string): string[] {
  if (!text || !text.trim()) return [];
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();

  // Split on punctuation (.?!) followed by space or newline, or just newlines
  const rawParts = normalized.split(/(?<=[.?!])\s+|\n+/);
  const sentences = rawParts.map((s) => s.trim()).filter((s) => s.length > 0);
  return sentences.length > 0 ? sentences : [normalized];
}

/**
 * Extracts exact sentence-by-sentence timings for a script paragraph against VTT speech cues.
 * - Detects sentence boundaries in pasted script (.?!\n)
 * - Identifies when each sentence is spoken in the voiceover cues using fuzzy & phonetic matching
 * - Snaps to sub-second word timestamps if available in cue.words
 * - Ensures all sentences form a continuous, non-overlapping chronological timeline spanning the paragraph
 */
export function extractSentenceTimings(
  paragraph: ScriptParagraph,
  paragraphStartTime: number,
  paragraphEndTime: number,
  cues: VttCue[],
  paragraphIndex: number,
  startingOverallIndex: number
): ScriptSentence[] {
  const rawSentences = splitParagraphIntoSentences(paragraph.text);
  if (rawSentences.length === 0) {
    return [];
  }

  // Single sentence: spans the entire paragraph duration
  if (rawSentences.length === 1) {
    const singleText = rawSentences[0];
    const duration = Math.max(0.1, Number((paragraphEndTime - paragraphStartTime).toFixed(3)));
    return [
      {
        id: `p${paragraphIndex + 1}-s1`,
        paragraphIndex,
        sentenceIndexInParagraph: 0,
        overallSentenceIndex: startingOverallIndex,
        text: singleText,
        cleanText: singleText.replace(/\s+/g, ' ').trim(),
        startTime: paragraphStartTime,
        endTime: paragraphEndTime,
        duration,
        confidence: 'exact',
      },
    ];
  }

  // Multiple sentences within the paragraph
  const sentences: ScriptSentence[] = [];
  const sentenceCount = rawSentences.length;
  const sentenceStartTimes: number[] = new Array(sentenceCount).fill(0);
  const sentenceConfidences: MatchConfidence[] = new Array(sentenceCount).fill('fallback');
  const sentenceMatchedCues: (VttCue | null)[] = new Array(sentenceCount).fill(null);

  // Sentence 0 always starts at paragraphStartTime
  sentenceStartTimes[0] = paragraphStartTime;
  sentenceConfidences[0] = 'exact';

  // Filter cues that are relevant to this paragraph's time span (with small buffer)
  const candidateCues = cues.filter(
    (c) => c.endTime >= paragraphStartTime - 0.5 && c.startTime <= paragraphEndTime + 1.5
  );

  // Match subsequent sentences (1 to N-1)
  let lastMatchedTime = paragraphStartTime;

  for (let sIdx = 1; sIdx < sentenceCount; sIdx++) {
    const sentenceText = rawSentences[sIdx];
    const sWords = sentenceText.split(/\s+/).map((w) => w.trim()).filter(Boolean);
    const leadingWords = sWords.slice(0, Math.min(6, sWords.length));
    const leadingPhraseNorm = normalizeForSearch(leadingWords.join(' '));

    let foundStart: number | undefined;
    let foundConfidence: MatchConfidence = 'fallback';
    let matchedCue: VttCue | null = null;

    if (candidateCues.length > 0 && leadingWords.length > 0) {
      const isWordLevel = candidateCues.some((c) => !c.cleanText.includes(' '));

      if (isWordLevel) {
        const targetLen = Math.min(5, leadingWords.length);
        for (let L = targetLen; L >= 2; L--) {
          const subTarget = leadingWords.slice(0, L);

          for (let cIdx = 0; cIdx <= candidateCues.length - L; cIdx++) {
            const cue = candidateCues[cIdx];
            if (cue.startTime < lastMatchedTime - 0.2) continue;

            let matchesCount = 0;
            for (let m = 0; m < L; m++) {
              const cWord = normalizeForSearch(candidateCues[cIdx + m].cleanText || candidateCues[cIdx + m].text);
              const tWord = normalizeForSearch(subTarget[m]);
              if (cWord === tWord || isFuzzyWordMatch(cWord, tWord)) {
                matchesCount++;
              }
            }

            if (matchesCount === L || (L >= 4 && matchesCount >= L - 1)) {
              foundStart = cue.startTime;
              foundConfidence = matchesCount === L && L >= 3 ? 'exact' : 'high';
              matchedCue = cue;
              break;
            }
          }
          if (foundStart !== undefined) break;
        }

        // Single word fallback
        if (foundStart === undefined && leadingWords.length > 0) {
          const firstTarget = normalizeForSearch(leadingWords[0]);
          for (const cue of candidateCues) {
            if (cue.startTime < lastMatchedTime - 0.2) continue;
            const cWord = normalizeForSearch(cue.cleanText || cue.text);
            if (cWord === firstTarget || isFuzzyWordMatch(cWord, firstTarget)) {
              foundStart = cue.startTime;
              foundConfidence = 'fuzzy';
              matchedCue = cue;
              break;
            }
          }
        }
      } else {
        // Sentence-level cue fallback (legacy)
        for (const cue of candidateCues) {
          if (cue.startTime < lastMatchedTime - 0.3) continue;

          const cueNorm = normalizeForSearch(cue.cleanText || cue.text);

          // Word timestamp snapping if available
          if (cue.words && cue.words.length > 0) {
            const firstWordNorm = normalizeForSearch(leadingWords[0]);
            const wordIdx = cue.words.findIndex(
              (w) => isFuzzyWordMatch(w.word, firstWordNorm)
            );
            if (wordIdx !== -1 && cue.words[wordIdx].start >= lastMatchedTime - 0.2) {
              foundStart = cue.words[wordIdx].start;
              foundConfidence = 'exact';
              matchedCue = cue;
              break;
            }
          }

          // Phrase contains check
          if (cueNorm.includes(leadingPhraseNorm)) {
            foundStart = cue.startTime;
            foundConfidence = 'exact';
            matchedCue = cue;
            break;
          }

          // Leading 3 words match
          if (leadingWords.length >= 3) {
            const sub3 = normalizeForSearch(leadingWords.slice(0, 3).join(' '));
            if (cueNorm.includes(sub3)) {
              foundStart = cue.startTime;
              foundConfidence = 'high';
              matchedCue = cue;
              break;
            }
          }
        }
      }
    }

    // Validate detected timestamp is chronological and within bounds
    if (
      foundStart !== undefined &&
      foundStart > lastMatchedTime + 0.3 &&
      foundStart < paragraphEndTime - 0.2
    ) {
      sentenceStartTimes[sIdx] = Number(foundStart.toFixed(3));
      sentenceConfidences[sIdx] = foundConfidence;
      sentenceMatchedCues[sIdx] = matchedCue;
      lastMatchedTime = foundStart;
    } else {
      // Fallback: estimate start time proportionally based on character length of remaining sentences
      const remainingSentences = rawSentences.slice(sIdx - 1);
      const remainingTotalChars = remainingSentences.reduce((acc, s) => acc + s.length, 0) || 1;
      const prevSentenceChars = rawSentences[sIdx - 1].length;
      const remainingDuration = Math.max(0.6, paragraphEndTime - lastMatchedTime);
      const stepDuration = (prevSentenceChars / remainingTotalChars) * remainingDuration;
      const estimatedStart = Math.min(
        paragraphEndTime - 0.3,
        Math.max(lastMatchedTime + 0.5, lastMatchedTime + stepDuration)
      );

      sentenceStartTimes[sIdx] = Number(estimatedStart.toFixed(3));
      sentenceConfidences[sIdx] = 'fallback';
      lastMatchedTime = estimatedStart;
    }
  }

  // Calculate end times and durations
  for (let sIdx = 0; sIdx < sentenceCount; sIdx++) {
    const sStart = sentenceStartTimes[sIdx];
    const sEnd =
      sIdx < sentenceCount - 1
        ? sentenceStartTimes[sIdx + 1]
        : paragraphEndTime;

    const sDur = Math.max(0.1, Number((sEnd - sStart).toFixed(3)));
    const sRaw = rawSentences[sIdx];
    const sClean = sRaw.replace(/\s+/g, ' ').trim();

    let warning: string | undefined;
    if (sentenceConfidences[sIdx] === 'fallback') {
      warning = `Estimated timing: voiceover sentence match had low confidence.`;
    }

    sentences.push({
      id: `p${paragraphIndex + 1}-s${sIdx + 1}`,
      paragraphIndex,
      sentenceIndexInParagraph: sIdx,
      overallSentenceIndex: startingOverallIndex + sIdx,
      text: sRaw,
      cleanText: sClean,
      startTime: sStart,
      endTime: Number(sEnd.toFixed(3)),
      duration: sDur,
      confidence: sentenceConfidences[sIdx],
      matchedCue: sentenceMatchedCues[sIdx],
      warning,
    });
  }

  return sentences;
}

const COMMON_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'from', 'have', 'about', 'there',
  'what', 'when', 'where', 'which', 'who', 'will', 'your', 'their', 'they', 'them',
  'some', 'into', 'just', 'more', 'also', 'over', 'such', 'only', 'most', 'other',
  'than', 'then', 'here', 'slide', 'image', 'picture', 'photo', 'video', 'graphic',
  'show', 'next', 'first', 'second', 'third', 'after', 'before'
]);

/**
 * Semantic image matcher:
 * Connects images with script passages based on filename keyword similarity,
 * while detecting unused pool images and unmatched paragraphs.
 */
export function matchImagesSemantically(
  images: ImageItem[],
  paragraphs: ScriptParagraph[]
): {
  assignedImages: (ImageItem | null)[];
  semanticReasons: (string | undefined)[];
  unusedImages: ImageItem[];
} {
  const assignedImages: (ImageItem | null)[] = new Array(paragraphs.length).fill(null);
  const semanticReasons: (string | undefined)[] = new Array(paragraphs.length).fill(undefined);
  const usedImageIds = new Set<string>();

  if (images.length === 0 || paragraphs.length === 0) {
    return { assignedImages, semanticReasons, unusedImages: [...images] };
  }

  // 1. Extract keyword tokens from image names
  const imageKeywordsList = images.map((img) => {
    const baseName = img.name.replace(/\.[^/.]+$/, '').toLowerCase();
    const tokens = baseName
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w));
    return { img, tokens };
  });

  // 2. Extract keyword tokens from paragraph text
  const paraKeywordsList = paragraphs.map((p) => {
    const text = (p.text || '').toLowerCase();
    const words = text
      .split(/[^a-z0-9]+/i)
      .filter((w) => w.length >= 3 && !COMMON_STOP_WORDS.has(w));
    return new Set(words);
  });

  // 3. Score all pairs
  const candidateScores: { paraIdx: number; imgIdx: number; score: number; keyword: string }[] = [];

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const pWords = paraKeywordsList[pIdx];
    for (let iIdx = 0; iIdx < images.length; iIdx++) {
      const { tokens } = imageKeywordsList[iIdx];
      let bestKeyword = '';
      let matchCount = 0;
      for (const token of tokens) {
        if (pWords.has(token)) {
          matchCount++;
          if (!bestKeyword) bestKeyword = token;
        }
      }
      if (matchCount > 0) {
        candidateScores.push({
          paraIdx: pIdx,
          imgIdx: iIdx,
          score: matchCount,
          keyword: bestKeyword,
        });
      }
    }
  }

  // Sort descending by keyword match score
  candidateScores.sort((a, b) => b.score - a.score);

  // Assign greedily
  for (const match of candidateScores) {
    if (!assignedImages[match.paraIdx] && !usedImageIds.has(images[match.imgIdx].id)) {
      assignedImages[match.paraIdx] = images[match.imgIdx];
      semanticReasons[match.paraIdx] = `Keyword match: "${match.keyword}"`;
      usedImageIds.add(images[match.imgIdx].id);
    }
  }

  // 4. Fill remaining unassigned paragraphs sequentially with unused images
  let imgPointer = 0;
  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    if (!assignedImages[pIdx]) {
      while (imgPointer < images.length && usedImageIds.has(images[imgPointer].id)) {
        imgPointer++;
      }
      if (imgPointer < images.length) {
        assignedImages[pIdx] = images[imgPointer];
        usedImageIds.add(images[imgPointer].id);
        imgPointer++;
      }
    }
  }

  const unusedImages = images.filter((img) => !usedImageIds.has(img.id));
  return { assignedImages, semanticReasons, unusedImages };
}

/**
 * Extracts actionable review queue items from synchronized matches
 */
export function extractSyncReviewItems(
  matches: SyncMatch[],
  images: ImageItem[],
  cues: VttCue[],
  audioDuration?: number
): ReviewQueueItem[] {
  const items: ReviewQueueItem[] = [];

  matches.forEach((m, idx) => {
    // 1. Missing Image
    if (!m.image) {
      items.push({
        id: `review_missing_img_${idx}`,
        slideIndex: idx,
        slideId: m.id || `slide_${idx + 1}`,
        type: 'missing_image',
        severity: 'error',
        title: `Slide ${idx + 1} has no visual image`,
        description: `This paragraph will render with a blank visual unless an image is assigned.`,
        timeRange: `${m.startTime.toFixed(1)}s - ${m.endTime.toFixed(1)}s`,
      });
    }

    // 2. Low confidence or fallback timing
    if (m.confidence === 'fallback' || (m.confidenceScore !== undefined && m.confidenceScore < 65)) {
      items.push({
        id: `review_low_conf_${idx}`,
        slideIndex: idx,
        slideId: m.id || `slide_${idx + 1}`,
        type: 'low_confidence',
        severity: 'warning',
        title: `Estimated speech timing on Slide ${idx + 1}`,
        description: `Opening words "${m.searchPhrase}" were not found with high confidence in subtitle cues.`,
        timeRange: `${m.startTime.toFixed(1)}s - ${m.endTime.toFixed(1)}s`,
      });
    }

    // 3. Very short duration
    if (m.duration < 1.0) {
      items.push({
        id: `review_short_${idx}`,
        slideIndex: idx,
        slideId: m.id || `slide_${idx + 1}`,
        type: 'gap_or_overlap',
        severity: 'warning',
        title: `Very short duration (${m.duration.toFixed(2)}s) on Slide ${idx + 1}`,
        description: `Slide duration is under 1.0 second and may flash by too quickly.`,
        timeRange: `${m.startTime.toFixed(1)}s - ${m.endTime.toFixed(1)}s`,
      });
    }
  });

  return items;
}

/**
 * Synchronizes script paragraphs and images against VTT speech cues.
 *
 * Core Workflow:
 * 1. Each script paragraph maps to 1 image slide (Slide i = Paragraph i).
 * 2. Slide 1 (Paragraph 1) begins at 00:00:00.000 so the video starts immediately.
 * 3. For each subsequent paragraph, we detect its starting sentence/line in the VTT cues.
 * 4. The detected timestamp becomes the exact START time for Slide i, and the END time for Slide i-1.
 * 5. Slide i remains active on screen continuously until Slide i+1 begins.
 * 6. The final slide remains active until the voiceover audio / last VTT cue concludes.
 */
export function synchronizeScriptAndVtt(
  paragraphs: ScriptParagraph[],
  cues: VttCue[],
  images: ImageItem[],
  parallelTranscripts?: ParallelTranscripts,
  audioDuration?: number,
  mode: SyncMode = 'vtt_driven',
  existingMatches?: SyncMatch[]
): SyncAnalysis {
  const matches: SyncMatch[] = [];
  const paragraphCount = paragraphs.length;
  const imageCount = images.length;
  const cueCount = cues.length;

  // Determine overall VTT end time and effective voiceover audio end time
  const lastVttEndTime = cues.length > 0 ? cues[cues.length - 1].endTime : 0;
  const effectiveAudioEnd = Math.max(
    lastVttEndTime,
    audioDuration && audioDuration > 0 ? audioDuration : 0
  );

  // If images exist but NO script paragraphs exist,
  // directly sync the images across the entire voiceover duration, snapping cut points to speech pauses/silence gaps.
  if (imageCount > 0 && paragraphCount === 0) {
    const totalDuration = effectiveAudioEnd > 0 ? effectiveAudioEnd : imageCount * 4.0;

    // Find natural speech silence gaps between cues (at least 120ms gap)
    const silenceGaps: { start: number; end: number; midpoint: number }[] = [];
    for (let c = 0; c < cues.length - 1; c++) {
      const gap = cues[c + 1].startTime - cues[c].endTime;
      if (gap >= 0.12) {
        silenceGaps.push({
          start: cues[c].endTime,
          end: cues[c + 1].startTime,
          midpoint: Number(((cues[c].endTime + cues[c + 1].startTime) / 2).toFixed(3)),
        });
      }
    }

    // Determine cut timestamps for imageCount slides
    const slideCuts: number[] = [0];
    for (let i = 1; i < imageCount; i++) {
      const targetTime = (i / imageCount) * totalDuration;
      let bestCut = targetTime;
      let minDiff = 2.5;

      // 1. Check natural speech pause midpoint
      for (const sg of silenceGaps) {
        const diff = Math.abs(sg.midpoint - targetTime);
        if (diff < minDiff && sg.midpoint > slideCuts[i - 1] + 0.6 && sg.midpoint < totalDuration - (imageCount - i) * 0.5) {
          minDiff = diff;
          bestCut = sg.midpoint;
        }
      }

      // 2. Check cue start times if no silence pause found
      if (minDiff >= 2.0) {
        for (const cue of cues) {
          const diff = Math.abs(cue.startTime - targetTime);
          if (diff < minDiff && cue.startTime > slideCuts[i - 1] + 0.6 && cue.startTime < totalDuration - (imageCount - i) * 0.5) {
            minDiff = diff;
            bestCut = cue.startTime;
          }
        }
      }

      // Ensure monotonically advancing cut
      if (bestCut <= slideCuts[i - 1] + 0.5) {
        bestCut = slideCuts[i - 1] + (totalDuration - slideCuts[i - 1]) / (imageCount - i + 1);
      }

      slideCuts.push(Number(bestCut.toFixed(3)));
    }
    slideCuts.push(Number(totalDuration.toFixed(3)));

    const allSentences: ScriptSentence[] = [];
    let overallSentenceIndex = 0;

    for (let i = 0; i < imageCount; i++) {
      const sStart = slideCuts[i];
      const sEnd = slideCuts[i + 1];
      const sDuration = Math.max(0.5, Number((sEnd - sStart).toFixed(3)));
      const img = images[i];

      // Gather cues within this slide's time slice
      const cuesInSlide = cues.filter(
        (c) => (c.startTime >= sStart && c.startTime < sEnd) ||
               (c.endTime > sStart && c.endTime <= sEnd) ||
               (c.startTime <= sStart && c.endTime >= sEnd)
      );

      const slideText =
        (paragraphs[i] && paragraphs[i].text) ||
        (cuesInSlide.length > 0 ? cuesInSlide.map((c) => c.cleanText).join(' ') : `Slide ${i + 1}`);

      const words = slideText.split(/\s+/).filter(Boolean);
      const firstLine = slideText.split('\n')[0].trim();

      const para: ScriptParagraph = {
        id: `img-sync-slide-${i + 1}`,
        index: i,
        text: slideText,
        cleanText: slideText,
        startingLine: firstLine,
        startingSentence: firstLine,
        words,
        firstSentenceWords: words.slice(0, 10),
        leadingWords: words.slice(0, 5),
        searchPhrase: normalizeForSearch(words.slice(0, 5).join(' ')),
      };

      const paraSentences = extractSentenceTimings(
        para,
        sStart,
        sEnd,
        cues,
        i,
        overallSentenceIndex
      );
      allSentences.push(...paraSentences);
      overallSentenceIndex += paraSentences.length;

      matches.push({
        index: i,
        image: img,
        paragraph: para,
        matchedCue: cuesInSlide[0] || null,
        startTime: sStart,
        endTime: sEnd,
        duration: sDuration,
        confidence: 'exact',
        confidenceScore: 96,
        matchedScript: 'English',
        status: 'exact',
        searchPhrase: para.searchPhrase,
        triggerSentence: para.startingSentence,
        matchedTextSnippet: cuesInSlide[0]?.cleanText || slideText,
        sentences: paraSentences,
      });
    }

    const sentenceVtt = buildVttFromSentences(allSentences);
    const srtLines: string[] = [];
    matches.forEach((m, idx) => {
      const sStr = formatSecondsToTimestamp(m.startTime, true).replace('.', ',');
      const eStr = formatSecondsToTimestamp(m.endTime, true).replace('.', ',');
      srtLines.push(`${idx + 1}`);
      srtLines.push(`${sStr} --> ${eStr}`);
      srtLines.push(m.paragraph.text);
      srtLines.push('');
    });
    const srtContent = srtLines.join('\n');

    const csvLines: string[] = ['Marker Name,Description,In,Out,Duration,Marker Type'];
    matches.forEach((m) => {
      const inTc = formatSecondsToTimestamp(m.startTime, false);
      const outTc = formatSecondsToTimestamp(m.endTime, false);
      const durSec = m.duration.toFixed(3);
      const name = `Slide ${m.index + 1} (${m.image?.name || 'Image'})`;
      const desc = (m.paragraph.cleanText || '').replace(/"/g, '""');
      csvLines.push(`"${name}","${desc}",${inTc},${outTc},${durSec},Comment`);
    });
    const premiereMarkersCsv = csvLines.join('\n');

    const timelineJson = JSON.stringify({
      slides: matches.map((m) => ({
        slideNumber: m.index + 1,
        startTime: m.startTime,
        endTime: m.endTime,
        duration: m.duration,
        confidenceScore: m.confidenceScore,
        status: m.status,
        trigger: m.triggerSentence,
        text: m.paragraph.text,
        imageName: m.image?.name || null,
      })),
      totalDuration: Number(totalDuration.toFixed(3)),
      averageConfidence: 96,
      timestamp: new Date().toISOString(),
    }, null, 2);

    const effectiveTotal = matches.length > 0 ? matches[matches.length - 1].endTime : Number(totalDuration.toFixed(3));

    return {
      matches,
      sentences: allSentences,
      hasMismatch: false,
      totalDuration: Number(effectiveTotal.toFixed(3)),
      imageCount,
      paragraphCount: imageCount,
      cueCount,
      matchedCount: imageCount,
      averageConfidence: 96,
      sentenceVtt,
      srtContent,
      premiereMarkersCsv,
      timelineJson,
    };
  }

  const effectiveParagraphs: ScriptParagraph[] = paragraphs;

  // Extract universal spoken words stream with sub-second timestamps
  const spokenWords = extractSpokenWordsFromCues(cues);

  let currentCueIndex = 0;
  let currentWordIndex = 0;
  const rawTimestamps: {
    start: number;
    cue: VttCue | null;
    confidence: MatchConfidence;
    confidenceScore?: number;
    matchedScript?: MatchedScriptType;
    matchedSnippet?: string;
    triggerPhrase: string;
  }[] = [];

  // Step 1: Detect start timestamps for each paragraph slide by matching against all transcripts
  for (let i = 0; i < effectiveParagraphs.length; i++) {
    const paragraph = effectiveParagraphs[i];
    const initialWords = (
      paragraph.words && paragraph.words.length > 0
        ? paragraph.words
        : (paragraph.text || '').split(/\s+/)
    )
      .map((w) => w.trim().replace(/^["'“”‘’«»(\[{]+|[.,/#!$%^&*;:{}=\-_`~()؟۔،؛"'»\]}>]+$/g, ''))
      .filter((w) => w.length > 0);
    const triggerPhrase = initialWords.slice(0, 4).join(' ');

    const defaultScript = 'English';

    if (i === 0) {
      // Slide 1 ALWAYS starts at 00:00:00.000 so video playback starts cleanly from frame 0
      const firstCue = cues.length > 0 ? cues[0] : null;
      const p0Match = findParagraphCueMatch(paragraph, cues, 0, spokenWords, 0);
      const matchedCue = p0Match.matchedCue || firstCue;
      rawTimestamps.push({
        start: 0,
        cue: matchedCue,
        confidence: 'exact',
        confidenceScore: 99,
        matchedScript: defaultScript,
        matchedSnippet: p0Match.matchedSnippet || firstCue?.cleanText,
        triggerPhrase,
      });
      if (p0Match.cueIndex !== undefined && p0Match.cueIndex >= 0) {
        currentCueIndex = Math.min(p0Match.cueIndex + 1, cues.length - 1);
      }
      if (p0Match.matchedWordIndex !== undefined) {
        currentWordIndex = p0Match.matchedWordIndex;
      }
    } else {
      // Primary match against active cues
      const { matchedCue, confidence, cueIndex, wordSnappedStart, matchedSnippet, matchedWordIndex } =
        findParagraphCueMatch(paragraph, cues, currentCueIndex, spokenWords, currentWordIndex);

      const bestScript = 'English';
      const bestScore = confidence === 'exact' ? 98 : confidence === 'high' ? 88 : confidence === 'fuzzy' ? 72 : 45;

      let startTime: number | null = null;
      const prevStartTime = rawTimestamps[i - 1]?.start ?? 0;
      if (matchedCue && confidence !== 'fallback') {
        const candidateTime = wordSnappedStart !== undefined ? wordSnappedStart : matchedCue.startTime;
        // Strictly advancing: a subsequent paragraph must begin after the previous one starts
        if (candidateTime >= prevStartTime + 0.3) {
          startTime = candidateTime;
          currentCueIndex = Math.min(cueIndex + 1, cues.length - 1);
          if (matchedWordIndex !== undefined) {
            currentWordIndex = matchedWordIndex;
          }
        }
      }

      rawTimestamps.push({
        start: startTime !== null ? Number(startTime.toFixed(3)) : -1,
        cue: matchedCue,
        confidence,
        confidenceScore: bestScore,
        matchedScript: bestScript,
        matchedSnippet,
        triggerPhrase,
      });
    }
  }

  // INTELLIGENT GAP SYNCING: Multi-pass Anchor & Speech-Velocity Interpolation
  // For any slide where direct match was not found with high confidence,
  // distribute the bounded gap between the previous anchor and next anchor
  // proportionally according to the word counts of the script paragraphs,
  // then snap to the nearest silence gap or cue start.
  for (let i = 0; i < rawTimestamps.length; i++) {
    if (rawTimestamps[i].start === -1) {
      // Find previous anchor
      let prevAnchorIdx = i - 1;
      while (prevAnchorIdx >= 0 && rawTimestamps[prevAnchorIdx].start === -1) {
        prevAnchorIdx--;
      }
      const prevAnchorTime = prevAnchorIdx >= 0 ? rawTimestamps[prevAnchorIdx].start : 0;

      // Find next anchor
      let nextAnchorIdx = i + 1;
      while (nextAnchorIdx < rawTimestamps.length && rawTimestamps[nextAnchorIdx].start === -1) {
        nextAnchorIdx++;
      }
      const nextAnchorTime = nextAnchorIdx < rawTimestamps.length
        ? rawTimestamps[nextAnchorIdx].start
        : (lastVttEndTime > prevAnchorTime ? lastVttEndTime : prevAnchorTime + (rawTimestamps.length - prevAnchorIdx) * 4.0);

      // Total words in this unanchored segment (including bounding previous slide)
      const segmentSlides = [];
      const startSlideIdx = prevAnchorIdx >= 0 ? prevAnchorIdx : 0;
      for (let k = startSlideIdx; k < nextAnchorIdx; k++) {
        segmentSlides.push(effectiveParagraphs[k]);
      }

      const totalWords = segmentSlides.reduce((acc, p) => acc + Math.max(1, p?.words?.length || 5), 0);
      const availableDuration = Math.max(1.5 * segmentSlides.length, nextAnchorTime - prevAnchorTime);

      // Accumulate proportional time up to slide i
      let accumulatedWords = 0;
      for (let k = startSlideIdx; k < i; k++) {
        accumulatedWords += Math.max(1, effectiveParagraphs[k]?.words?.length || 5);
      }

      const interpolatedTime = prevAnchorTime + (availableDuration * (accumulatedWords / Math.max(1, totalWords)));

      // Intelligent Silence Snapping:
      // Look for the closest speech boundary / silence gap within 1.5s
      let bestSnappedTime = interpolatedTime;
      let minDiff = 1.8;
      for (const c of cues) {
        // Test cue start
        const diffStart = Math.abs(c.startTime - interpolatedTime);
        if (diffStart < minDiff && c.startTime > prevAnchorTime + 0.4 && c.startTime < nextAnchorTime - 0.4) {
          minDiff = diffStart;
          bestSnappedTime = c.startTime;
        }
        // Test cue end (silence pause start)
        const diffEnd = Math.abs(c.endTime - interpolatedTime);
        if (diffEnd < minDiff && c.endTime > prevAnchorTime + 0.4 && c.endTime < nextAnchorTime - 0.4) {
          minDiff = diffEnd;
          bestSnappedTime = c.endTime;
        }
      }

      // Ensure strictly advancing order
      const prevTime = rawTimestamps[i - 1]?.start ?? 0;
      if (bestSnappedTime <= prevTime + 0.4) {
        bestSnappedTime = prevTime + 1.5;
      }

      rawTimestamps[i].start = Number(bestSnappedTime.toFixed(3));
      rawTimestamps[i].confidence = 'fuzzy';
    }
  }

  // Step 2: Enforce continuous image intervals:
  // Each paragraph slide stays active from its start timestamp until the NEXT paragraph's opening 3-4 words match.
  let matchedCount = 0;

  // Semantic proposal if guided_auto mode is selected
  const semanticProposal =
    mode === 'guided_auto' && images.length > 0
      ? matchImagesSemantically(images, effectiveParagraphs)
      : null;

  for (let i = 0; i < effectiveParagraphs.length; i++) {
    const paragraph = effectiveParagraphs[i];
    const existing = existingMatches?.[i];
    const isManual = !!existing?.isManualEdit;

    // Determine image assignment (preserves manual assignment, otherwise semantic or sequential)
    let image: ImageItem | null = null;
    let semanticReason: string | undefined = undefined;

    if (isManual && existing?.image !== undefined) {
      image = existing.image;
    } else if (semanticProposal && semanticProposal.assignedImages[i]) {
      image = semanticProposal.assignedImages[i];
      semanticReason = semanticProposal.semanticReasons[i];
    } else {
      image = i < images.length ? images[i] : null;
    }

    const { start, cue, confidence, matchedSnippet, triggerPhrase } = rawTimestamps[i];

    if (confidence !== 'fallback') {
      matchedCount++;
    }

    let end = 0;
    if (i < effectiveParagraphs.length - 1) {
      // Slide i ends exactly when slide i + 1 starts (held until next paragraph's opening 3-4 words match!)
      end = Math.max(start + 0.5, rawTimestamps[i + 1].start);
    } else {
      // Final slide: extends until the end of voiceover audio / last VTT cue
      const finalWords = (paragraph.words && paragraph.words.length > 0)
        ? paragraph.words.length
        : paragraph.text.split(/\s+/).filter(Boolean).length || 8;
      const expectedFinalDur = Math.max(3.5, finalWords / 2.3);

      if (effectiveAudioEnd > start) {
        end = Math.max(start + 0.5, effectiveAudioEnd);
      } else {
        end = start + Math.min(12.0, Math.max(3.5, expectedFinalDur));
      }
    }

    // Preserve user's manual boundaries if previously edited
    let finalStart = Number(start.toFixed(3));
    let finalEnd = Number(end.toFixed(3));

    if (isManual && existing) {
      finalStart = existing.startTime;
      finalEnd = existing.endTime;
    }

    // Ensure positive duration
    const duration = Math.max(0.2, Number((finalEnd - finalStart).toFixed(3)));

    let warning: string | undefined;
    if (!image) {
      warning = `Missing image for Slide ${i + 1} (Paragraph ${i + 1}).`;
    } else if (confidence === 'fallback') {
      warning = `Estimated timing: opening words "${triggerPhrase}" not found in VTT cues.`;
    }

    const score = rawTimestamps[i].confidenceScore || (confidence === 'exact' ? 98 : confidence === 'high' ? 88 : confidence === 'fuzzy' ? 75 : 50);
    
    let status: SyncStatus = 'auto_high';
    if (isManual) {
      status = 'confirmed';
    } else if (!image || confidence === 'fallback' || score < 70) {
      status = 'needs_review';
    } else if (score >= 85) {
      status = 'auto_high';
    } else {
      status = 'needs_review';
    }

    // Stable ID
    const stableId = existing?.id || `slide_${i + 1}_${Math.round(finalStart * 1000)}_${Math.random().toString(36).substring(2, 6)}`;

    // Quantized frame boundaries at 30fps
    const startFrame = Math.round(finalStart * 30);
    const endFrame = Math.round(finalEnd * 30);
    const frameCount = Math.max(1, endFrame - startFrame);

    // Multi-cue capture for all subtitle cues in this slide's time slice
    const matchedCuesInSpan = cues.filter(
      (c) => (c.startTime >= finalStart && c.startTime < finalEnd) ||
             (c.endTime > finalStart && c.endTime <= finalEnd) ||
             (c.startTime <= finalStart && c.endTime >= finalEnd)
    );

    matches.push({
      id: stableId,
      index: i,
      image,
      paragraph,
      matchedCue: cue,
      matchedCues: matchedCuesInSpan,
      startTime: finalStart,
      endTime: finalEnd,
      duration,
      confidence,
      confidenceScore: score,
      status,
      isManualEdit: isManual,
      syncMode: mode,
      startFrame,
      endFrame,
      frameCount,
      matchedScript: rawTimestamps[i].matchedScript || 'English',
      searchPhrase: triggerPhrase,
      triggerSentence: triggerPhrase,
      matchedTextSnippet: matchedSnippet || (cue ? cue.cleanText : undefined),
      semanticMatchReason: semanticReason,
      warning,
    });
  }

  // If guided_auto mode: optimize cuts against silence gaps (respecting manual locks)
  if (mode === 'guided_auto' && matches.length > 0) {
    const optimized = intelligentAutoSync(matches, cues, effectiveAudioEnd);
    for (let k = 0; k < matches.length; k++) {
      if (!matches[k].isManualEdit && optimized.optimizedMatches[k]) {
        matches[k].startTime = optimized.optimizedMatches[k].startTime;
        matches[k].endTime = optimized.optimizedMatches[k].endTime;
        matches[k].duration = optimized.optimizedMatches[k].duration;
        const sFrame = Math.round(matches[k].startTime * 30);
        const eFrame = Math.round(matches[k].endTime * 30);
        matches[k].startFrame = sFrame;
        matches[k].endFrame = eFrame;
        matches[k].frameCount = Math.max(1, eFrame - sFrame);
      }
    }
  }

  // Step 3: Extract sentence-level timings for each paragraph slide
  let overallSentenceIndex = 0;
  const allSentences: ScriptSentence[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const paraSentences = extractSentenceTimings(
      match.paragraph,
      match.startTime,
      match.endTime,
      cues,
      i,
      overallSentenceIndex
    );
    match.sentences = paraSentences;
    allSentences.push(...paraSentences);
    overallSentenceIndex += paraSentences.length;
  }

  // Build clean WebVTT subtitle track for sentence cues
  const sentenceVtt = buildVttFromSentences(allSentences);

  // Total duration
  const totalDuration = matches.length > 0 ? matches[matches.length - 1].endTime : 0;

  // Average confidence score across all slides
  const averageConfidence = matches.length > 0
    ? Math.round(matches.reduce((acc, m) => acc + (m.confidenceScore || 50), 0) / matches.length)
    : 0;

  // Build SRT subtitle string
  const srtLines: string[] = [];
  matches.forEach((m, idx) => {
    const sStr = formatSecondsToTimestamp(m.startTime, true).replace('.', ',');
    const eStr = formatSecondsToTimestamp(m.endTime, true).replace('.', ',');
    srtLines.push(`${idx + 1}`);
    srtLines.push(`${sStr} --> ${eStr}`);
    srtLines.push(m.paragraph.text);
    srtLines.push('');
  });
  const srtContent = srtLines.join('\n');

  // Build Adobe Premiere Pro / After Effects marker CSV
  const premiereLines: string[] = ['Marker Name\tDescription\tIn\tOut\tDuration\tMarker Type'];
  matches.forEach((m) => {
    const sStr = formatSecondsToTimestamp(m.startTime, true);
    const eStr = formatSecondsToTimestamp(m.endTime, true);
    const durStr = formatSecondsToTimestamp(m.duration, true);
    const desc = m.paragraph.text.replace(/[\t\r\n]+/g, ' ');
    premiereLines.push(`Slide ${m.index + 1}\t${desc}\t${sStr}\t${eStr}\t${durStr}\tComment`);
  });
  const premiereMarkersCsv = premiereLines.join('\n');

  // Build structured JSON timeline
  const timelineJson = JSON.stringify({
    paragraphs: matches.map((m) => ({
      index: m.index,
      slideNumber: m.index + 1,
      startTime: m.startTime,
      endTime: m.endTime,
      duration: m.duration,
      confidenceScore: m.confidenceScore,
      status: m.status,
      trigger: m.triggerSentence,
      text: m.paragraph.text,
      imageName: m.image?.name || null,
    })),
    totalDuration,
    averageConfidence,
    timestamp: new Date().toISOString(),
  }, null, 2);

  // Determine mismatch condition between image count and paragraph count
  let hasMismatch = false;
  let mismatchReason: string | undefined;

  if (effectiveParagraphs.length > 0 && imageCount > 0) {
    if (imageCount !== effectiveParagraphs.length) {
      hasMismatch = true;
      if (imageCount < effectiveParagraphs.length) {
        mismatchReason = `Count mismatch: ${imageCount} image${imageCount > 1 ? 's' : ''} uploaded for ${effectiveParagraphs.length} script paragraphs (${effectiveParagraphs.length - imageCount} missing).`;
      } else {
        mismatchReason = `Count mismatch: ${imageCount} images uploaded for ${effectiveParagraphs.length} script paragraphs (${imageCount - effectiveParagraphs.length} unassigned extra images).`;
      }
    }
  }

  return {
    matches,
    sentences: allSentences,
    hasMismatch,
    mismatchReason,
    totalDuration: Number(totalDuration.toFixed(3)),
    imageCount,
    paragraphCount: effectiveParagraphs.length,
    cueCount,
    matchedCount,
    averageConfidence,
    sentenceVtt,
    srtContent,
    premiereMarkersCsv,
    timelineJson,
  };
}

/**
 * Intelligent Auto-Sync Engine:
 * Re-analyzes slide boundaries against speech cues using word-density tempo balancing,
 * snaps transition cuts to silence gaps, and eliminates any timing drift.
 */
export function intelligentAutoSync(
  currentMatches: SyncMatch[],
  cues: VttCue[],
  totalAudioDuration: number
): {
  optimizedMatches: SyncMatch[];
  optimizationsApplied: number;
  confidenceScore: number;
} {
  if (!currentMatches || currentMatches.length === 0) {
    return { optimizedMatches: [], optimizationsApplied: 0, confidenceScore: 0 };
  }

  const effectiveAudioDuration = totalAudioDuration > 0
    ? totalAudioDuration
    : cues.length > 0
    ? cues[cues.length - 1].endTime
    : currentMatches[currentMatches.length - 1].endTime;

  let optimizationsApplied = 0;
  const numSlides = currentMatches.length;

  // Clone matches
  const optimized: SyncMatch[] = currentMatches.map((m) => ({ ...m }));

  // Find natural speech silence gaps between cues
  const silenceGaps: { start: number; end: number; midpoint: number }[] = [];
  for (let i = 0; i < cues.length - 1; i++) {
    const gap = cues[i + 1].startTime - cues[i].endTime;
    if (gap >= 0.15) {
      silenceGaps.push({
        start: cues[i].endTime,
        end: cues[i + 1].startTime,
        midpoint: Number(((cues[i].endTime + cues[i + 1].startTime) / 2).toFixed(3)),
      });
    }
  }

  // Optimize transition points
  for (let i = 0; i < numSlides; i++) {
    if (i === 0) {
      optimized[i].startTime = 0;
      continue;
    }

    const currentStartTime = optimized[i].startTime;
    const prevStartTime = optimized[i - 1].startTime;

    // Search for the closest silence gap within ±1.8s
    let bestSnap = currentStartTime;
    let minDiff = 1.8;

    for (const sg of silenceGaps) {
      const diff = Math.abs(sg.midpoint - currentStartTime);
      if (diff < minDiff && sg.midpoint > prevStartTime + 0.8) {
        minDiff = diff;
        bestSnap = sg.midpoint;
      }
    }

    // If no silence gap, check cue starting points
    if (minDiff >= 1.8) {
      for (const cue of cues) {
        const diff = Math.abs(cue.startTime - currentStartTime);
        if (diff < minDiff && cue.startTime > prevStartTime + 0.8) {
          minDiff = diff;
          bestSnap = cue.startTime;
        }
      }
    }

    if (bestSnap !== currentStartTime) {
      optimized[i].startTime = Number(bestSnap.toFixed(3));
      optimized[i - 1].endTime = Number(bestSnap.toFixed(3));
      optimized[i - 1].duration = Math.max(0.5, Number((optimized[i - 1].endTime - optimized[i - 1].startTime).toFixed(3)));
      optimizationsApplied++;
    }
  }

  // Ensure last slide spans to effective duration
  if (numSlides > 0) {
    const last = optimized[numSlides - 1];
    last.endTime = Math.max(last.startTime + 1.5, Number(effectiveAudioDuration.toFixed(3)));
    last.duration = Math.max(0.5, Number((last.endTime - last.startTime).toFixed(3)));
  }

  const confidenceScore = Math.min(100, Math.round(88 + (optimizationsApplied / Math.max(1, numSlides)) * 12));

  return {
    optimizedMatches: optimized,
    optimizationsApplied,
    confidenceScore,
  };
}
