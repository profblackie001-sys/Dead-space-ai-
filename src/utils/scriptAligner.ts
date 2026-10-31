import { BatchItem, ScriptAlignedClip, ScriptAlignmentResult } from '../types';
import {
  naturalSortClips,
  deduplicateClips,
  extractNaturalNumber,
  alignClipsMonotonically,
} from './clientSpeechRecognizer';

export { naturalSortClips, deduplicateClips, extractNaturalNumber, alignClipsMonotonically };

/**
 * Converts a File or Blob to a Base64 string (without the data URL prefix)
 */
export async function fileToBase64(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1] || result;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Calls server Gemini API to transcribe an audio clip and match against full script
 */
export async function transcribeAndMatchClipWithGemini(
  file: File,
  script: string
): Promise<{
  transcript: string;
  matchedSnippet: string;
  startIndex: number;
  endIndex: number;
  confidence: number;
}> {
  const base64 = await fileToBase64(file);
  const mimeType = file.type || 'audio/mp3';

  const response = await fetch('/api/transcribe-and-match-clip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      audioBase64: base64,
      mimeType,
      script,
      fileName: file.name,
    }),
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.success && json.data) {
    return {
      transcript: json.data.transcript || '',
      matchedSnippet: json.data.matchedSnippet || '',
      startIndex: typeof json.data.startIndex === 'number' ? json.data.startIndex : 0,
      endIndex: typeof json.data.endIndex === 'number' ? json.data.endIndex : 0,
      confidence: typeof json.data.confidence === 'number' ? json.data.confidence : 85,
    };
  }

  throw new Error(json.message || 'Gemini transcription unavailable');
}

/**
 * Calls server Gemini API to align already transcribed clips with master script
 */
export async function alignTranscriptsWithGemini(
  script: string,
  clips: { id: string; name: string; transcript: string }[]
): Promise<ScriptAlignmentResult> {
  const response = await fetch('/api/align-script-transcripts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ script, clips }),
  });

  if (!response.ok) {
    throw new Error(`Server returned HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.success && json.data && Array.isArray(json.data.orderedClipIds)) {
    const orderedIds: string[] = json.data.orderedClipIds;
    const alignmentsMap = new Map<string, any>();
    if (Array.isArray(json.data.alignments)) {
      json.data.alignments.forEach((a: any) => alignmentsMap.set(a.id, a));
    }

    const alignedClips: ScriptAlignedClip[] = [];
    orderedIds.forEach((id, index) => {
      const clip = clips.find((c) => c.id === id);
      const align = alignmentsMap.get(id);
      if (clip) {
        alignedClips.push({
          id: clip.id,
          name: clip.name,
          order: index,
          transcript: clip.transcript,
          matchedSnippet: align?.matchedSnippet || clip.transcript,
          startIndex: typeof align?.startIndex === 'number' ? align.startIndex : index * 100,
          endIndex: typeof align?.endIndex === 'number' ? align.endIndex : (index + 1) * 100,
          confidence: typeof align?.confidence === 'number' ? align.confidence : 90,
        });
      }
    });

    // Catch any clips that were omitted from orderedClipIds
    clips.forEach((c) => {
      if (!alignedClips.some((ac) => ac.id === c.id)) {
        alignedClips.push({
          id: c.id,
          name: c.name,
          order: alignedClips.length,
          transcript: c.transcript,
          matchedSnippet: c.transcript,
          startIndex: 999999,
          endIndex: 999999,
          confidence: 50,
        });
      }
    });

    return {
      alignedClips,
      missingScriptSections: json.data.missingScriptSections || [],
      coveragePercentage: json.data.coveragePercentage || 95,
      script,
    };
  }

  throw new Error(json.message || 'Gemini alignment unavailable');
}

/**
 * Extracts Fish Audio or TTS chunk anchor words from a filename and locates its exact range in the script.
 * Examples of Fish Audio chunk formats:
 * - "Right......orn a.mp3" (Start: "Right", End: "orn a")
 * - "Let's......was s.mp3" (Start: "Let's", End: "was s")
 * - "Health-Insights-Voice-2026-10-02-09-01-So-here's-..."
 */
export function matchClipByFishAudioFilename(
  filename: string,
  script: string
): {
  startIndex: number;
  endIndex: number;
  matchedSnippet: string;
  confidence: number;
  isFishAudioFormat: boolean;
} {
  const cleanScript = script.trim();

  // Build exact 1-to-1 character index map from normalized text back to original script
  const normIndices: number[] = [];
  let normScript = '';
  let inSpace = false;

  for (let i = 0; i < cleanScript.length; i++) {
    const ch = cleanScript[i];
    if (ch === "'" || ch === '’') {
      continue;
    }
    const lower = ch.toLowerCase();
    if ((lower >= 'a' && lower <= 'z') || (lower >= '0' && lower <= '9')) {
      normScript += lower;
      normIndices.push(i);
      inSpace = false;
    } else {
      if (!inSpace && normScript.length > 0) {
        normScript += ' ';
        normIndices.push(i);
        inSpace = true;
      }
    }
  }

  // Strip extension
  let base = filename.replace(/\.[^/.]+$/, '').trim();
  // Strip automated date or voice prefix (e.g. "Health-Insights-Voice-2026-10-02-09-01-")
  base = base.replace(/^[a-zA-Z0-9_-]+Voice-[0-9-]+-/, '');
  base = base.replace(/^[a-zA-Z0-9_-]+-[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9-]+-/, '');

  const isFishAudioFormat = base.includes('..');
  let rawPrefix = '';
  let rawSuffix = '';

  if (isFishAudioFormat) {
    const parts = base.split(/\.{2,}/).map((p) => p.trim()).filter(Boolean);
    rawPrefix = parts[0] || '';
    rawSuffix = parts[1] || '';
  } else {
    rawPrefix = base.replace(/[_-]/g, ' ');
  }

  const cleanPrefix = rawPrefix.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]/g, ' ').trim();
  const cleanSuffix = rawSuffix.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]/g, ' ').trim();

  // Strip leading track indicators like "01", "chunk 1", "take 02", "clip 3" from prefix
  const strippedPrefix = cleanPrefix
    .replace(/^(\d+|chunk\s*\d+|take\s*\d+|part\s*\d+|clip\s*\d+|track\s*\d+|vo\s*\d+)[\s._-]+/i, '')
    .trim();
  const activePrefix = strippedPrefix.length >= 3 ? strippedPrefix : cleanPrefix;

  let pPos = -1;
  let sPos = -1;
  let matchConfidence = 40;

  // 1. Dual anchor search for Fish Audio / TTS chunks
  if (isFishAudioFormat && activePrefix.length >= 2 && cleanSuffix.length >= 2) {
    const isSentenceStart = (origIdx: number): boolean => {
      if (origIdx <= 0) return true;
      const lookback = cleanScript.substring(Math.max(0, origIdx - 15), origIdx).trim();
      if (lookback.length === 0) return true;
      const lastChar = lookback[lookback.length - 1];
      return /[.!?\n—–-]/.test(lastChar);
    };

    let pSearch = 0;
    const pPositions: number[] = [];
    while (pSearch < normScript.length) {
      const idx = normScript.indexOf(activePrefix, pSearch);
      if (idx === -1) break;
      pPositions.push(idx);
      pSearch = idx + 1;
    }

    let bestScore = Infinity;
    for (const p of pPositions) {
      const window = normScript.substring(p, Math.min(normScript.length, p + 950));
      const sOffset = window.indexOf(cleanSuffix);
      if (sOffset !== -1 && sOffset >= 2) {
        const sEnd = p + sOffset + cleanSuffix.length;
        const dist = sEnd - p;
        const isStart = isSentenceStart(normIndices[p] || 0);
        const score = Math.abs(dist - 350) + (isStart ? 0 : 5000);
        if (score < bestScore) {
          bestScore = score;
          pPos = p;
          sPos = sEnd;
          matchConfidence = isStart ? 99 : 85;
        }
      }
    }

    // Reverse search from suffix if needed
    if (pPos === -1 && cleanSuffix.length >= 3) {
      let sSearch = 0;
      while (sSearch < normScript.length) {
        const foundS = normScript.indexOf(cleanSuffix, sSearch);
        if (foundS === -1) break;
        sSearch = foundS + 1;

        const backWindowStart = Math.max(0, foundS - 950);
        const backWindow = normScript.substring(backWindowStart, foundS);
        const pOffset = backWindow.lastIndexOf(activePrefix);
        if (pOffset !== -1 && (foundS - (backWindowStart + pOffset)) >= 2) {
          const candP = backWindowStart + pOffset;
          const isStart = isSentenceStart(normIndices[candP] || 0);
          if (isStart || pPos === -1) {
            pPos = candP;
            sPos = foundS + cleanSuffix.length;
            matchConfidence = isStart ? 98 : 88;
            if (isStart) break;
          }
        }
      }
    }
  }

  // 2. Single anchor or slug / title match
  if (pPos === -1 && activePrefix.length >= 3) {
    const isSentenceStart = (origIdx: number): boolean => {
      if (origIdx <= 0) return true;
      const lookback = cleanScript.substring(Math.max(0, origIdx - 15), origIdx).trim();
      if (lookback.length === 0) return true;
      const lastChar = lookback[lookback.length - 1];
      return /[.!?\n—–-]/.test(lastChar);
    };

    let pSearch = 0;
    const candidates: number[] = [];
    while (pSearch < normScript.length) {
      const idx = normScript.indexOf(activePrefix, pSearch);
      if (idx === -1) break;
      candidates.push(idx);
      pSearch = idx + 1;
    }

    let chosen = -1;
    for (const c of candidates) {
      if (isSentenceStart(normIndices[c] || 0)) {
        chosen = c;
        break;
      }
    }
    if (chosen === -1 && candidates.length > 0) {
      chosen = candidates[0];
    }

    if (chosen !== -1) {
      pPos = chosen;
      sPos = Math.min(normScript.length, chosen + activePrefix.length + 300);
      matchConfidence = 88;
    } else {
      // Multi-word phrase search: try 6 words down to 2 words, or 1 non-stopword
      const STOP_WORDS = new Set([
        'you', 'your', 'yours', 'the', 'a', 'an', 'and', 'then', 'in', 'it', 'its',
        'to', 'is', 'are', 'was', 'were', 'of', 'for', 'on', 'with', 'at', 'by',
        'from', 'be', 'this', 'that', 'but', 'so', 'or', 'if', 'as', 'into', 'some'
      ]);
      const pTokens = activePrefix.split(/\s+/).filter(Boolean);
      if (pTokens.length > 0) {
        for (let n = Math.min(pTokens.length, 6); n >= 1; n--) {
          const phraseWords = pTokens.slice(0, n);
          if (n === 1 && (phraseWords[0].length < 4 || STOP_WORDS.has(phraseWords[0]))) {
            continue;
          }
          const phrase = phraseWords.join(' ');
          const phraseRegex = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
          const match = phraseRegex.exec(cleanScript);
          if (match) {
            return {
              startIndex: match.index,
              endIndex: Math.min(cleanScript.length, match.index + Math.max(100, phrase.length + 80)),
              matchedSnippet: cleanScript.substring(match.index, Math.min(cleanScript.length, match.index + Math.max(100, phrase.length + 80))).trim(),
              confidence: n >= 3 ? 92 : (n === 2 ? 80 : 65),
              isFishAudioFormat,
            };
          }
        }
      }
    }
  }

  if (pPos !== -1 && normIndices.length > 0) {
    const origStart = normIndices[Math.min(normIndices.length - 1, pPos)];
    const endTargetPos = sPos !== -1 ? sPos - 1 : Math.min(normScript.length - 1, pPos + activePrefix.length + 250);
    let origEnd = normIndices[Math.min(normIndices.length - 1, endTargetPos)] + 1;

    // Extend to punctuation boundary (. ! ? \n)
    if (cleanScript.length - origStart <= 600) {
      origEnd = cleanScript.length;
    } else {
      const remaining = cleanScript.substring(origEnd, Math.min(cleanScript.length, origEnd + 60));
      const endPunct = remaining.search(/[.!?\n]/);
      if (endPunct !== -1 && endPunct <= 50) {
        origEnd += endPunct + 1;
      }
    }

    const snippet = cleanScript.substring(origStart, origEnd).trim();
    return {
      startIndex: origStart,
      endIndex: origEnd,
      matchedSnippet: snippet,
      confidence: matchConfidence,
      isFishAudioFormat,
    };
  }

  return {
    startIndex: -1,
    endIndex: -1,
    matchedSnippet: '',
    confidence: 40,
    isFishAudioFormat,
  };
}

/**
 * Robust client-side fuzzy text matching and alignment algorithm.
 * Used when Gemini API key is missing, offline, or experiencing high load.
 */
export function heuristicFuzzyMatchScript(
  script: string,
  clips: {
    id: string;
    name: string;
    transcript: string;
    startIndex?: number;
    endIndex?: number;
    confidence?: number;
    matchedSnippet?: string;
  }[]
): ScriptAlignmentResult {
  const cleanScript = script.trim();
  const scriptLower = cleanScript.toLowerCase();

  // Keep all input clips intact (every clip in batch must be aligned and preserved)
  const uniqueInputClips = clips;

  // Helper to extract clean alphanumeric words while keeping short words like "in", "to", "on"
  const getCleanWords = (str: string): string[] => {
    return str
      .toLowerCase()
      .replace(/['’]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
  };

  const scriptWords = getCleanWords(cleanScript);
  const scriptJoined = scriptWords.join(' ');

  // Break script into sentences
  const sentenceRegex = /[^.!?\n]+[.!?\n]+/g;
  const scriptSentences: { text: string; start: number; end: number; words: string[] }[] = [];
  let match: RegExpExecArray | null;

  while ((match = sentenceRegex.exec(cleanScript)) !== null) {
    const text = match[0].trim();
    if (text.length > 3) {
      scriptSentences.push({
        text,
        start: match.index,
        end: match.index + match[0].length,
        words: getCleanWords(text),
      });
    }
  }

  if (scriptSentences.length === 0 && cleanScript.length > 0) {
    scriptSentences.push({
      text: cleanScript,
      start: 0,
      end: cleanScript.length,
      words: scriptWords,
    });
  }

  // INDEPENDENT MATCHING PHASE FOR EACH CLIP
  // Every clip searches the entire script independently so out-of-order clips don't block each other
  const matchedClips: Array<ScriptAlignedClip & { naturalNum: number | null }> = uniqueInputClips.map((clip, origIndex) => {
    const naturalNum = extractNaturalNumber(clip.name);

    // 1. If clip already has exact valid verified offsets
    if (
      typeof clip.startIndex === 'number' &&
      clip.startIndex >= 0 &&
      typeof clip.endIndex === 'number' &&
      clip.endIndex > clip.startIndex
    ) {
      const snippet = clip.matchedSnippet || cleanScript.substring(clip.startIndex, clip.endIndex);
      return {
        id: clip.id,
        name: clip.name,
        order: origIndex,
        transcript: clip.transcript || snippet,
        matchedSnippet: snippet,
        startIndex: clip.startIndex,
        endIndex: clip.endIndex,
        confidence: clip.confidence || 95,
        naturalNum,
      };
    }

    // 2. Transcript Search (if transcript exists)
    const transcript = (clip.transcript || '').trim();
    if (transcript.length > 2) {
      const transLower = transcript.toLowerCase();
      // Try direct substring search in script
      const directSearchText = transLower.substring(0, Math.min(50, transLower.length));
      const directPos = scriptLower.indexOf(directSearchText);
      if (directPos !== -1) {
        const endPos = Math.min(cleanScript.length, directPos + transcript.length + 30);
        const snippet = cleanScript.substring(directPos, endPos).trim();
        return {
          id: clip.id,
          name: clip.name,
          order: origIndex,
          transcript,
          matchedSnippet: snippet,
          startIndex: directPos,
          endIndex: endPos,
          confidence: 98,
          naturalNum,
        };
      }

      // Word phrase n-gram search
      const transWords = getCleanWords(transcript);
      if (transWords.length >= 2) {
        for (let n = Math.min(6, transWords.length); n >= 2; n--) {
          const phrase = transWords.slice(0, n).join(' ');
          const pIdx = scriptJoined.indexOf(phrase);
          if (pIdx !== -1) {
            const approxChar = Math.floor((pIdx / Math.max(1, scriptJoined.length)) * cleanScript.length);
            const closestSentence = scriptSentences.find(
              (s) => Math.abs(s.start - approxChar) < 80
            );
            const startChar = closestSentence ? closestSentence.start : approxChar;
            const endChar = Math.min(cleanScript.length, startChar + transcript.length + 40);
            const snippet = cleanScript.substring(startChar, endChar).trim();
            return {
              id: clip.id,
              name: clip.name,
              order: origIndex,
              transcript,
              matchedSnippet: snippet,
              startIndex: startChar,
              endIndex: endChar,
              confidence: 94,
              naturalNum,
            };
          }
        }
      }
    }

    // 3. Filename Search (Fish Audio chunks or descriptive filenames)
    // 3a. Fish Audio Anchor Match
    const anchorMatch = matchClipByFishAudioFilename(clip.name, cleanScript);
    if (anchorMatch.startIndex !== -1 && anchorMatch.confidence >= 65) {
      return {
        id: clip.id,
        name: clip.name,
        order: origIndex,
        transcript: transcript || anchorMatch.matchedSnippet,
        matchedSnippet: anchorMatch.matchedSnippet,
        startIndex: anchorMatch.startIndex,
        endIndex: anchorMatch.endIndex,
        confidence: anchorMatch.confidence,
        naturalNum,
      };
    }

    // 3b. Descriptive Filename prefix words against script words
    const cleanBaseName = clip.name.replace(/\.[^/.]+$/, '').split(/\.{2,}/)[0];
    const baseWords = getCleanWords(cleanBaseName);
    if (baseWords.length >= 2) {
      for (let n = Math.min(5, baseWords.length); n >= 2; n--) {
        const phrase = baseWords.slice(0, n).join(' ');
        const pIdx = scriptJoined.indexOf(phrase);
        if (pIdx !== -1) {
          const approxChar = Math.floor((pIdx / Math.max(1, scriptJoined.length)) * cleanScript.length);
          const closestSentence = scriptSentences.find(
            (s) => Math.abs(s.start - approxChar) < 80
          );
          const startChar = closestSentence ? closestSentence.start : approxChar;
          const endChar = Math.min(cleanScript.length, startChar + 150);
          const snippet = cleanScript.substring(startChar, endChar).trim();
          return {
            id: clip.id,
            name: clip.name,
            order: origIndex,
            transcript: transcript || snippet,
            matchedSnippet: snippet,
            startIndex: startChar,
            endIndex: endChar,
            confidence: 88,
            naturalNum,
          };
        }
      }
    }

    // 4. Keyword / Jaccard similarity across script sentences
    const searchWords = getCleanWords(transcript || clip.name);
    let bestScore = 0;
    let bestSentence = scriptSentences[0];

    for (const sent of scriptSentences) {
      let common = 0;
      for (const w of searchWords) {
        if (sent.words.includes(w)) common++;
      }
      const score = common / (searchWords.length + sent.words.length - common + 0.01);
      if (score > bestScore) {
        bestScore = score;
        bestSentence = sent;
      }
    }

    if (bestScore > 0.08 && bestSentence) {
      return {
        id: clip.id,
        name: clip.name,
        order: origIndex,
        transcript: transcript || bestSentence.text,
        matchedSnippet: bestSentence.text,
        startIndex: bestSentence.start,
        endIndex: bestSentence.end,
        confidence: Math.min(90, Math.round(bestScore * 150)),
        naturalNum,
      };
    }

    // 5. Unmatched fallback
    return {
      id: clip.id,
      name: clip.name,
      order: origIndex,
      transcript: transcript || clip.name,
      matchedSnippet: clip.name,
      startIndex: -1,
      endIndex: -1,
      confidence: 30,
      naturalNum,
    };
  });

  // STEP 2: SORTING
  // Sort matched clips by startIndex.
  // If unmatched (-1) or identical start, fall back to natural numeric ordering or original order.
  matchedClips.sort((a, b) => {
    const aMatched = a.startIndex >= 0;
    const bMatched = b.startIndex >= 0;

    if (aMatched && bMatched) {
      if (a.startIndex !== b.startIndex) {
        return a.startIndex - b.startIndex;
      }
      // If same startIndex, use natural numbers if present
      if (a.naturalNum !== null && b.naturalNum !== null) {
        return a.naturalNum - b.naturalNum;
      }
      return a.order - b.order;
    }

    if (aMatched && !bMatched) return -1;
    if (!aMatched && bMatched) return 1;

    // Neither matched to script: use natural numbers or filename sort
    if (a.naturalNum !== null && b.naturalNum !== null) {
      return a.naturalNum - b.naturalNum;
    }
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  // STEP 3: Assign sequential monotonic order (0, 1, 2...)
  const alignedClips: ScriptAlignedClip[] = matchedClips.map((clip, idx) => ({
    id: clip.id,
    name: clip.name,
    order: idx,
    transcript: clip.transcript,
    matchedSnippet: clip.matchedSnippet,
    startIndex: clip.startIndex >= 0 ? clip.startIndex : idx * 50,
    endIndex: clip.endIndex >= 0 ? clip.endIndex : (idx + 1) * 50,
    confidence: clip.confidence,
  }));

  // Identify genuine missing sentences (checking span coverage across all clips)
  const missingScriptSections: string[] = [];
  scriptSentences.forEach((sent) => {
    // A sentence is covered if ANY aligned clip overlaps its span or contains its text
    const isCovered = alignedClips.some((ac) => {
      if (ac.startIndex <= sent.start + 15 && ac.endIndex >= sent.end - 15) {
        return true;
      }
      const sentSnippet = sent.text.toLowerCase().substring(0, 25);
      return ac.matchedSnippet.toLowerCase().includes(sentSnippet);
    });

    if (!isCovered && sent.text.length > 20) {
      missingScriptSections.push(sent.text);
    }
  });

  const totalSentences = Math.max(1, scriptSentences.length);
  const coveredSentences = totalSentences - missingScriptSections.length;
  const coveragePercentage = Math.round((coveredSentences / totalSentences) * 100);

  return {
    alignedClips,
    missingScriptSections,
    coveragePercentage,
    script,
  };
}

/**
 * Maps clips 1-to-1 against sentences or paragraphs of the master script in strict chronological sequence.
 * Ideal for multi-clip voiceovers (e.g. 52 takes or chunks) where clips correspond to ordered story sections.
 */
export function alignClipsToScriptSequentially(
  script: string,
  clips: { id: string; name: string; transcript?: string }[]
): ScriptAlignmentResult {
  const cleanScript = script.trim();
  if (!cleanScript || clips.length === 0) {
    return {
      alignedClips: clips.map((c, idx) => ({
        id: c.id,
        name: c.name,
        order: idx,
        transcript: c.transcript || c.name,
        matchedSnippet: c.name,
        startIndex: idx * 50,
        endIndex: (idx + 1) * 50,
        confidence: 80,
      })),
      missingScriptSections: [],
      coveragePercentage: 100,
      script,
    };
  }

  // First sort input clips by their natural number or existing order so they match chronological chunks
  const orderedClips = [...clips].sort((a, b) => {
    const numA = extractNaturalNumber(a.name);
    const numB = extractNaturalNumber(b.name);
    if (numA !== null && numB !== null) return numA - numB;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  // Extract paragraphs and sentences
  const paragraphs = cleanScript.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
  const sentences: { text: string; start: number; end: number }[] = [];
  
  const sentenceRegex = /[^.!?\n]+(?:[.!?\n]+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceRegex.exec(cleanScript)) !== null) {
    const text = match[0].trim();
    if (text.length > 0) {
      sentences.push({
        text,
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  const units = paragraphs.length >= orderedClips.length * 0.7 && paragraphs.length <= orderedClips.length * 1.5
    ? paragraphs.map((p) => {
        const start = cleanScript.indexOf(p);
        return { text: p.trim(), start, end: start + p.length };
      })
    : sentences;

  const totalUnits = Math.max(1, units.length);
  const totalClips = Math.max(1, orderedClips.length);

  const alignedClips: ScriptAlignedClip[] = orderedClips.map((clip, idx) => {
    const unitStartIdx = Math.floor(idx * (totalUnits / totalClips));
    const unitEndIdx = Math.min(totalUnits, Math.floor((idx + 1) * (totalUnits / totalClips)));

    const slice = units.slice(unitStartIdx, Math.max(unitStartIdx + 1, unitEndIdx));
    const combinedSnippet = slice.map((u) => u.text).join(' ').trim();
    const startChar = slice[0]?.start ?? Math.floor(idx * (cleanScript.length / totalClips));
    const endChar = slice[slice.length - 1]?.end ?? Math.min(cleanScript.length, Math.floor((idx + 1) * (cleanScript.length / totalClips)));

    return {
      id: clip.id,
      name: clip.name,
      order: idx,
      transcript: clip.transcript || combinedSnippet || clip.name,
      matchedSnippet: combinedSnippet || clip.name,
      startIndex: startChar,
      endIndex: endChar,
      confidence: 96,
    };
  });

  return {
    alignedClips,
    missingScriptSections: [],
    coveragePercentage: 100,
    script,
  };
}

/**
 * Sample voiceover script & demo text for creators using Fish Audio / ElevenLabs
 */
export const SAMPLE_FISHAUDIO_DEMO = {
  script: `Welcome back to the studio. In this episode, we are diving deep into neural voiceover generation.

First, let's explore why splitting scripts into clips is necessary due to character boundaries in text-to-speech tools.

Next, notice how dead air and awkward pauses between sentences degrade listener retention if left untrimmed.

Finally, by automatically aligning transcripts to the original script and stripping out silence, you obtain one cohesive broadcast-ready track.`,
  clips: [
    {
      name: 'voice_take_chunk_03_next.mp3',
      transcript: 'Next, notice how dead air and awkward pauses between sentences degrade listener retention if left untrimmed.',
    },
    {
      name: 'voice_take_chunk_01_intro.mp3',
      transcript: 'Welcome back to the studio. In this episode, we are diving deep into neural voiceover generation.',
    },
    {
      name: 'voice_take_chunk_04_outro.mp3',
      transcript: 'Finally, by automatically aligning transcripts to the original script and stripping out silence, you obtain one cohesive broadcast-ready track.',
    },
    {
      name: 'voice_take_chunk_02_first.mp3',
      transcript: "First, let's explore why splitting scripts into clips is necessary due to character boundaries in text-to-speech tools.",
    },
  ],
};
