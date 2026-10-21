import { VttCue } from './types';

/**
 * Parses a timestamp string (e.g. "00:01:23.456" or "01:23.456" or "00:01:23,456") into seconds.
 */
export function parseTimestampToSeconds(timestampStr: string): number {
  const normalized = timestampStr.trim().replace(',', '.');
  const parts = normalized.split(':');
  
  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseFloat(parts[0]) || 0;
    const minutes = parseFloat(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    // MM:SS.mmm
    const minutes = parseFloat(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  } else if (parts.length === 1) {
    return parseFloat(parts[0]) || 0;
  }
  return 0;
}

/**
 * Formats seconds into MM:SS.mmm or HH:MM:SS.mmm string.
 */
export function formatSecondsToTimestamp(totalSeconds: number, includeHours = false): string {
  if (isNaN(totalSeconds) || totalSeconds < 0) totalSeconds = 0;
  
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  
  const pad = (num: number, size = 2) => String(num).padStart(size, '0');
  const formattedSeconds = seconds.toFixed(3);
  const [secWhole, secMilli] = formattedSeconds.split('.');
  
  if (includeHours || hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(parseInt(secWhole, 10))}.${secMilli}`;
  }
  return `${pad(minutes)}:${pad(parseInt(secWhole, 10))}.${secMilli}`;
}

/**
 * Strips HTML-like tags and WebVTT cue tags (<v Voice>, <b>, <i>, <00:01.000>, etc.).
 */
export function stripVttTags(text: string): string {
  return text
    .replace(/<[^>]+>/g, '') // remove all HTML / VTT tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/**
 * Fast Levenshtein distance for fuzzy word spelling adjustment.
 */
export function levenshteinDistance(s1: string, s2: string): number {
  if (s1 === s2) return 0;
  if (s1.length === 0) return s2.length;
  if (s2.length === 0) return s1.length;

  const m = s1.length;
  const n = s2.length;
  const d: number[] = new Array(n + 1);

  for (let j = 0; j <= n; j++) d[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = d[0];
    d[0] = i;
    const c1 = s1.charCodeAt(i - 1);

    for (let j = 1; j <= n; j++) {
      const temp = d[j];
      const cost = c1 === s2.charCodeAt(j - 1) ? 0 : 1;
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }

  return d[n];
}

/**
 * Universal single-word normalizer for English speech recognition & script alignment.
 */
export function normalizeWordForMatching(word: string): string {
  if (!word) return '';
  return word.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Checks if two words match, accounting for English spelling, contractions, and minor typos.
 */
export function isFuzzyWordMatch(w1: string, w2: string): boolean {
  if (!w1 || !w2) return false;
  const n1 = normalizeWordForMatching(w1);
  const n2 = normalizeWordForMatching(w2);
  if (n1 === n2) return true;
  if (!n1 || !n2) return false;

  const minLen = Math.min(n1.length, n2.length);
  if (minLen >= 3 && levenshteinDistance(n1, n2) <= 1) return true;
  if (minLen >= 6 && levenshteinDistance(n1, n2) <= 2) return true;

  return false;
}

/**
 * Normalizes text for matching (lowercase, no punctuation, normalized spaces).
 */
export function normalizeForSearch(text: string): string {
  if (!text) return '';
  return stripVttTags(text)
    .toLowerCase()
    .replace(/[^\w\s\d]/g, ' ') // replace punctuation with space
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses raw WebVTT content into an array of VttCue objects.
 */
export function parseVtt(content: string): VttCue[] {
  if (!content) return [];

  // Normalize line breaks
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const cues: VttCue[] = [];
  
  let i = 0;
  // Skip WEBVTT header and any comments until first cue
  while (i < lines.length) {
    const line = lines[i].trim();
    if (line.includes('-->')) {
      break;
    }
    i++;
  }

  // Enhanced Regex to match standard or flexible timestamp arrows:
  // "00:00:00.000 --> 00:00:04.500", "00:00.000 -> 00:04.500", "00:00:01,000 --> 00:00:04,500"
  const timeRegex = /((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*(?:-->|->|—>)\s*((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      continue;
    }

    // Check if this line is an identifier or timestamp
    let cueId = `cue-${cues.length + 1}`;
    let timeLine = line;

    if (!line.includes('-->') && !line.includes('->') && !line.includes('—>')) {
      // Possible cue identifier (e.g. "1", "2" in SRT or cue ID)
      cueId = line;
      i++;
      if (i >= lines.length) break;
      timeLine = lines[i].trim();
    }

    const match = timeLine.match(timeRegex);
    if (!match) {
      // Check bracketed timestamp format: "[00:02.500] Some text"
      const bracketMatch = line.match(/^\[((?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\]\s*(.*)$/);
      if (bracketMatch) {
        const startStr = bracketMatch[1];
        const text = bracketMatch[2].trim();
        const startTime = parseTimestampToSeconds(startStr);
        // Estimate end time until next cue or +3s
        cues.push({
          id: `cue-${cues.length + 1}`,
          startTime,
          endTime: startTime + 3.0,
          duration: 3.0,
          text,
          cleanText: stripVttTags(text),
          rawHeader: line,
        });
      }
      i++;
      continue;
    }

    const startStr = match[1];
    const endStr = match[2];
    const startTime = parseTimestampToSeconds(startStr);
    const endTime = parseTimestampToSeconds(endStr);
    const duration = Math.max(0, endTime - startTime);

    i++;
    // Gather all text lines until next blank line or next timestamp
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== '') {
      if (lines[i].includes('-->') || lines[i].includes('->')) {
        break; // Guard against missing blank line
      }
      textLines.push(lines[i]);
      i++;
    }

    const rawText = textLines.join('\n');
    const clean = stripVttTags(rawText);

    cues.push({
      id: cueId,
      startTime,
      endTime,
      duration,
      text: rawText,
      cleanText: clean,
      rawHeader: timeLine,
    });
  }

  // If bracketed cues were used, adjust their end times to match next cue's start time
  for (let j = 0; j < cues.length - 1; j++) {
    if (cues[j].endTime > cues[j + 1].startTime) {
      cues[j].endTime = cues[j + 1].startTime;
      cues[j].duration = Math.max(0.2, cues[j].endTime - cues[j].startTime);
    }
  }

  // Ensure cues are sorted chronologically
  cues.sort((a, b) => a.startTime - b.startTime);

  return cues;
}

/**
 * High-quality sample English WebVTT template for instant testing and demonstration.
 */
export const SAMPLE_ENGLISH_VTT = `WEBVTT

1
00:00:00.000 --> 00:00:03.200
In this video we will discuss

2
00:00:03.200 --> 00:00:06.500
an important key to success.

3
00:00:07.100 --> 00:00:10.800
How positive thinking can change

4
00:00:10.800 --> 00:00:13.900
your daily life completely.

5
00:00:14.600 --> 00:00:18.200
When you focus on your goals

6
00:00:18.200 --> 00:00:21.500
success will naturally follow.

7
00:00:22.200 --> 00:00:25.800
Staying determined in difficult times

8
00:00:25.800 --> 00:00:28.400
is your greatest true strength.

9
00:00:29.100 --> 00:00:33.500
Consistent effort always leads you forward.`;

/**
 * Ensures text has a WEBVTT header and standard dot-decimal timestamps for WebVTT compatibility.
 * Automatically converts SRT comma decimals (00:00:01,000) to dot decimals (00:00:01.000).
 */
export function ensureWebVttFormat(content: string): string {
  if (!content) return 'WEBVTT\n\n';
  const trimmed = content.trim();
  const withDots = trimmed.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  if (withDots.toUpperCase().startsWith('WEBVTT')) {
    return withDots;
  }
  return `WEBVTT\n\n${withDots}`;
}

export interface VttValidationIssue {
  type: 'error' | 'warning';
  cueId?: string;
  cueIndex?: number;
  message: string;
}

export interface VttValidationResult {
  isValid: boolean;
  issues: VttValidationIssue[];
  totalDuration: number;
  cueCount: number;
}

/**
 * Validates an array of VTT cues for errors (negative durations, malformed timestamps)
 * and warnings (out-of-order cues, overlaps, speech extending beyond audio track).
 */
export function validateVttCues(cues: VttCue[], audioDuration?: number): VttValidationResult {
  const issues: VttValidationIssue[] = [];

  if (cues.length === 0) {
    issues.push({
      type: 'warning',
      message: 'No subtitle cues were found in the VTT file.',
    });
  }

  let prevEndTime = 0;
  let maxEndTime = 0;

  cues.forEach((cue, index) => {
    // 1. Negative or zero duration
    if (cue.endTime <= cue.startTime) {
      issues.push({
        type: 'error',
        cueId: cue.id,
        cueIndex: index,
        message: `Cue ${index + 1} (${cue.id}) has invalid duration: start (${cue.startTime.toFixed(2)}s) >= end (${cue.endTime.toFixed(2)}s).`,
      });
    }

    // 2. Out-of-order cues
    if (index > 0 && cue.startTime < cues[index - 1].startTime) {
      issues.push({
        type: 'warning',
        cueId: cue.id,
        cueIndex: index,
        message: `Cue ${index + 1} starts earlier (${cue.startTime.toFixed(2)}s) than Cue ${index} (${cues[index - 1].startTime.toFixed(2)}s).`,
      });
    }

    // 3. Overlapping cues
    if (index > 0 && cue.startTime < prevEndTime - 0.05) {
      issues.push({
        type: 'warning',
        cueId: cue.id,
        cueIndex: index,
        message: `Cue ${index + 1} overlaps previous cue by ${(prevEndTime - cue.startTime).toFixed(2)}s.`,
      });
    }

    // 4. Empty cue text
    if (!cue.cleanText && !cue.text) {
      issues.push({
        type: 'warning',
        cueId: cue.id,
        cueIndex: index,
        message: `Cue ${index + 1} has empty subtitle text.`,
      });
    }

    if (cue.endTime > maxEndTime) {
      maxEndTime = cue.endTime;
    }
    prevEndTime = Math.max(prevEndTime, cue.endTime);
  });

  // 5. Cues outside audio duration
  if (audioDuration && audioDuration > 0 && maxEndTime > audioDuration + 0.5) {
    issues.push({
      type: 'warning',
      message: `Subtitles extend ${(maxEndTime - audioDuration).toFixed(1)}s beyond audio duration (${audioDuration.toFixed(1)}s).`,
    });
  }

  const hasErrors = issues.some((i) => i.type === 'error');
  return {
    isValid: !hasErrors,
    issues,
    totalDuration: maxEndTime,
    cueCount: cues.length,
  };
}
