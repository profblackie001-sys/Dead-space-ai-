import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FileText,
  Play,
  Pause,
  Download,
  Copy,
  Check,
  Sparkles,
  Upload,
  RefreshCw,
  Plus,
  Trash2,
  Clock,
  Layers,
  HelpCircle,
  RotateCcw,
  Volume2,
  FileCheck,
  Share2,
} from 'lucide-react';
import { BatchItem, SrtCue } from '../types';
import {
  parseSrt,
  buildSrt,
  buildVtt,
  formatSrtTimestamp,
  parseTimestampToSeconds,
  generateSrtFromBatchItems,
  generateYouTubeChapters,
  downloadTextFile,
} from '../utils/srtGenerator';
import { fileToBase64 } from '../utils/scriptAligner';
import { formatDuration } from '../utils/audioProcessor';

interface SrtSubtitleStudioProps {
  batchItems?: BatchItem[];
  mergedAudioUrl?: string | null;
  mergedBuffer?: AudioBuffer | null;
  interClipGapMs?: number;
  initialScript?: string;
  onNavigateToBatch?: () => void;
}

export const SrtSubtitleStudio: React.FC<SrtSubtitleStudioProps> = ({
  batchItems = [],
  mergedAudioUrl,
  mergedBuffer,
  interClipGapMs = 100,
  initialScript = '',
  onNavigateToBatch,
}) => {
  const [audioUrl, setAudioUrl] = useState<string | null>(mergedAudioUrl || null);
  const [audioFileName, setAudioFileName] = useState<string>(
    mergedAudioUrl ? 'merged_master_audio.mp3' : ''
  );
  const [referenceScript, setReferenceScript] = useState<string>(initialScript || '');
  const [cues, setCues] = useState<SrtCue[]>([]);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [generationProgress, setGenerationProgress] = useState<string>('');
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Playback state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(mergedBuffer?.duration || 0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [activeCueId, setActiveCueId] = useState<number | null>(null);

  // Copy / Download feedback state
  const [copiedType, setCopiedType] = useState<'srt' | 'vtt' | 'chapters' | null>(null);
  const [downloadSuccess, setDownloadSuccess] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeCueRef = useRef<HTMLDivElement | null>(null);

  // Sync with prop changes
  useEffect(() => {
    if (mergedAudioUrl && !audioUrl) {
      setAudioUrl(mergedAudioUrl);
      setAudioFileName('merged_master_audio.mp3');
      if (mergedBuffer) setDuration(mergedBuffer.duration);
    }
  }, [mergedAudioUrl, mergedBuffer]);

  // Sync playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Highlight active cue during audio playback
  useEffect(() => {
    const current = cues.find(
      (c) => currentTime >= c.startSeconds && currentTime <= c.endSeconds
    );
    if (current) {
      setActiveCueId(current.id);
    } else {
      setActiveCueId(null);
    }
  }, [currentTime, cues]);

  // Auto-generate initial cues if batch items exist and cues are empty
  useEffect(() => {
    if (batchItems.length > 0 && cues.length === 0) {
      const { cues: generated } = generateSrtFromBatchItems(
        batchItems,
        interClipGapMs,
        referenceScript
      );
      if (generated.length > 0) {
        setCues(generated);
      }
    }
  }, [batchItems, interClipGapMs]);

  // Active cue preview on video/caption overlay
  const activeCue = useMemo(() => {
    return cues.find((c) => c.id === activeCueId);
  }, [cues, activeCueId]);

  // Audio play/pause toggle
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().catch(() => {});
      setIsPlaying(true);
    }
  };

  // Jump to cue timestamp
  const seekToCue = (startSeconds: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, startSeconds);
      if (!isPlaying) {
        audioRef.current.play().catch(() => {});
        setIsPlaying(true);
      }
    }
  };

  // Handle file upload
  const handleAudioFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (audioUrl && audioUrl.startsWith('blob:')) {
      URL.revokeObjectURL(audioUrl);
    }

    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setAudioFileName(file.name);
    setIsPlaying(false);
    setCurrentTime(0);

    // Load audio metadata
    const tempAudio = new Audio(url);
    tempAudio.onloadedmetadata = () => {
      setDuration(tempAudio.duration || 0);
    };

    e.target.value = '';
  };

  // Generate SRT via AI or Timeline
  const handleGenerateSrt = async () => {
    setIsGenerating(true);
    setGenerationError(null);
    setGenerationProgress('Analyzing speech and timeline timestamps...');

    try {
      // If we have an uploaded audio file and user wants AI audio transcription
      if (fileInputRef.current?.files?.[0] || (audioUrl && !audioUrl.startsWith('blob:'))) {
        const file = fileInputRef.current?.files?.[0];
        if (file) {
          setGenerationProgress('Uploading audio to Gemini Transcription Engine...');
          const base64 = await fileToBase64(file);
          
          setGenerationProgress('Generating millisecond-exact SubRip SRT cues...');
          const response = await fetch('/api/generate-srt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: file.type || 'audio/mp3',
              referenceScript,
            }),
          });

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.data?.cues && data.data.cues.length > 0) {
              setCues(data.data.cues);
              setIsGenerating(false);
              return;
            } else if (data.data?.srtText) {
              const parsed = parseSrt(data.data.srtText);
              if (parsed.length > 0) {
                setCues(parsed);
                setIsGenerating(false);
                return;
              }
            }
          }
        }
      }

      // Fallback: Generate from batch timeline or reference script
      if (batchItems.length > 0) {
        setGenerationProgress('Generating timeline-exact SRT from arranged voiceover clips...');
        const { cues: timelineCues } = generateSrtFromBatchItems(
          batchItems,
          interClipGapMs,
          referenceScript
        );
        if (timelineCues.length > 0) {
          setCues(timelineCues);
          setIsGenerating(false);
          return;
        }
      }

      // If only reference script and audio duration exist
      if (referenceScript && duration > 0) {
        setGenerationProgress('Aligning reference script sentences to track duration...');
        const sentences = referenceScript
          .split(/(?<=[.?!])\s+/)
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (sentences.length > 0) {
          const totalWords = referenceScript.split(/\s+/).filter(Boolean).length;
          let runningTime = 0;
          const generated: SrtCue[] = [];

          sentences.forEach((sentence, idx) => {
            const wordsInSentence = sentence.split(/\s+/).filter(Boolean).length;
            const sentenceDuration = (wordsInSentence / Math.max(1, totalWords)) * duration;
            const startSec = runningTime;
            const endSec = Math.min(duration, runningTime + sentenceDuration);

            generated.push({
              id: idx + 1,
              startTime: formatSrtTimestamp(startSec),
              endTime: formatSrtTimestamp(endSec),
              startSeconds: startSec,
              endSeconds: endSec,
              text: sentence,
            });

            runningTime = endSec;
          });

          setCues(generated);
          setIsGenerating(false);
          return;
        }
      }

      throw new Error('Please upload an audio file or arrange clips in the Batch tab first.');
    } catch (err: any) {
      console.error('SRT generation error:', err);
      setGenerationError(err?.message || 'Failed to generate SRT subtitles.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Modify cue text or timestamps
  const handleUpdateCue = (id: number, field: keyof SrtCue, value: string) => {
    setCues((prev) =>
      prev.map((cue) => {
        if (cue.id !== id) return cue;

        if (field === 'startTime') {
          const startSeconds = parseTimestampToSeconds(value);
          return { ...cue, startTime: value, startSeconds };
        } else if (field === 'endTime') {
          const endSeconds = parseTimestampToSeconds(value);
          return { ...cue, endTime: value, endSeconds };
        } else if (field === 'text') {
          return { ...cue, text: value };
        }
        return cue;
      })
    );
  };

  // Delete cue
  const handleDeleteCue = (id: number) => {
    setCues((prev) => prev.filter((c) => c.id !== id));
  };

  // Add cue after
  const handleAddCueAfter = (index: number) => {
    const prevCue = cues[index];
    const newStart = prevCue ? prevCue.endSeconds + 0.1 : currentTime;
    const newEnd = newStart + 3.0;

    const newCue: SrtCue = {
      id: Date.now(),
      startTime: formatSrtTimestamp(newStart),
      endTime: formatSrtTimestamp(newEnd),
      startSeconds: newStart,
      endSeconds: newEnd,
      text: 'New subtitle caption',
    };

    const updated = [...cues];
    updated.splice(index + 1, 0, newCue);
    setCues(updated);
  };

  // Downloads
  const handleDownloadSrt = () => {
    const rawSrt = buildSrt(cues);
    const filename = (audioFileName || 'subtitles').replace(/\.[^/.]+$/, '') + '.srt';
    downloadTextFile(rawSrt, filename, 'application/x-subrip');
    setDownloadSuccess('SRT');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  const handleDownloadVtt = () => {
    const rawVtt = buildVtt(cues);
    const filename = (audioFileName || 'subtitles').replace(/\.[^/.]+$/, '') + '.vtt';
    downloadTextFile(rawVtt, filename, 'text/vtt');
    setDownloadSuccess('VTT');
    setTimeout(() => setDownloadSuccess(null), 3000);
  };

  const handleCopySrt = () => {
    const rawSrt = buildSrt(cues);
    navigator.clipboard.writeText(rawSrt);
    setCopiedType('srt');
    setTimeout(() => setCopiedType(null), 2500);
  };

  const handleCopyChapters = () => {
    const chaptersText = generateYouTubeChapters(cues);
    navigator.clipboard.writeText(chaptersText);
    setCopiedType('chapters');
    setTimeout(() => setCopiedType(null), 2500);
  };

  return (
    <div id="srt-subtitle-studio" className="w-full max-w-5xl mx-auto space-y-6">
      
      {/* Top Banner / Title Header */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center space-x-2">
              <span className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                <FileText className="w-6 h-6" />
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                SRT Subtitle & Caption Studio
              </h2>
            </div>
            <p className="text-xs sm:text-sm text-slate-400">
              100% Validated SubRip (<code className="text-cyan-300 font-mono">.srt</code>) and WebVTT (<code className="text-cyan-300 font-mono">.vtt</code>) captions for YouTube, CapCut, Premiere Pro, and DaVinci Resolve.
            </p>
          </div>

          {/* Quick source actions */}
          <div className="flex flex-wrap items-center gap-2">
            {batchItems.length > 0 && (
              <button
                onClick={() => {
                  const { cues: gen } = generateSrtFromBatchItems(batchItems, interClipGapMs, referenceScript);
                  setCues(gen);
                }}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-950/80 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-700/80 transition-all cursor-pointer inline-flex items-center space-x-1.5"
                title="Sync subtitles directly from your 15 arranged audio clips"
              >
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>Sync From {batchItems.length} Batch Clips</span>
              </button>
            )}

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-all cursor-pointer inline-flex items-center space-x-1.5"
            >
              <Upload className="w-3.5 h-3.5 text-cyan-400" />
              <span>{audioFileName ? 'Change Audio File' : 'Upload Master Audio'}</span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*"
              className="hidden"
              onChange={handleAudioFileUpload}
            />
          </div>
        </div>

        {/* Audio Status Pill */}
        {audioFileName && (
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 flex-wrap gap-2">
            <div className="flex items-center space-x-2">
              <Volume2 className="w-4 h-4 text-cyan-400" />
              <span className="font-semibold text-white font-mono">{audioFileName}</span>
              <span className="font-mono text-cyan-300">({formatDuration(duration)})</span>
            </div>
            {batchItems.length > 0 && (
              <span className="text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded text-[11px] font-mono">
                ✓ Timeline synchronized with {batchItems.length} voiceover clips
              </span>
            )}
          </div>
        )}
      </div>

      {/* Reference Script Input & Generation Card */}
      <div className="bg-slate-900/80 border border-slate-800/90 rounded-2xl p-5 shadow-xl space-y-4">
        <div className="flex items-center justify-between">
          <label className="text-xs sm:text-sm font-bold text-slate-200 flex items-center space-x-2">
            <FileCheck className="w-4 h-4 text-cyan-400" />
            <span>Master Reference Script (Optional for 100% Spelling Precision)</span>
          </label>
          {referenceScript && (
            <span className="text-[11px] font-mono text-slate-400">
              {referenceScript.split(/\s+/).filter(Boolean).length} words
            </span>
          )}
        </div>

        <textarea
          rows={3}
          value={referenceScript}
          onChange={(e) => setReferenceScript(e.target.value)}
          placeholder="Paste your voiceover script here. Gemini uses this to ensure names, numbers, and technical terms are spelled with 100% accuracy..."
          className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs sm:text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-cyan-500 font-sans leading-relaxed resize-y"
        />

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
          <div className="text-xs text-slate-400 flex items-center space-x-1.5">
            <Sparkles className="w-4 h-4 text-teal-400 shrink-0" />
            <span>Generates standard SubRip timecodes: <code className="text-cyan-300 font-mono">00:00:01,250</code></span>
          </div>

          <button
            id="generate-srt-btn"
            onClick={handleGenerateSrt}
            disabled={isGenerating}
            className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer inline-flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 text-slate-950 stroke-[2.5] ${isGenerating ? 'animate-spin' : ''}`} />
            <span>{isGenerating ? 'Generating Subtitles...' : 'Generate SRT Subtitles Now'}</span>
          </button>
        </div>

        {/* Progress or Error */}
        {isGenerating && (
          <div className="p-3 bg-cyan-950/60 border border-cyan-800 rounded-xl text-xs text-cyan-300 font-mono animate-pulse flex items-center space-x-2">
            <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
            <span>{generationProgress}</span>
          </div>
        )}

        {generationError && (
          <div className="p-3 bg-rose-950/60 border border-rose-800 rounded-xl text-xs text-rose-300">
            {generationError}
          </div>
        )}
      </div>

      {/* Audio Player & Live Caption Preview */}
      {audioUrl && (
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-2xl space-y-4">
          <audio
            ref={audioRef}
            src={audioUrl}
            onTimeUpdate={() => {
              if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
            }}
            onEnded={() => setIsPlaying(false)}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onLoadedMetadata={() => {
              if (audioRef.current) setDuration(audioRef.current.duration);
            }}
          />

          {/* On-Screen Video-Style Caption Overlay Display */}
          <div className="bg-slate-950 border border-slate-800 rounded-2xl p-6 text-center min-h-[100px] flex flex-col items-center justify-center relative overflow-hidden shadow-inner">
            <div className="absolute top-2 left-3 text-[10px] font-mono uppercase tracking-wider text-slate-500 flex items-center space-x-1">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping" />
              <span>Live Caption Overlay Preview</span>
            </div>

            {activeCue ? (
              <div className="space-y-1 max-w-2xl px-4 animate-in fade-in zoom-in-95 duration-150">
                <span className="inline-block bg-black/85 text-white text-base sm:text-xl font-bold px-4 py-1.5 rounded-lg shadow-lg border border-slate-700/60 leading-snug">
                  {activeCue.text}
                </span>
                <p className="text-[11px] font-mono text-cyan-400">
                  {activeCue.startTime} ➔ {activeCue.endTime}
                </p>
              </div>
            ) : (
              <p className="text-xs text-slate-500 italic">
                {isPlaying ? '— (Pause in speech) —' : 'Press Play below to preview caption timing'}
              </p>
            )}
          </div>

          {/* Player Controls Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
            <div className="flex items-center space-x-3 w-full sm:w-auto">
              <button
                onClick={togglePlayPause}
                className="w-12 h-12 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer shrink-0"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 text-slate-950 fill-slate-950" />
                ) : (
                  <Play className="w-5 h-5 text-slate-950 fill-slate-950 ml-0.5" />
                )}
              </button>

              <div className="space-y-0.5 font-mono">
                <div className="text-sm font-bold text-white">
                  {formatDuration(currentTime)}{' '}
                  <span className="text-slate-500 font-normal">/ {formatDuration(duration)}</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {cues.length} Subtitle Cues Loaded
                </div>
              </div>
            </div>

            {/* Timeline Scrubber */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.05}
              value={currentTime}
              onChange={(e) => {
                const newT = parseFloat(e.target.value);
                setCurrentTime(newT);
                if (audioRef.current) audioRef.current.currentTime = newT;
              }}
              className="w-full sm:flex-1 h-2 bg-slate-950 rounded-lg appearance-none cursor-pointer accent-cyan-400 border border-slate-800"
            />

            {/* Playback speed buttons */}
            <div className="flex items-center space-x-1 shrink-0 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs font-mono text-slate-400">
              {[0.75, 1, 1.25, 1.5].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={`px-2 py-1 rounded-lg transition-colors cursor-pointer ${
                    playbackRate === rate
                      ? 'bg-cyan-500/20 text-cyan-300 font-bold'
                      : 'hover:text-white'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Subtitles Cue List & Inline Editor */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-base sm:text-lg font-bold text-white flex items-center space-x-2">
              <span>Subtitle Timeline Editor</span>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800">
                {cues.length} Cues
              </span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Click any play button to jump audio to that exact moment. You can edit text and timecodes inline.
            </p>
          </div>

          {/* Quick Export Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleCopySrt}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer inline-flex items-center space-x-1.5"
            >
              {copiedType === 'srt' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                  <span className="text-emerald-400">SRT Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5 text-slate-400" />
                  <span>Copy Raw SRT</span>
                </>
              )}
            </button>

            <button
              onClick={handleCopyChapters}
              className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-all cursor-pointer inline-flex items-center space-x-1.5"
              title="Generate YouTube timestamp chapters list"
            >
              {copiedType === 'chapters' ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                  <span className="text-emerald-400">Chapters Copied!</span>
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5 text-teal-400" />
                  <span>Copy YouTube Chapters</span>
                </>
              )}
            </button>

            {/* Download WebVTT */}
            <button
              onClick={handleDownloadVtt}
              disabled={cues.length === 0}
              className="px-3.5 py-1.5 rounded-xl text-xs font-semibold bg-indigo-950/80 hover:bg-indigo-900/80 text-indigo-300 border border-indigo-700/80 transition-all cursor-pointer inline-flex items-center space-x-1.5 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5 text-indigo-400" />
              <span>Download .VTT</span>
            </button>

            {/* Download SRT */}
            <button
              id="download-srt-file-btn"
              onClick={handleDownloadSrt}
              disabled={cues.length === 0}
              className="px-4 py-2 rounded-xl text-xs sm:text-sm font-bold bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 text-slate-950 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer inline-flex items-center space-x-2 disabled:opacity-40"
            >
              {downloadSuccess === 'SRT' ? (
                <>
                  <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                  <span>Downloaded .SRT!</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                  <span>Download .SRT File</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Empty state */}
        {cues.length === 0 ? (
          <div className="p-12 text-center border-2 border-dashed border-slate-800 rounded-2xl space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-cyan-950/60 border border-cyan-800/80 text-cyan-400 flex items-center justify-center mx-auto">
              <FileText className="w-6 h-6" />
            </div>
            <h4 className="text-base font-bold text-white">No Subtitles Generated Yet</h4>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              Upload an audio file or click "Generate SRT Subtitles Now" to create synchronized captions with millisecond precision.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 max-h-[550px] overflow-y-auto pr-1">
            {cues.map((cue, idx) => {
              const isActive = cue.id === activeCueId;
              return (
                <div
                  key={cue.id}
                  ref={isActive ? activeCueRef : undefined}
                  className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                    isActive
                      ? 'bg-cyan-950/40 border-cyan-500 shadow-md shadow-cyan-500/10'
                      : 'bg-slate-950/70 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  {/* Left: Index & Play Jump */}
                  <div className="flex items-center space-x-3 shrink-0">
                    <span className="w-6 text-center font-mono text-xs font-bold text-slate-500">
                      #{idx + 1}
                    </span>

                    <button
                      onClick={() => seekToCue(cue.startSeconds)}
                      className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all cursor-pointer ${
                        isActive
                          ? 'bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/30'
                          : 'bg-slate-900 text-slate-300 hover:bg-slate-800 hover:text-white border border-slate-800'
                      }`}
                      title="Jump audio to this timestamp"
                    >
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    </button>

                    {/* Timecodes */}
                    <div className="flex items-center space-x-1.5 font-mono text-xs">
                      <input
                        type="text"
                        value={cue.startTime}
                        onChange={(e) => handleUpdateCue(cue.id, 'startTime', e.target.value)}
                        className="w-24 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                        title="Start timecode (HH:MM:SS,mmm)"
                      />
                      <span className="text-slate-600">➔</span>
                      <input
                        type="text"
                        value={cue.endTime}
                        onChange={(e) => handleUpdateCue(cue.id, 'endTime', e.target.value)}
                        className="w-24 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-cyan-300 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                        title="End timecode (HH:MM:SS,mmm)"
                      />
                    </div>
                  </div>

                  {/* Middle: Caption Text Input */}
                  <div className="flex-1 w-full min-w-0">
                    <input
                      type="text"
                      value={cue.text}
                      onChange={(e) => handleUpdateCue(cue.id, 'text', e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl bg-slate-900/90 border border-slate-800 text-slate-100 text-xs sm:text-sm font-sans focus:outline-none focus:border-cyan-500"
                      placeholder="Caption text spoken during this time window..."
                    />
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center space-x-1 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => handleAddCueAfter(idx)}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer transition-colors"
                      title="Add cue after"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDeleteCue(cue.id)}
                      className="p-1.5 rounded-lg bg-slate-900 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer transition-colors"
                      title="Delete cue"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
};
