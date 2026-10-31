import { BatchItem, SrtCue } from '../types';

/**
 * Formats a duration in seconds into standard SRT timestamp format: HH:MM:SS,mmm
 * Example: 65.45 -> "00:01:05,450"
 */
export function formatSrtTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const h = hrs.toString().padStart(2, '0');
  const m = mins.toString().padStart(2, '0');
  const s = secs.toString().padStart(2, '0');
  const ms = millis.toString().padStart(3, '0');

  return `${h}:${m}:${s},${ms}`;
}

/**
 * Formats a duration in seconds into WebVTT timestamp format: HH:MM:SS.mmm
 * Example: 65.45 -> "00:01:05.450"
 */
export function formatVttTimestamp(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) seconds = 0;
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  const millis = Math.floor((seconds % 1) * 1000);

  const h = hrs.toString().padStart(2, '0');
  const m = mins.toString().padStart(2, '0');
  const s = secs.toString().padStart(2, '0');
  const ms = millis.toString().padStart(3, '0');

  return `${h}:${m}:${s}.${ms}`;
}

/**
 * Parses timestamp string "HH:MM:SS,mmm" or "HH:MM:SS.mmm" or "MM:SS.mmm" into seconds
 */
export function parseTimestampToSeconds(timeStr: string): number {
  if (!timeStr) return 0;
  const normalized = timeStr.trim().replace(',', '.');
  const parts = normalized.split(':');

  if (parts.length === 3) {
    const h = parseFloat(parts[0]) || 0;
    const m = parseFloat(parts[1]) || 0;
    const s = parseFloat(parts[2]) || 0;
    return h * 3600 + m * 60 + s;
  } else if (parts.length === 2) {
    const m = parseFloat(parts[0]) || 0;
    const s = parseFloat(parts[1]) || 0;
    return m * 60 + s;
  }
  return parseFloat(normalized) || 0;
}

/**
 * Parses raw SRT string into array of structured SrtCue objects
 */
export function parseSrt(rawSrt: string): SrtCue[] {
  if (!rawSrt || !rawSrt.trim()) return [];

  const cues: SrtCue[] = [];
  // Normalize line endings
  const normalized = rawSrt.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n\n+/);

  let fallbackId = 1;
  for (const block of blocks) {
    const lines = block.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) continue;

    let timecodeLineIndex = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('-->')) {
        timecodeLineIndex = i;
        break;
      }
    }

    if (timecodeLineIndex === -1) continue;

    const idStr = timecodeLineIndex > 0 ? lines[0] : String(fallbackId);
    const id = parseInt(idStr, 10) || fallbackId++;

    const [startStr, endStr] = lines[timecodeLineIndex].split('-->').map((s) => s.trim());
    if (!startStr || !endStr) continue;

    const startSeconds = parseTimestampToSeconds(startStr);
    const endSeconds = parseTimestampToSeconds(endStr);

    const textLines = lines.slice(timecodeLineIndex + 1);
    const text = textLines.join('\n').trim();

    if (text) {
      cues.push({
        id,
        startTime: formatSrtTimestamp(startSeconds),
        endTime: formatSrtTimestamp(endSeconds),
        startSeconds,
        endSeconds,
        text,
      });
    }
  }

  return cues;
}

/**
 * Converts array of SrtCues into standard SRT text format
 */
export function buildSrt(cues: SrtCue[]): string {
  if (!cues || cues.length === 0) return '';

  return cues
    .map((cue, idx) => {
      const id = idx + 1;
      const start = cue.startTime || formatSrtTimestamp(cue.startSeconds);
      const end = cue.endTime || formatSrtTimestamp(cue.endSeconds);
      return `${id}\n${start} --> ${end}\n${cue.text.trim()}\n`;
    })
    .join('\n');
}

/**
 * Converts array of SrtCues into WebVTT text format
 */
export function buildVtt(cues: SrtCue[]): string {
  if (!cues || cues.length === 0) return 'WEBVTT\n\n';

  let vtt = 'WEBVTT - DeadSpace AI Generated Subtitles\n\n';
  cues.forEach((cue, idx) => {
    const id = idx + 1;
    const start = formatVttTimestamp(cue.startSeconds);
    const end = formatVttTimestamp(cue.endSeconds);
    vtt += `${id}\n${start} --> ${end}\n${cue.text.trim()}\n\n`;
  });

  return vtt;
}

/**
 * Splits a sentence or long paragraph into readable caption chunks (1-2 lines, ~6-10 words each)
 */
export function chunkTextIntoCaptionSegments(text: string, maxWords: number = 8): string[] {
  if (!text || !text.trim()) return [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return [words.join(' ')];

  const chunks: string[] = [];
  let current: string[] = [];

  for (let i = 0; i < words.length; i++) {
    current.push(words[i]);
    const word = words[i];
    // Natural break on punctuation
    const hasPunctuation = /[.,!?;:]$/.test(word);

    if (
      (current.length >= maxWords) ||
      (current.length >= Math.floor(maxWords * 0.7) && hasPunctuation)
    ) {
      chunks.push(current.join(' '));
      current = [];
    }
  }

  if (current.length > 0) {
    if (chunks.length > 0 && current.length <= 2) {
      // Merge tiny dangling word onto last chunk
      chunks[chunks.length - 1] += ' ' + current.join(' ');
    } else {
      chunks.push(current.join(' '));
    }
  }

  return chunks;
}

/**
 * Generates millisecond-accurate SRT cues from arranged batch items and audio duration
 */
export function generateSrtFromBatchItems(
  items: BatchItem[],
  gapMs: number = 100,
  referenceScript?: string
): { srtText: string; cues: SrtCue[] } {
  const cues: SrtCue[] = [];
  let currentTimelineSeconds = 0;
  let cueId = 1;
  const gapSeconds = gapMs / 1000;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const duration = item.cleanedDuration || item.originalDuration || 5;
    const clipStartSeconds = currentTimelineSeconds;
    const clipEndSeconds = clipStartSeconds + duration;

    // Determine the text to subtitle: matchedSnippet > transcript > filename
    const textContent =
      item.matchedSnippet ||
      item.transcript ||
      item.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');

    // Chunk the text into readable subtitle blocks
    const chunks = chunkTextIntoCaptionSegments(textContent, 8);
    const chunkCount = Math.max(1, chunks.length);
    const chunkDuration = duration / chunkCount;

    for (let c = 0; c < chunkCount; c++) {
      const startSec = clipStartSeconds + c * chunkDuration;
      const endSec = Math.min(clipEndSeconds, startSec + chunkDuration);

      cues.push({
        id: cueId++,
        startTime: formatSrtTimestamp(startSec),
        endTime: formatSrtTimestamp(endSec),
        startSeconds: startSec,
        endSeconds: endSec,
        text: chunks[c] || textContent,
      });
    }

    currentTimelineSeconds = clipEndSeconds + gapSeconds;
  }

  const srtText = buildSrt(cues);
  return { srtText, cues };
}

/**
 * Generates YouTube Chapters text from SRT cues or script sections
 */
export function generateYouTubeChapters(
  cues: SrtCue[],
  intervalSeconds: number = 30
): string {
  if (!cues || cues.length === 0) return '';

  const chapters: { time: string; title: string }[] = [];
  let lastChapterTime = -intervalSeconds;

  cues.forEach((cue) => {
    if (cue.startSeconds - lastChapterTime >= intervalSeconds) {
      const minutes = Math.floor(cue.startSeconds / 60);
      const seconds = Math.floor(cue.startSeconds % 60);
      const formatted = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      
      // Clean title from first 5 words of cue
      const words = cue.text.split(/\s+/).slice(0, 5).join(' ').replace(/[.,!?;:]/g, '');
      const title = words.length > 0 ? words : 'Section';

      chapters.push({ time: formatted, title });
      lastChapterTime = cue.startSeconds;
    }
  });

  return chapters.map((c) => `${c.time} ${c.title}`).join('\n');
}

/**
 * Triggers a browser download of a text file (SRT, VTT, TXT)
 */
export function downloadTextFile(content: string, filename: string, mimeType: string = 'text/plain') {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
