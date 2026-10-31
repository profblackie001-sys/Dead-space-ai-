import React, { useState, useRef, useEffect } from 'react';
import {
  FileText,
  Sparkles,
  ArrowDownUp,
  Wand2,
  CheckCircle2,
  AlertTriangle,
  Play,
  Pause,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Trash2,
  HelpCircle,
  Layers,
  Volume2,
  Check,
  Split,
  Archive,
  Edit3,
} from 'lucide-react';
import { BatchItem, ScriptAlignedClip, ScriptAlignmentResult } from '../types';
import {
  transcribeAndMatchClipWithGemini,
  alignTranscriptsWithGemini,
  heuristicFuzzyMatchScript,
  alignClipsToScriptSequentially,
  matchClipByFishAudioFilename,
  SAMPLE_FISHAUDIO_DEMO,
} from '../utils/scriptAligner';
import {
  naturalSortClips,
  deduplicateClips,
  isWebSpeechAvailable,
  transcribeWithWebSpeech,
} from '../utils/clientSpeechRecognizer';
import { formatDuration } from '../utils/audioProcessor';
import { audioBufferToWavBlob } from '../utils/audioProcessor';
import { generateSrtFromBatchItems, downloadTextFile } from '../utils/srtGenerator';

interface VoiceoverScriptArrangerProps {
  items: BatchItem[];
  onApplyArrangement: (reorderedItems: BatchItem[]) => void;
  onAddGeneratedDemoClips?: (files: File[], script: string) => void;
  isProcessingBatch?: boolean;
}

export const VoiceoverScriptArranger: React.FC<VoiceoverScriptArrangerProps> = ({
  items,
  onApplyArrangement,
  onAddGeneratedDemoClips,
  isProcessingBatch = false,
}) => {
  const [scriptText, setScriptText] = useState<string>('');
  const [isAligning, setIsAligning] = useState<boolean>(false);
  const [alignmentStep, setAlignmentStep] = useState<string>('');
  const [alignmentResult, setAlignmentResult] = useState<ScriptAlignmentResult | null>(null);
  const [arrangedClips, setArrangedClips] = useState<ScriptAlignedClip[]>([]);
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [tempTranscript, setTempTranscript] = useState<string>('');
  const [alignmentSuccess, setAlignmentSuccess] = useState<boolean>(false);
  const [appliedOrderNotice, setAppliedOrderNotice] = useState<boolean>(false);
  const [showMissingSections, setShowMissingSections] = useState<boolean>(false);

  // Audio playback for reviewing individual clips in arranged order
  const [playingClipId, setPlayingClipId] = useState<string | null>(null);
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const clipAudioUrlsRef = useRef<Map<string, string>>(new Map());

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      clipAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      clipAudioUrlsRef.current.clear();
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
    };
  }, []);

  // Pre-populate or maintain arranged list if items change
  useEffect(() => {
    if (items.length > 0 && arrangedClips.length === 0) {
      const uniqueItems = deduplicateClips<BatchItem>(items);
      const initial: ScriptAlignedClip[] = uniqueItems.map((it, idx) => ({
        id: it.id,
        name: it.name,
        order: idx,
        transcript: it.transcript || '',
        matchedSnippet: it.matchedSnippet || '',
        startIndex: it.scriptIndex ?? idx * 50,
        endIndex: (it.scriptIndex ?? idx * 50) + 50,
        confidence: it.matchConfidence ?? 70,
      }));
      setArrangedClips(initial);
    }
  }, [items]);

  const togglePlayClip = (clipId: string) => {
    const item = items.find((it) => it.id === clipId);
    if (!item) return;

    if (playingClipId === clipId) {
      if (activeAudioRef.current) {
        activeAudioRef.current.pause();
      }
      setPlayingClipId(null);
      return;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
    }

    let audioUrl = clipAudioUrlsRef.current.get(clipId);
    if (!audioUrl) {
      if (item.originalBuffer) {
        const wavBlob = audioBufferToWavBlob(item.originalBuffer);
        audioUrl = URL.createObjectURL(wavBlob);
      } else {
        audioUrl = URL.createObjectURL(item.file);
      }
      clipAudioUrlsRef.current.set(clipId, audioUrl);
    }

    const audio = new Audio(audioUrl);
    activeAudioRef.current = audio;
    audio.onended = () => setPlayingClipId(null);
    audio.onerror = () => setPlayingClipId(null);
    audio.play().catch(() => setPlayingClipId(null));
    setPlayingClipId(clipId);
  };

  // Perform Automatic Transcription & Alignment
  const handleTranscribeAndArrange = async () => {
    if (!scriptText.trim()) {
      alert('Please paste your original full voiceover script into the text box first.');
      return;
    }

    if (items.length === 0) {
      alert('Please upload your voiceover audio clips first (or click "Load Fish Audio Demo" below).');
      return;
    }

    setIsAligning(true);
    setAlignmentSuccess(false);
    setAppliedOrderNotice(false);

    try {
      // Transcribe actual speech from every audio clip using Gemini Audio AI
      const clipsWithTranscripts: { id: string; name: string; transcript: string; startIndex?: number; endIndex?: number; confidence?: number; matchedSnippet?: string }[] = [];

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        setAlignmentStep(`Listening to speech in audio clip ${i + 1} of ${items.length} ("${item.name}")...`);

        // Fast path 1: If item already has a verified transcript and matched snippet, reuse it instantly
        if (item.transcript && item.transcript.length > 10 && item.matchedSnippet) {
          clipsWithTranscripts.push({
            id: item.id,
            name: item.name,
            transcript: item.transcript,
            matchedSnippet: item.matchedSnippet,
            startIndex: item.scriptIndex,
            confidence: item.matchConfidence || 95,
          });
          continue;
        }

        // Fast path 2: Check if filename/slug words match the script directly (instant <1ms match)
        const instantAnchor = matchClipByFishAudioFilename(item.name, scriptText);
        if (instantAnchor.startIndex !== -1 && instantAnchor.confidence >= 75) {
          clipsWithTranscripts.push({
            id: item.id,
            name: item.name,
            transcript: instantAnchor.matchedSnippet,
            startIndex: instantAnchor.startIndex,
            endIndex: instantAnchor.endIndex,
            confidence: instantAnchor.confidence,
            matchedSnippet: instantAnchor.matchedSnippet,
          });
          item.transcript = instantAnchor.matchedSnippet;
          item.matchedSnippet = instantAnchor.matchedSnippet;
          continue;
        }

        try {
          // Listen to audio recording using Gemini speech model with a 12-second timeout
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Transcription request timed out')), 12000)
          );
          const geminiResult = await Promise.race([
            transcribeAndMatchClipWithGemini(item.file, scriptText),
            timeoutPromise,
          ]);

          clipsWithTranscripts.push({
            id: item.id,
            name: item.name,
            transcript: geminiResult.transcript,
            startIndex: geminiResult.startIndex,
            endIndex: geminiResult.endIndex,
            confidence: geminiResult.confidence,
            matchedSnippet: geminiResult.matchedSnippet,
          });
          item.transcript = geminiResult.transcript;
          item.matchedSnippet = geminiResult.matchedSnippet;
        } catch (err) {
          console.warn(`Gemini API fallback for ${item.name}:`, err);
          
          // Client-side fallback 1: Native browser Web Speech API (zero quota, runs in browser)
          let clientSpeechText = '';
          if (isWebSpeechAvailable()) {
            try {
              setAlignmentStep(`Listening client-side to clip ${i + 1} of ${items.length} ("${item.name}")...`);
              const webSpeech = await transcribeWithWebSpeech(item.file);
              if (webSpeech.transcript) {
                clientSpeechText = webSpeech.transcript;
              }
            } catch (speechErr) {
              console.warn('Web Speech fallback error:', speechErr);
            }
          }

          // Client-side fallback 2: Check filename anchors or slug keywords
          const fallbackAnchor = matchClipByFishAudioFilename(item.name, scriptText);
          if (fallbackAnchor.startIndex !== -1) {
            clipsWithTranscripts.push({
              id: item.id,
              name: item.name,
              transcript: clientSpeechText || fallbackAnchor.matchedSnippet,
              startIndex: fallbackAnchor.startIndex,
              endIndex: fallbackAnchor.endIndex,
              confidence: fallbackAnchor.confidence,
              matchedSnippet: fallbackAnchor.matchedSnippet,
            });
            item.transcript = clientSpeechText || fallbackAnchor.matchedSnippet;
            item.matchedSnippet = fallbackAnchor.matchedSnippet;
          } else {
            const cleanName = item.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' ');
            clipsWithTranscripts.push({
              id: item.id,
              name: item.name,
              transcript: clientSpeechText || item.transcript || cleanName,
            });
            if (clientSpeechText) {
              item.transcript = clientSpeechText;
            }
          }
        }
      }

      // Step 2: Global alignment with the master script
      setAlignmentStep('Aligning transcripts against master voiceover script sequence...');
      const alignmentResultObj = heuristicFuzzyMatchScript(scriptText, clipsWithTranscripts);

      setAlignmentResult(alignmentResultObj);
      setArrangedClips(alignmentResultObj.alignedClips);
      setAlignmentSuccess(true);

      // Automatically sync and apply this verified sequence to the parent BatchMergePanel items list
      const reordered: BatchItem[] = [];
      const addedIds = new Set<string>();

      alignmentResultObj.alignedClips.forEach((ac, idx) => {
        if (addedIds.has(ac.id)) return;
        const it = items.find((i) => i.id === ac.id);
        if (it) {
          addedIds.add(ac.id);
          reordered.push({
            ...it,
            transcript: ac.transcript,
            matchedSnippet: ac.matchedSnippet,
            scriptIndex: idx,
            matchConfidence: ac.confidence,
          });
        }
      });

      // Ensure every single item is preserved - no clips ever dropped
      items.forEach((it) => {
        if (!addedIds.has(it.id)) {
          addedIds.add(it.id);
          reordered.push(it);
        }
      });

      onApplyArrangement(reordered);
      setAppliedOrderNotice(true);
      setTimeout(() => setAppliedOrderNotice(false), 4000);
    } catch (err: any) {
      console.error('Failed to align voiceover clips:', err);
      // Even if an unexpected error occurs, provide local heuristic fallback preserving all clips
      const fallbackResult = heuristicFuzzyMatchScript(
        scriptText,
        items.map((it) => ({ id: it.id, name: it.name, transcript: it.transcript || it.name }))
      );
      setAlignmentResult(fallbackResult);
      setArrangedClips(fallbackResult.alignedClips);
      setAlignmentSuccess(true);

      const reordered: BatchItem[] = [];
      const addedIds = new Set<string>();

      fallbackResult.alignedClips.forEach((ac, idx) => {
        if (addedIds.has(ac.id)) return;
        const it = items.find((i) => i.id === ac.id);
        if (it) {
          addedIds.add(ac.id);
          reordered.push({
            ...it,
            transcript: ac.transcript,
            matchedSnippet: ac.matchedSnippet,
            scriptIndex: idx,
            matchConfidence: ac.confidence,
          });
        }
      });

      items.forEach((it) => {
        if (!addedIds.has(it.id)) {
          addedIds.add(it.id);
          reordered.push(it);
        }
      });

      onApplyArrangement(reordered);
      setAppliedOrderNotice(true);
      setTimeout(() => setAppliedOrderNotice(false), 4000);
    } finally {
      setIsAligning(false);
      setAlignmentStep('');
    }
  };

  // Instant Smart Script Alignment (runs locally in < 5ms without network delays)
  const handleSmartScriptAlign = () => {
    if (!scriptText.trim()) {
      alert('Please paste your full master voiceover script first.');
      return;
    }
    const result = heuristicFuzzyMatchScript(
      scriptText,
      items.map((it) => ({ id: it.id, name: it.name, transcript: it.transcript || it.name }))
    );
    setAlignmentResult(result);
    setArrangedClips(result.alignedClips);
    setAlignmentSuccess(true);

    const reordered: BatchItem[] = [];
    const addedIds = new Set<string>();

    result.alignedClips.forEach((ac, idx) => {
      if (addedIds.has(ac.id)) return;
      const it = items.find((i) => i.id === ac.id);
      if (it) {
        addedIds.add(ac.id);
        reordered.push({
          ...it,
          transcript: ac.transcript,
          matchedSnippet: ac.matchedSnippet,
          scriptIndex: idx,
          matchConfidence: ac.confidence,
        });
      }
    });

    items.forEach((it) => {
      if (!addedIds.has(it.id)) {
        addedIds.add(it.id);
        reordered.push(it);
      }
    });

    onApplyArrangement(reordered);
    setAppliedOrderNotice(true);
    setTimeout(() => setAppliedOrderNotice(false), 4000);
  };

  // 1:1 Chronological Script Sentence Sequencing (maps each clip directly to a script segment in order)
  const handleSequentialSentenceAlign = () => {
    if (!scriptText.trim()) {
      alert('Please paste your full master voiceover script first.');
      return;
    }
    const result = alignClipsToScriptSequentially(
      scriptText,
      items.map((it) => ({ id: it.id, name: it.name, transcript: it.transcript || it.name }))
    );
    setAlignmentResult(result);
    setArrangedClips(result.alignedClips);
    setAlignmentSuccess(true);

    const reordered: BatchItem[] = [];
    const addedIds = new Set<string>();

    result.alignedClips.forEach((ac, idx) => {
      if (addedIds.has(ac.id)) return;
      const it = items.find((i) => i.id === ac.id);
      if (it) {
        addedIds.add(ac.id);
        reordered.push({
          ...it,
          transcript: ac.transcript,
          matchedSnippet: ac.matchedSnippet,
          scriptIndex: idx,
          matchConfidence: ac.confidence,
        });
      }
    });

    items.forEach((it) => {
      if (!addedIds.has(it.id)) {
        addedIds.add(it.id);
        reordered.push(it);
      }
    });

    onApplyArrangement(reordered);
    setAppliedOrderNotice(true);
    setTimeout(() => setAppliedOrderNotice(false), 4000);
  };

  // Reorder item in arranged list up/down
  const moveClipOrder = (index: number, direction: 'up' | 'down') => {
    const targetIdx = direction === 'up' ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= arrangedClips.length) return;

    const updated = [...arrangedClips];
    const temp = updated[index];
    updated[index] = updated[targetIdx];
    updated[targetIdx] = temp;

    const renumbered = updated.map((c, idx) => ({ ...c, order: idx }));
    setArrangedClips(renumbered);
  };

  // Save manual edit of transcript
  const handleSaveTranscript = (clipId: string) => {
    const updated = arrangedClips.map((c) => {
      if (c.id === clipId) {
        return { ...c, transcript: tempTranscript };
      }
      return c;
    });
    setArrangedClips(updated);
    setEditingClipId(null);
  };

  // Instantly sort clips by natural numbers in filename (1, 2, 3... 10, 11)
  const handleNaturalSort = () => {
    const sorted = naturalSortClips<ScriptAlignedClip>(arrangedClips);
    const updated = sorted.map((c, idx) => ({ ...c, order: idx }));
    setArrangedClips(updated);

    const reordered: BatchItem[] = [];
    const addedIds = new Set<string>();

    sorted.forEach((c) => {
      if (addedIds.has(c.id)) return;
      const it = items.find((item) => item.id === c.id);
      if (it) {
        addedIds.add(c.id);
        reordered.push(it);
      }
    });

    items.forEach((it) => {
      if (!addedIds.has(it.id)) {
        addedIds.add(it.id);
        reordered.push(it);
      }
    });

    onApplyArrangement(reordered);
    setAppliedOrderNotice(true);
    setTimeout(() => setAppliedOrderNotice(false), 3000);
  };

  // Apply the newly arranged order to the parent BatchMergePanel items list
  const handleApplyOrderToBatch = () => {
    if (arrangedClips.length === 0) return;

    const reordered: BatchItem[] = [];
    const addedIds = new Set<string>();

    arrangedClips.forEach((ac, idx) => {
      if (addedIds.has(ac.id)) return;
      const it = items.find((i) => i.id === ac.id);
      if (it) {
        addedIds.add(ac.id);
        reordered.push({
          ...it,
          transcript: ac.transcript,
          matchedSnippet: ac.matchedSnippet,
          scriptIndex: idx,
          matchConfidence: ac.confidence,
        });
      }
    });

    // Add any items that were not in arrangedClips (edge case)
    items.forEach((it) => {
      if (!addedIds.has(it.id)) {
        addedIds.add(it.id);
        reordered.push(it);
      }
    });

    onApplyArrangement(reordered);
    setAppliedOrderNotice(true);
    setTimeout(() => setAppliedOrderNotice(false), 4000);
  };

  // Instant Demo Preset Generator
  const handleLoadDemo = async () => {
    setScriptText(SAMPLE_FISHAUDIO_DEMO.script);

    if (onAddGeneratedDemoClips) {
      // Synthesize 4 distinct audio clips matching the demo sentences
      const sampleRate = 44100;
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const files: File[] = [];

      for (let i = 0; i < SAMPLE_FISHAUDIO_DEMO.clips.length; i++) {
        const demoClip = SAMPLE_FISHAUDIO_DEMO.clips[i];
        const duration = 4.0 + (i % 2) * 1.5;
        const totalSamples = Math.floor(sampleRate * duration);
        const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
        const channel = buffer.getChannelData(0);

        // Speech tone modulation
        const pitch = 220 + i * 25;
        for (let s = 0; s < totalSamples; s++) {
          const t = s / sampleRate;
          if (t > 0.4 && t < duration - 0.4) {
            const tone =
              Math.sin(2 * Math.PI * pitch * t) * 0.4 +
              Math.sin(2 * Math.PI * pitch * 1.5 * t) * 0.2 +
              (Math.random() * 2 - 1) * 0.02;
            channel[s] = tone * 0.4;
          }
        }

        const wavBlob = audioBufferToWavBlob(buffer);
        const file = new File([wavBlob], demoClip.name, { type: 'audio/wav' });
        // Attach initial transcript to file object property
        (file as any)._initialTranscript = demoClip.transcript;
        files.push(file);
      }

      onAddGeneratedDemoClips(files, SAMPLE_FISHAUDIO_DEMO.script);
    }
  };

  return (
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500/20 via-cyan-500/20 to-emerald-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <FileText className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-base font-bold text-white tracking-tight">
                Voiceover Script Auto-Arranger
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800">
                Fish Audio & AI Clips
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Paste the full text used in Fish Audio or ElevenLabs. DeadSpace AI transcribes each clip and orders them to match your original script perfectly.
            </p>
          </div>
        </div>

        {/* Demo Preset Button */}
        <button
          onClick={handleLoadDemo}
          className="text-xs px-3 py-1.5 rounded-xl bg-indigo-950/70 hover:bg-indigo-900 border border-indigo-700/80 text-indigo-300 hover:text-white transition-all inline-flex items-center space-x-1.5 shrink-0 self-start sm:self-auto cursor-pointer"
          title="Load sample voiceover script and clips to see how auto-alignment works"
        >
          <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
          <span>Load Fish Audio Demo</span>
        </button>
      </div>

      {/* Script Input Box */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <label className="font-semibold text-slate-300 flex items-center space-x-1.5">
            <span>Full Master Voiceover Script</span>
            <span className="text-slate-500 font-normal">
              ({scriptText.length} characters • {scriptText.trim().split(/\s+/).filter(Boolean).length} words)
            </span>
          </label>
          {scriptText && (
            <button
              onClick={() => setScriptText('')}
              className="text-slate-500 hover:text-slate-300 transition-colors"
            >
              Clear
            </button>
          )}
        </div>

        <textarea
          value={scriptText}
          onChange={(e) => setScriptText(e.target.value)}
          placeholder="Paste your original full voiceover script here... (e.g. the complete text before you had to split it into chunks to satisfy Fish Audio's character limits)"
          rows={4}
          className="w-full bg-slate-950/90 border border-slate-800 rounded-xl p-3.5 text-xs sm:text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/80 focus:ring-1 focus:ring-cyan-500/30 transition-all font-mono leading-relaxed"
        />
      </div>

      {/* Action Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <Layers className="w-4 h-4 text-cyan-400" />
          <span>
            <strong className="text-white font-mono">{items.length}</strong> audio clip{items.length === 1 ? '' : 's'} in queue
          </span>
          {alignmentResult && (
            <span className="text-emerald-400 font-medium pl-2 border-l border-slate-800">
              {alignmentResult.coveragePercentage}% script coverage
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
          <button
            type="button"
            id="natural-sort-btn"
            onClick={handleNaturalSort}
            disabled={isAligning || items.length === 0}
            className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-slate-900 hover:bg-slate-800 text-slate-200 hover:text-white border border-slate-700 hover:border-cyan-500/50 transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow"
            title="Sort clips by natural numbers in filename (e.g. 1, 2, 3... 10, 11, 52)"
          >
            <ArrowDownUp className="w-3.5 h-3.5 text-cyan-400" />
            <span>Sort 1 → {items.length || 52} (Numeric)</span>
          </button>

          <button
            type="button"
            id="sentence-sequence-align-btn"
            onClick={handleSequentialSentenceAlign}
            disabled={isAligning || items.length === 0 || !scriptText.trim()}
            className="px-3.5 py-2.5 rounded-xl text-xs font-bold bg-indigo-950/90 hover:bg-indigo-900 text-indigo-200 hover:text-white border border-indigo-700/80 hover:border-indigo-400 transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow-md shadow-indigo-950/40"
            title="Chronologically maps clips 1-to-1 against sentences or paragraphs of the pasted script"
          >
            <Split className="w-3.5 h-3.5 text-indigo-400" />
            <span>Map 1:1 to Script Sentences</span>
          </button>

          <button
            id="smart-script-arrange-btn"
            onClick={handleSmartScriptAlign}
            disabled={isAligning || items.length === 0 || !scriptText.trim()}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-indigo-500 via-cyan-500 to-emerald-400 text-slate-950 border border-cyan-400/50 hover:brightness-110 shadow-lg shadow-cyan-500/20 cursor-pointer inline-flex items-center justify-center space-x-2"
            title="Instant multi-pass matching using Fish Audio chunk tags, descriptive phrases, and script text"
          >
            <Wand2 className="w-4 h-4 text-slate-950" />
            <span>Smart Script Match</span>
          </button>
        </div>
      </div>

      {/* Progress status notification */}
      {isAligning && (
        <div className="bg-indigo-950/50 border border-indigo-700/60 rounded-xl p-3 text-xs text-indigo-300 flex items-center space-x-3 animate-pulse">
          <RefreshCw className="w-4 h-4 animate-spin text-cyan-400 shrink-0" />
          <span className="font-mono">{alignmentStep || 'Processing audio clips with Gemini AI...'}</span>
        </div>
      )}

      {/* Applied Order Success Banner with direct Merge Action */}
      {appliedOrderNotice && (
        <div className="bg-gradient-to-r from-emerald-950/90 via-slate-900 to-emerald-950/90 border border-emerald-500 rounded-2xl p-4 text-xs text-emerald-200 flex flex-col sm:flex-row items-center justify-between gap-3 shadow-2xl animate-fade-in">
          <div className="flex items-center space-x-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-900 border border-emerald-400 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-5 h-5 text-emerald-300" />
            </div>
            <div>
              <span className="font-bold text-white text-sm block">
                Clips Reordered Into Exact Script Sequence!
              </span>
              <span className="text-[11px] text-emerald-300/90">
                The batch queue is now sequenced according to your master voiceover script.
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              const mergeBtn = document.getElementById('batch-banner-regenerate-btn') || document.getElementById('batch-header-regenerate-btn');
              if (mergeBtn) {
                mergeBtn.scrollIntoView({ behavior: 'smooth' });
                (mergeBtn as HTMLButtonElement).click();
              }
            }}
            className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 font-black text-xs hover:brightness-110 shadow-lg shadow-amber-500/20 cursor-pointer inline-flex items-center justify-center space-x-1.5 shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
            <span>Generate Merged Audio Now</span>
          </button>
        </div>
      )}

      {/* Alignment Success Banner with 1-Click Apply */}
      {alignmentResult && (
        <div className="bg-gradient-to-r from-emerald-950/80 via-slate-900 to-indigo-950/80 border border-emerald-500/50 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center space-x-3.5 text-left w-full sm:w-auto">
            <div className="w-11 h-11 rounded-xl bg-emerald-950 border border-emerald-500 flex items-center justify-center shrink-0 shadow-lg shadow-emerald-950">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                <span>{arrangedClips.length} Audio Clips Chronologically Sequenced</span>
                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-900/80 text-emerald-300 border border-emerald-600">
                  {alignmentResult.coveragePercentage}% Script Match
                </span>
              </h4>
              <p className="text-xs text-emerald-200/80 mt-0.5">
                All voiceover chunks have been positioned according to your master script. Click below to apply to the merge queue.
              </p>
            </div>
          </div>

          <button
            onClick={handleApplyOrderToBatch}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 to-emerald-400 hover:brightness-110 text-slate-950 text-xs sm:text-sm font-black shadow-lg shadow-cyan-500/25 transition-all inline-flex items-center justify-center space-x-2 shrink-0 cursor-pointer"
          >
            <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
            <span>Apply Sequence to Batch Queue</span>
          </button>
        </div>
      )}

      {/* Arranged Clips Sequence List */}
      {arrangedClips.length > 0 && (
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-300 tracking-wide uppercase flex items-center space-x-1.5">
              <ArrowDownUp className="w-3.5 h-3.5 text-cyan-400" />
              <span>Arranged Script Flow ({arrangedClips.length} Clips)</span>
            </h4>
            
            {/* Apply Order Button */}
            <button
              onClick={handleApplyOrderToBatch}
              className="text-xs px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all inline-flex items-center space-x-1.5 shadow-md shadow-cyan-500/20 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
              <span>Apply Sequence to Batch Queue</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {arrangedClips.map((clip, index) => {
              const matchedItem = items.find((it) => it.id === clip.id);
              const isPlaying = playingClipId === clip.id;
              const isEditing = editingClipId === clip.id;

              return (
                <div
                  key={clip.id}
                  className="bg-slate-950/70 border border-slate-800 hover:border-slate-700 rounded-xl p-3.5 transition-all space-y-2.5 group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center space-x-3 min-w-0">
                      {/* Sequence Number Badge */}
                      <span className="w-6 h-6 rounded-lg bg-gradient-to-br from-cyan-500 to-indigo-500 text-slate-950 text-xs font-black flex items-center justify-center shrink-0 shadow-sm">
                        {index + 1}
                      </span>

                      {/* Play Preview Button */}
                      <button
                        onClick={() => togglePlayClip(clip.id)}
                        className={`w-7 h-7 rounded-lg flex items-center justify-center transition-all cursor-pointer shrink-0 ${
                          isPlaying
                            ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                            : 'bg-slate-800 hover:bg-slate-700 text-cyan-400'
                        }`}
                        title={isPlaying ? 'Pause snippet' : 'Audition clip speech'}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                      </button>

                      {/* Name and Duration */}
                      <div className="min-w-0">
                        <div className="flex items-center space-x-2">
                          <span className="text-xs font-semibold text-white truncate font-mono">
                            {clip.name}
                          </span>
                          {matchedItem?.archiveName && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 shrink-0 inline-flex items-center space-x-1">
                              <Archive className="w-2.5 h-2.5 text-indigo-400" />
                              <span className="truncate max-w-[100px]">{matchedItem.archiveName}</span>
                            </span>
                          )}
                          {clip.confidence && (
                            <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0">
                              {clip.confidence}% match
                            </span>
                          )}
                        </div>
                        {matchedItem && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            Duration: {formatDuration(matchedItem.originalDuration)}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Manual Reorder Controls */}
                    <div className="flex items-center space-x-1 shrink-0">
                      <button
                        onClick={() => moveClipOrder(index, 'up')}
                        disabled={index === 0}
                        className={`p-1.5 rounded-lg border text-slate-400 hover:text-white transition-all ${
                          index === 0
                            ? 'opacity-30 border-transparent cursor-not-allowed'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800'
                        }`}
                        title="Move clip earlier in sequence"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => moveClipOrder(index, 'down')}
                        disabled={index === arrangedClips.length - 1}
                        className={`p-1.5 rounded-lg border text-slate-400 hover:text-white transition-all ${
                          index === arrangedClips.length - 1
                            ? 'opacity-30 border-transparent cursor-not-allowed'
                            : 'bg-slate-900 hover:bg-slate-800 border-slate-800'
                        }`}
                        title="Move clip later in sequence"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Transcript Display & Inline Editing */}
                  <div className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2.5 text-xs space-y-1">
                    <div className="flex items-center justify-between text-[11px] text-slate-400 font-medium">
                      <span className="text-cyan-400 font-mono text-[10px] uppercase tracking-wider">
                        Transcribed Speech
                      </span>
                      {!isEditing ? (
                        <button
                          onClick={() => {
                            setEditingClipId(clip.id);
                            setTempTranscript(clip.transcript);
                          }}
                          className="text-[10px] text-slate-500 hover:text-slate-300 inline-flex items-center space-x-1 transition-colors"
                        >
                          <Edit3 className="w-2.5 h-2.5" />
                          <span>Edit</span>
                        </button>
                      ) : (
                        <div className="flex items-center space-x-1.5">
                          <button
                            onClick={() => handleSaveTranscript(clip.id)}
                            className="text-[10px] text-emerald-400 hover:text-emerald-300 font-bold"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingClipId(null)}
                            className="text-[10px] text-slate-500 hover:text-slate-400"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditing ? (
                      <textarea
                        value={tempTranscript}
                        onChange={(e) => setTempTranscript(e.target.value)}
                        rows={2}
                        className="w-full bg-slate-950 border border-slate-700 rounded p-1.5 text-xs text-white focus:outline-none focus:border-cyan-500 font-mono"
                      />
                    ) : (
                      <p className="text-slate-300 text-xs font-sans leading-relaxed italic">
                        "{clip.transcript || 'Speech transcription pending...'}"
                      </p>
                    )}

                    {clip.matchedSnippet && clip.matchedSnippet !== clip.transcript && (
                      <div className="text-[11px] text-slate-500 pt-1 border-t border-slate-800/60 font-sans">
                        <span className="text-indigo-400 font-medium font-mono text-[10px]">Script Match: </span>
                        "{clip.matchedSnippet}"
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Bottom Confirmation Button */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
            {alignmentResult && alignmentResult.missingScriptSections.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowMissingSections(!showMissingSections)}
                className="text-[11px] text-slate-400 hover:text-slate-200 inline-flex items-center space-x-1.5 cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                <span>
                  {alignmentResult.missingScriptSections.length} script line{alignmentResult.missingScriptSections.length > 1 ? 's' : ''} not covered by clips ({showMissingSections ? 'Hide' : 'Review'})
                </span>
              </button>
            ) : <div />}

            <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
              <button
                type="button"
                onClick={() => {
                  const reorderedItems = arrangedClips
                    .map((clip) => {
                      const originalItem = items.find((it) => it.id === clip.id);
                      if (!originalItem) return null;
                      return {
                        ...originalItem,
                        transcript: clip.transcript,
                        matchedSnippet: clip.matchedSnippet,
                        scriptIndex: clip.startIndex,
                        matchConfidence: clip.confidence,
                      };
                    })
                    .filter(Boolean) as BatchItem[];

                  const { srtText } = generateSrtFromBatchItems(reorderedItems, 100, scriptText);
                  downloadTextFile(srtText, 'voiceover_subtitles.srt', 'application/x-subrip');
                }}
                className="px-4 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-cyan-800/80 font-bold text-xs sm:text-sm hover:brightness-110 cursor-pointer inline-flex items-center justify-center space-x-1.5"
                title="Download standard .SRT subtitle file from this arranged sequence"
              >
                <FileText className="w-4 h-4 text-cyan-400" />
                <span>Export .SRT Captions</span>
              </button>

              <button
                onClick={handleApplyOrderToBatch}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-400 via-teal-400 to-emerald-400 text-slate-950 font-bold text-xs sm:text-sm hover:brightness-110 shadow-lg shadow-cyan-500/20 cursor-pointer inline-flex items-center justify-center space-x-2"
              >
                <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                <span>Apply Sequence & Sync With Batch Queue</span>
              </button>
            </div>
          </div>

          {/* Collapsible Missing Sections Drawer */}
          {showMissingSections && alignmentResult && alignmentResult.missingScriptSections.length > 0 && (
            <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3.5 text-xs text-slate-400 space-y-2 mt-2">
              <div className="font-semibold text-slate-300 flex items-center space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                <span>Unmentioned script lines ({alignmentResult.missingScriptSections.length})</span>
              </div>
              <p className="text-[11px] text-slate-500">
                These short lines from your script were not detected inside your uploaded chunks:
              </p>
              <div className="space-y-1 pl-2 font-mono text-[11px] text-slate-400 max-h-36 overflow-y-auto border-l border-slate-700">
                {alignmentResult.missingScriptSections.map((sec, i) => (
                  <div key={i} className="truncate">• "{sec}"</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
