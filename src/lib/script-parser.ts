import { ScriptParagraph } from './types';
import { normalizeForSearch } from './vtt-parser';

export type ScriptSplitMode = 'paragraph' | 'auto' | 'line' | 'sentence';

/**
 * Extracts the first complete sentence from a text block.
 * Looks for terminal punctuation (.?!。！？) or falls back to the first line.
 */
export function extractFirstSentence(text: string): string {
  if (!text) return '';
  const firstLine = text.split('\n')[0].trim();
  const match = firstLine.match(/^(.+?[.?!。！？۔؟])(?:\s+|$)/);
  if (match && match[1]) {
    return match[1].trim();
  }
  return firstLine;
}

/**
 * Splits raw script text into paragraphs (1 paragraph = 1 visual slide/scene).
 * Default and primary mode is 'paragraph' (\n\n), respecting the user's curated paragraph layout.
 */
export function parseScript(rawScript: string, mode: ScriptSplitMode = 'paragraph'): ScriptParagraph[] {
  if (!rawScript || !rawScript.trim()) return [];

  // Normalize all line endings
  const normalized = rawScript.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!normalized) return [];

  let rawChunks: string[] = [];

  if (mode === 'paragraph') {
    // Primary: split by one or more blank lines
    rawChunks = normalized.split(/\n\s*\n+/);
  } else if (mode === 'line') {
    rawChunks = normalized.split(/\n+/);
  } else if (mode === 'sentence') {
    rawChunks = normalized.split(/(?<=[.?!。！？])\s+/);
  } else {
    // Auto-detect mode: prefers paragraphs if double newlines exist
    if (/\n\s*\n+/.test(normalized)) {
      rawChunks = normalized.split(/\n\s*\n+/);
    } else if (/\n/.test(normalized)) {
      rawChunks = normalized.split(/\n+/);
    } else if (/(?<=[.?!。！？])\s+/.test(normalized)) {
      rawChunks = normalized.split(/(?<=[.?!。！？])\s+/);
    } else {
      rawChunks = [normalized];
    }
  }

  const paragraphs: ScriptParagraph[] = [];

  rawChunks.forEach((rawText) => {
    let text = rawText.trim();
    if (!text) return;

    // Clean optional paragraph prefixes like "[Paragraph 1]" or "Scene 1:" or "Slide 1:" if present
    text = text.replace(/^(?:\[?(?:paragraph|slide|scene|part)\s*\d+\]?:?\s*)/i, '').trim();
    if (!text) return;

    // Identify first line and first sentence
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const startingLine = lines[0] || text;
    const startingSentence = extractFirstSentence(text) || startingLine;

    // Tokenize paragraph into words
    const words = text
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    if (words.length === 0) return;

    // Tokenize first sentence into words
    const firstSentenceWords = startingSentence
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    // Anchor words: first 6-8 words of the first sentence (or full first sentence if shorter)
    const anchorWordCount = Math.min(8, Math.max(4, firstSentenceWords.length));
    const leadingWords = firstSentenceWords.slice(0, anchorWordCount);

    const searchPhrase = normalizeForSearch(leadingWords.join(' '));
    const fullSearchPhrase = normalizeForSearch(startingSentence);

    paragraphs.push({
      id: `p-${paragraphs.length + 1}`,
      index: paragraphs.length,
      text,
      cleanText: text.replace(/\s+/g, ' '),
      startingLine,
      startingSentence,
      words,
      firstSentenceWords,
      leadingWords,
      searchPhrase,
      fullSearchPhrase,
    });
  });

  return paragraphs;
}

