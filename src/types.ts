export type AppMode = 'single' | 'batch' | 'smart_ai' | 'subtitles';

export type ExportFormat = 'wav' | 'mp3' | 'aac';

export interface SrtCue {
  id: number;
  startTime: string; // "00:00:01,200"
  endTime: string;   // "00:00:04,500"
  startSeconds: number;
  endSeconds: number;
  text: string;
}

export interface SilenceRegion {
  id: string;
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
}

export interface KeepRegion {
  start: number; // in seconds
  end: number;   // in seconds
  duration: number; // in seconds
}

export interface AudioProcessingSettings {
  thresholdDb: number; // e.g. -40 dB (range -60 to -15)
  minSilenceDurationMs: number; // e.g. 300 ms (range 100 to 2000)
  paddingMs: number; // e.g. 80 ms (range 0 to 300)
  keepMinSilenceMs: number; // optional pause retention e.g. 50ms so speech sounds natural
}

export interface ProcessingMetrics {
  originalDuration: number; // in seconds
  cleanedDuration: number; // in seconds
  timeRemoved: number; // in seconds
  percentageRemoved: number; // e.g. 24.5%
  silenceCount: number;
  speechRatio: number; // e.g. 75.5%
}

export interface ProcessedAudioState {
  originalFile: File | null;
  originalFileName: string;
  originalFileType: string;
  originalFileSize: number;
  originalBuffer: AudioBuffer | null;
  cleanedBuffer: AudioBuffer | null;
  silenceRegions: SilenceRegion[];
  keepRegions: KeepRegion[];
  metrics: ProcessingMetrics | null;
  cleanedWavBlob: Blob | null;
  cleanedWavUrl: string | null;
  originalAudioUrl: string | null;
}

export type PresetType = 'podcast' | 'fast_talk' | 'conservative' | 'aggressive' | 'custom';

export interface PresetOption {
  id: PresetType;
  name: string;
  description: string;
  settings: AudioProcessingSettings;
}

export type InterClipGapMs = 0 | 100 | 250 | 500;

export interface BatchItem {
  id: string;
  file: File;
  name: string;
  size: number;
  originalBuffer: AudioBuffer | null;
  cleanedBuffer: AudioBuffer | null;
  originalDuration: number;
  cleanedDuration: number;
  silenceRemovedSec: number;
  silenceCount: number;
  status: 'pending' | 'processing' | 'ready' | 'error';
  error?: string;
  archiveName?: string;
  transcript?: string;
  matchedSnippet?: string;
  scriptIndex?: number;
  matchConfidence?: number;
  isTranscribing?: boolean;
}

export interface ScriptAlignedClip {
  id: string;
  name: string;
  order: number;
  transcript: string;
  matchedSnippet: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}

export interface ScriptAlignmentResult {
  alignedClips: ScriptAlignedClip[];
  missingScriptSections: string[];
  coveragePercentage: number;
  script: string;
}

export interface BatchMergeMetrics {
  originalTotalDuration: number;
  cleanedTotalDuration: number;
  totalSilenceRemoved: number;
  clipsMergedCount: number;
}

export type SmartEditType = 'filler_um' | 'filler_uh' | 'repeat' | 'breath';

export interface SmartEditItem {
  id: string;
  type: SmartEditType;
  label: string;
  textSnippet: string;
  start: number;
  end: number;
  duration: number;
  status: 'pending' | 'removed' | 'kept';
}

export interface GenerationHistoryItem {
  id: string;
  timestamp: number;
  formattedDate: string;
  title: string;
  mode: AppMode;
  audioBlob: Blob;
  duration: number; // in seconds
  fileSize: number; // in bytes
  originalDuration: number;
  cleanedDuration: number;
  timeRemoved: number;
  percentageRemoved: number;
  silenceCount?: number;
  clipsCount?: number;
  settingsSummary: string;
  presetName?: string;
}

