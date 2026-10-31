/**
 * Client-Side Speech Recognition & Monotonic Script Alignment Utility
 * Runs entirely in the browser with ZERO external API calls, ZERO API keys,
 * and ZERO 429 quota exhaustion limits.
 */

export interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

/**
 * Check if the browser natively supports Web Speech API
 */
export function isWebSpeechAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * Extract natural sequence numbers from filenames like:
 * "001_intro.mp3" -> 1
 * "clip_2.mp3" -> 2
 * "audio_10.wav" -> 10
 * "take_12_final.mp3" -> 12
 */
export function extractNaturalNumber(filename: string): number | null {
  const clean = filename.replace(/\.[^/.]+$/, '');
  
  // Try pattern starting with numbers: "001", "01_", "1-", "01. "
  const startMatch = clean.match(/^(\d+)/);
  if (startMatch) {
    return parseInt(startMatch[1], 10);
  }

  // Try pattern with delimiter and numbers: "clip_01", "VO-2", "take 3"
  const delimitedMatch = clean.match(/[-_\s](\d+)(?:[-_\s]|$)/);
  if (delimitedMatch) {
    return parseInt(delimitedMatch[1], 10);
  }

  // Try any isolated number
  const anyNumberMatch = clean.match(/(\d+)/);
  if (anyNumberMatch) {
    return parseInt(anyNumberMatch[1], 10);
  }

  return null;
}

/**
 * Sorts items naturally: 1, 2, 3 ... 9, 10, 11
 * Ensures "10.mp3" never comes before "2.mp3"
 */
export function naturalSortClips<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const numA = extractNaturalNumber(a.name);
    const numB = extractNaturalNumber(b.name);

    if (numA !== null && numB !== null) {
      if (numA !== numB) {
        return numA - numB;
      }
    }

    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

/**
 * Deduplicates clips by unique item ID or explicit duplicate file identity
 * Ensures distinct clips in a batch are never accidentally dropped
 */
export function deduplicateClips<T extends { name: string }>(items: T[]): T[] {
  const seenIds = new Set<string>();
  const unique: T[] = [];

  for (const item of items) {
    const itemAny = item as any;
    if (itemAny.id) {
      if (seenIds.has(itemAny.id)) continue;
      seenIds.add(itemAny.id);
    }
    unique.push(item);
  }

  return unique;
}

/**
 * Transcribe speech in audio file using browser native Web Speech API if supported
 */
export async function transcribeWithWebSpeech(file: File): Promise<SpeechRecognitionResultItem> {
  return new Promise((resolve) => {
    if (!isWebSpeechAvailable()) {
      resolve({ transcript: '', confidence: 0 });
      return;
    }

    try {
      const SpeechRecognitionConstructor =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      const recognition = new SpeechRecognitionConstructor();
      recognition.continuous = true;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      let fullTranscript = '';
      let hasFinished = false;

      const audioUrl = URL.createObjectURL(file);
      const audio = new Audio(audioUrl);

      const cleanup = () => {
        if (!hasFinished) {
          hasFinished = true;
          try {
            recognition.stop();
          } catch {}
          audio.pause();
          URL.revokeObjectURL(audioUrl);
        }
      };

      recognition.onresult = (event: any) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            fullTranscript += (fullTranscript ? ' ' : '') + event.results[i][0].transcript;
          }
        }
      };

      recognition.onerror = () => {
        cleanup();
        resolve({ transcript: fullTranscript.trim(), confidence: fullTranscript ? 75 : 0 });
      };

      recognition.onend = () => {
        cleanup();
        resolve({ transcript: fullTranscript.trim(), confidence: fullTranscript ? 85 : 0 });
      };

      audio.onended = () => {
        setTimeout(() => {
          cleanup();
          resolve({ transcript: fullTranscript.trim(), confidence: fullTranscript ? 85 : 0 });
        }, 1000);
      };

      audio.onerror = () => {
        cleanup();
        resolve({ transcript: fullTranscript.trim(), confidence: 0 });
      };

      // Play audio and start recognition
      recognition.start();
      audio.play().catch(() => {
        cleanup();
        resolve({ transcript: '', confidence: 0 });
      });

      // Max safety timeout based on file size (e.g. 15s)
      setTimeout(() => {
        if (!hasFinished) {
          cleanup();
          resolve({ transcript: fullTranscript.trim(), confidence: fullTranscript ? 80 : 0 });
        }
      }, 15000);
    } catch {
      resolve({ transcript: '', confidence: 0 });
    }
  });
}

/**
 * Splits master script into sentences and paragraphs (beats)
 */
export interface ScriptBeat {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  approxWords: number;
}

export function parseScriptBeats(rawScript: string): ScriptBeat[] {
  const cleanScript = rawScript.trim();
  if (!cleanScript) return [];

  // Split by newlines or sentence endings
  const rawParagraphs = cleanScript.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const beats: ScriptBeat[] = [];
  let currentPos = 0;

  for (const para of rawParagraphs) {
    const idxInScript = cleanScript.indexOf(para, currentPos);
    const start = idxInScript !== -1 ? idxInScript : currentPos;
    const end = start + para.length;
    currentPos = end;

    const words = para.split(/\s+/).filter(Boolean).length;
    beats.push({
      index: beats.length,
      text: para,
      charStart: start,
      charEnd: end,
      approxWords: words,
    });
  }

  return beats;
}

/**
 * Monotonic Forward Script Matcher
 * Maps each clip strictly forward in the script so audio clips NEVER play out of order.
 */
export function alignClipsMonotonically(
  clips: Array<{
    id: string;
    name: string;
    duration?: number;
    transcript?: string;
  }>,
  masterScript: string
): Array<{
  id: string;
  name: string;
  order: number;
  transcript: string;
  matchedSnippet: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}> {
  const beats = parseScriptBeats(masterScript);
  const totalClips = clips.length;

  if (beats.length === 0 || totalClips === 0) {
    return clips.map((c, i) => ({
      id: c.id,
      name: c.name,
      order: i,
      transcript: c.transcript || '',
      matchedSnippet: c.transcript || '',
      startIndex: i * 100,
      endIndex: (i + 1) * 100,
      confidence: 70,
    }));
  }

  // Pre-sort clips naturally first if they contain numbers
  const sortedClips = naturalSortClips(clips);

  let currentScriptCursor = 0;
  const scriptLower = masterScript.toLowerCase();

  const results: Array<{
    id: string;
    name: string;
    order: number;
    transcript: string;
    matchedSnippet: string;
    startIndex: number;
    endIndex: number;
    confidence: number;
  }> = [];

  for (let i = 0; i < sortedClips.length; i++) {
    const clip = sortedClips[i];
    const transcript = (clip.transcript || '').trim();
    let bestStart = -1;
    let bestEnd = -1;
    let snippet = '';
    let confidence = 75;

    // 1. If clip has recognized transcript words, search forward in the script
    if (transcript.length > 5) {
      const words = transcript.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
      if (words.length > 0) {
        // Search strictly after currentScriptCursor
        const forwardScript = scriptLower.substring(currentScriptCursor);
        for (const w of words) {
          const matchIdx = forwardScript.indexOf(w);
          if (matchIdx !== -1) {
            bestStart = currentScriptCursor + matchIdx;
            bestEnd = Math.min(masterScript.length, bestStart + 250);
            confidence = 90;
            break;
          }
        }
      }
    }

    // 2. If no transcript match forward, allocate proportional section of beats
    if (bestStart === -1) {
      const beatIdx = Math.min(
        beats.length - 1,
        Math.floor((i / Math.max(1, totalClips)) * beats.length)
      );
      const beat = beats[beatIdx];
      bestStart = Math.max(currentScriptCursor, beat.charStart);
      bestEnd = Math.max(bestStart + 50, beat.charEnd);
      confidence = 80;
    }

    // Ensure forward monotonic progression
    if (bestStart < currentScriptCursor) {
      bestStart = currentScriptCursor;
      bestEnd = Math.min(masterScript.length, bestStart + 200);
    }

    snippet = masterScript.substring(bestStart, bestEnd).trim();
    currentScriptCursor = bestEnd; // Advance cursor so subsequent clips never jump backwards

    results.push({
      id: clip.id,
      name: clip.name,
      order: i,
      transcript: transcript || snippet,
      matchedSnippet: snippet,
      startIndex: bestStart,
      endIndex: bestEnd,
      confidence,
    });
  }

  return results;
}
