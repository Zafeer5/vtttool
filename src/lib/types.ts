export interface WordTimestamp {
  word: string;
  start: number; // in seconds
  end: number;   // in seconds
}

export interface VttCue {
  id: string;
  startTime: number; // in seconds
  endTime: number;   // in seconds
  duration: number;  // in seconds
  text: string;
  cleanText: string;
  rawHeader?: string;
  words?: WordTimestamp[];
}

export interface ScriptParagraph {
  id: string;
  index: number; // 0-based
  text: string;
  cleanText: string;
  startingLine: string; // first line or sentence of the paragraph
  startingSentence: string; // first complete sentence of the paragraph
  words: string[];
  firstSentenceWords: string[]; // words of the first sentence
  leadingWords: string[]; // first 4-8 words of starting sentence
  searchPhrase: string;
  fullSearchPhrase?: string;
}

export interface ImageItem {
  id: string;
  file?: File;
  name: string;
  previewUrl: string;
  size?: number;
  width?: number;
  height?: number;
}

export type MatchConfidence = 'exact' | 'high' | 'fuzzy' | 'fallback' | 'manual';

export interface ScriptSentence {
  id: string;
  paragraphIndex: number;
  sentenceIndexInParagraph: number;
  overallSentenceIndex: number;
  text: string;
  cleanText: string;
  startTime: number;
  endTime: number;
  duration: number;
  confidence: MatchConfidence;
  matchedCue?: VttCue | null;
  warning?: string;
}

export type TranscriptionLevel = 'chunk' | 'word' | 'sentence';

export type MatchedScriptType = string;

export interface TranscriptVersion {
  label: string;
  language: string;
  text: string;
  cues: VttCue[];
  vtt: string;
}

export type SyncMode = 'vtt_driven' | 'audio_script' | 'manual' | 'guided_auto';

export type SyncStatus =
  | 'confirmed'
  | 'auto_high'
  | 'needs_review'
  | 'unmatched'
  | 'exact'
  | 'high_confidence'
  | 'medium_confidence'
  | 'low_confidence_flagged'
  | 'manual';

export interface ReviewQueueItem {
  id: string;
  slideIndex: number;
  slideId: string;
  type: 'missing_image' | 'low_confidence' | 'gap_or_overlap' | 'unmatched_paragraph';
  severity: 'error' | 'warning' | 'info';
  title: string;
  description: string;
  timeRange: string;
}

export interface ParallelTranscripts {
  [key: string]: unknown;
}

export interface SyncMatch {
  id?: string; // Stable unique ID (e.g. `slide_1_timestamp`)
  index: number; // 0-based
  image: ImageItem | null;
  zoomSeed?: number;
  zoomDirection?: Exclude<ZoomDirection, 'random'>;
  paragraph: ScriptParagraph;
  matchedCue: VttCue | null;
  matchedCues?: VttCue[]; // Multi-cue support for paragraphs spanning multiple subtitle cues
  startTime: number; // in seconds
  endTime: number;   // in seconds
  duration: number;  // in seconds (endTime - startTime)
  confidence: MatchConfidence;
  confidenceScore?: number; // 0-100 percentage
  status?: SyncStatus;
  isManualEdit?: boolean; // When true, prevents automatic recalculation from silently overwriting user adjustments
  syncMode?: SyncMode;
  startFrame?: number; // 30fps quantization
  endFrame?: number;
  frameCount?: number;
  matchedScript?: MatchedScriptType;
  searchPhrase: string;
  triggerSentence?: string; // the starting sentence or opening words that triggered this match
  matchedTextSnippet?: string;
  semanticMatchReason?: string; // e.g. "Matched filename keyword: intro"
  warning?: string;
  sentences?: ScriptSentence[]; // individual sentence timings within this paragraph
  speechEndTime?: number; // when speech concluded before pause
  pauseDuration?: number; // silence gap before next paragraph
}

export interface SyncAnalysis {
  matches: SyncMatch[];
  sentences?: ScriptSentence[]; // all individual sentence timings extracted from voiceover
  hasMismatch: boolean;
  mismatchReason?: string;
  totalDuration: number;
  imageCount: number;
  paragraphCount: number;
  cueCount: number;
  matchedCount: number;
  averageConfidence?: number;
  sentenceVtt?: string;
  srtContent?: string;
  premiereMarkersCsv?: string;
  timelineJson?: string;
}

export type ExportMode = 'single' | 'clips_zip';

export type RenderStage = 
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'loading-ffmpeg'
  | 'encoding'
  | 'finalizing'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'interrupted';

export interface RenderStats {
  currentFrame?: number;
  totalFrames?: number;
  fps?: number;
  speed?: string;
  bitrate?: string;
  time?: string;
}

export interface RenderProgress {
  stage: RenderStage;
  percentage: number;
  message: string;
  logs: string[];
  error?: string;
  outputBlob?: Blob;
  outputUrl?: string;
  outputSize?: number;
  renderedDuration?: number;
  exportMode?: ExportMode;
  clipCount?: number;
  stats?: RenderStats;
  jobId?: string | null;
  savedDestinationPath?: string;
}

export interface QueueRenderItem {
  id: string;
  serverJobId?: string;
  title: string;
  outputFileName: string;
  exportMode: ExportMode;
  resolution: string;
  slideCount: number;
  duration: number;
  createdAt: number;
  status: 'queued' | 'preparing' | 'rendering' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  progress: number;
  message: string;
  stats?: RenderStats;
  logs: string[];
  error?: string;
  outputBlob?: Blob | null;
  outputUrl?: string | null;
  downloadUrl?: string | null;
  outputSize?: number;
  savedDestinationPath?: string;
  autoDownload?: boolean;
}

export type TransitionType = 
  | 'dissolve' 
  | 'fadein' 
  | 'fadeout' 
  | 'wipe-left' 
  | 'wipe-right' 
  | 'wipe-random';

export type ZoomDirection = 'random' | 'in' | 'out';
export const DEFAULT_ZOOM_INTENSITY = 2;

export interface MotionSettings {
  enabled: boolean;              // Master toggle: if false, 0 overhead & exact original performance
  zoomEnabled: boolean;          // Zoom effect toggle
  zoomIntensity: number;         // percentage
  zoomDirection: ZoomDirection;  // 'random' | 'in' | 'out'
  transitionEnabled: boolean;    // Transition effect toggle
  transitionType: TransitionType;// 'dissolve' (default) | 'fadein' | 'fadeout' | 'wipe-left' | 'wipe-right' | 'wipe-random'
  transitionDuration: number;    // in seconds, e.g. 0.6s
}

export const DEFAULT_MOTION_SETTINGS: MotionSettings = {
  enabled: false,                // Optional toggle: disabled by default for untouched performance
  zoomEnabled: false,
  zoomIntensity: DEFAULT_ZOOM_INTENSITY,
  zoomDirection: 'random',       // Randomly zoom-in or zoom-out per slide
  transitionEnabled: true,
  transitionType: 'dissolve',    // Default transition is dissolve
  transitionDuration: 0.6,
};

export type LogoPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'custom';

export interface LogoSettings {
  enabled: boolean;
  file?: File | null;
  previewUrl?: string | null;
  name?: string;
  position: LogoPosition;
  opacity: number;      // 0.2 to 1.0 (default 0.9)
  scale: number;        // percentage of video width, e.g. 15 for 15% (default 15)
  margin: number;       // distance in pixels from edges (default 24)
  customX?: number;     // percentage 0-100 when position is custom
  customY?: number;     // percentage 0-100 when position is custom
}

export const DEFAULT_LOGO_SETTINGS: LogoSettings = {
  enabled: false,
  file: null,
  previewUrl: null,
  name: '',
  position: 'top-right',
  opacity: 0.9,
  scale: 15,
  margin: 24,
};

export interface RenderedVideoItem {
  id: string;
  title: string;
  filename: string;
  createdAt: string;
  expiresAt: string;
  duration: number;
  slideCount: number;
  resolution: string;
  fileSizeBytes: number;
  downloadUrl: string;
  streamUrl: string;
  thumbnailUrl?: string;
  hasThumbnail?: boolean;
  exportMode?: ExportMode;
}

export interface ProjectItem {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  activeStep: number;
  rawScript: string;
  scriptSplitMode: 'paragraph' | 'auto' | 'line' | 'sentence';
  rawVtt: string;
  voiceoverFileName?: string;
  voiceoverDuration?: number;
  voiceoverUrl?: string | null;
  images: ImageItem[];
  selectedResolution: string;
  exportMode: ExportMode;
  outputFileName: string;
  selectedFolder: string;
  autoDownloadEnabled: boolean;
  motionSettings?: MotionSettings;
  logoSettings?: LogoSettings;
  syncMode?: SyncMode;
  cues?: VttCue[];
  paragraphs?: ScriptParagraph[];
  parallelTranscripts?: ParallelTranscripts | null;
  slideDurations?: number[];
}
