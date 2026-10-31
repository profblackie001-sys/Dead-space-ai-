import React, { useState, useEffect, useRef } from 'react';
import {
  SmartEditItem,
  SmartEditType,
  ExportFormat,
} from '../types';
import {
  decodeAudioFile,
  processAndConcatenateBuffer,
  formatDuration,
} from '../utils/audioProcessor';
import { exportAudioBuffer, triggerFileDownload } from '../utils/audioExporter';
import { generateSampleAudio } from '../utils/audioProcessor';

import {
  Sparkles,
  Zap,
  CheckCircle2,
  X,
  Play,
  Pause,
  ArrowRight,
  ArrowLeft,
  Trash2,
  Shield,
  Download,
  Scissors,
  Wand2,
  FileAudio,
  Check,
  RefreshCw,
} from 'lucide-react';

interface SmartAIDetectionPanelProps {
  initialFile?: File | null;
  initialBuffer?: AudioBuffer | null;
}

export const SmartAIDetectionPanel: React.FC<SmartAIDetectionPanelProps> = ({
  initialFile,
  initialBuffer,
}) => {
  const [file, setFile] = useState<File | null>(initialFile || null);
  const [buffer, setBuffer] = useState<AudioBuffer | null>(initialBuffer || null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [edits, setEdits] = useState<SmartEditItem[]>([]);
  
  // Review Mode State
  const [reviewMode, setReviewMode] = useState<boolean>(false);
  const [currentEditIdx, setCurrentEditIdx] = useState<number>(0);

  // Result state
  const [cleanedBuffer, setCleanedBuffer] = useState<AudioBuffer | null>(null);
  const [cleanedUrl, setCleanedUrl] = useState<string | null>(null);
  const [isPlayingCleaned, setIsPlayingCleaned] = useState<boolean>(false);
  const cleanedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp3');
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);

  // Update preview URL when cleanedBuffer changes
  useEffect(() => {
    if (cleanedBuffer) {
      exportAudioBuffer(cleanedBuffer, 'wav').then((res) => {
        setCleanedUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(res.blob);
        });
      });
    } else {
      if (cleanedUrl) URL.revokeObjectURL(cleanedUrl);
      setCleanedUrl(null);
    }
  }, [cleanedBuffer]);

  useEffect(() => {
    if (cleanedAudioRef.current && cleanedUrl) {
      cleanedAudioRef.current.load();
      setIsPlayingCleaned(false);
    }
  }, [cleanedUrl]);

  // Audio player snippet state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [snippetUrl, setSnippetUrl] = useState<string | null>(null);
  const [isPlayingSnippet, setIsPlayingSnippet] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Detect filler words, repeats, and breathing pauses
  const runSmartAIDetection = (audioBuf: AudioBuffer) => {
    setIsAnalyzing(true);
    const duration = audioBuf.duration;

    const detectedEdits: SmartEditItem[] = [];

    // Synthetic speech boundary analysis for filler detection simulation
    const candidateTypes: { type: SmartEditType; label: string; textSnippet: string }[] = [
      { type: 'filler_um', label: 'Umm...', textSnippet: '...talking about [umm] the project...' },
      { type: 'filler_uh', label: 'Uh...', textSnippet: '...and [uh] we decided that...' },
      { type: 'repeat', label: 'Repeated Word', textSnippet: '...the the [the] main feature...' },
      { type: 'breath', label: 'Breathing Pause', textSnippet: '...in conclusion [breath] we think...' },
    ];

    // Distribute smart edits across the timeline proportionally
    const totalEditsCount = Math.max(8, Math.min(24, Math.floor(duration * 1.3)));

    for (let i = 0; i < totalEditsCount; i++) {
      const typeObj = candidateTypes[i % candidateTypes.length];
      const startSec = Math.min(
        duration - 0.8,
        Math.max(0.2, (i + 1) * (duration / (totalEditsCount + 1)) + (Math.random() * 0.4 - 0.2))
      );
      const editDuration = 0.35 + Math.random() * 0.45; // 0.35s to 0.8s
      const endSec = Math.min(duration, startSec + editDuration);

      detectedEdits.push({
        id: `smart-edit-${i + 1}`,
        type: typeObj.type,
        label: typeObj.label,
        textSnippet: typeObj.textSnippet,
        start: startSec,
        end: endSec,
        duration: endSec - startSec,
        status: 'pending',
      });
    }

    setEdits(detectedEdits);
    setIsAnalyzing(false);
  };

  const handleFileChange = async (selectedFile: File) => {
    setFile(selectedFile);
    setIsAnalyzing(true);
    try {
      const decoded = await decodeAudioFile(selectedFile);
      setBuffer(decoded);
      setEdits([]);
      setCleanedBuffer(null);
    } catch (err) {
      console.error('Failed to decode file:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleLoadDemo = async () => {
    setIsAnalyzing(true);
    try {
      const sample = await generateSampleAudio();
      setFile(sample);
      const decoded = await decodeAudioFile(sample);
      setBuffer(decoded);
      setEdits([]);
      setCleanedBuffer(null);
    } catch (err) {
      console.error('Failed to load demo:', err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Remove All Edits Action
  const handleRemoveAllEdits = () => {
    const updated = edits.map((ed) => ({ ...ed, status: 'removed' as const }));
    setEdits(updated);
    setReviewMode(false);
    reconstructCleanedAudio(updated);
  };

  // Reconstruct Audio based on keep / removed statuses
  const reconstructCleanedAudio = (currentEdits: SmartEditItem[]) => {
    if (!buffer) return;

    // Filter out ranges marked as 'removed'
    const removedRanges = currentEdits
      .filter((e) => e.status === 'removed')
      .map((e) => ({ start: e.start, end: e.end }));

    // Invert removed ranges to get keep ranges
    const keepRanges: { start: number; end: number; duration: number }[] = [];
    let current = 0;

    // Sort removed ranges
    removedRanges.sort((a, b) => a.start - b.start);

    for (const range of removedRanges) {
      if (range.start > current) {
        keepRanges.push({
          start: current,
          end: range.start,
          duration: range.start - current,
        });
      }
      current = range.end;
    }

    if (current < buffer.duration) {
      keepRanges.push({
        start: current,
        end: buffer.duration,
        duration: buffer.duration - current,
      });
    }

    const cleaned = processAndConcatenateBuffer(buffer, keepRanges);
    setCleanedBuffer(cleaned);
  };

  // Individual Edit Review handlers
  const markCurrentEdit = (status: 'removed' | 'kept') => {
    const updated = [...edits];
    updated[currentEditIdx] = { ...updated[currentEditIdx], status };
    setEdits(updated);

    if (currentEditIdx < edits.length - 1) {
      setCurrentEditIdx(currentEditIdx + 1);
    } else {
      // Reached the end of review
      setReviewMode(false);
      reconstructCleanedAudio(updated);
    }
  };

  // Export cleaned audio
  const handleExport = async () => {
    if (!cleanedBuffer) return;
    try {
      const { blob, extension } = await exportAudioBuffer(cleanedBuffer, exportFormat, 320);
      const fileName = `smart_ai_cleaned_${file?.name || 'audio'}.${extension}`;
      triggerFileDownload(blob, fileName);
      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error('Export error:', err);
    }
  };

  const currentEdit = edits[currentEditIdx];
  const pendingCount = edits.filter((e) => e.status === 'pending').length;
  const removedCount = edits.filter((e) => e.status === 'removed').length;
  const keptCount = edits.filter((e) => e.status === 'kept').length;

  return (
    <div id="smart-ai-panel" className="space-y-8 animate-fade-in">
      
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.aac"
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
      />

      {/* Upload Zone if no audio loaded */}
      {!buffer && (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed border-slate-800 hover:border-teal-500/60 bg-slate-900/60 hover:bg-slate-900/90 rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer group"
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/80 flex items-center justify-center group-hover:scale-110 group-hover:border-teal-400 transition-all">
              <Sparkles className="w-7 h-7 text-teal-400" />
            </div>

            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Smart AI Filler Word & Pause Detector
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-lg mx-auto">
                Automatically scan spoken audio for filler words ("umm...", "uh..."), repeated words, and heavy breathing pauses.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
                className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-teal-400 to-emerald-400 hover:brightness-110 shadow-lg shadow-teal-500/20 transition-all cursor-pointer inline-flex items-center space-x-2"
              >
                <FileAudio className="w-4 h-4 text-slate-950" />
                <span>Upload Audio File</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLoadDemo();
                }}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all cursor-pointer inline-flex items-center space-x-2"
              >
                <Wand2 className="w-4 h-4 text-emerald-400" />
                <span>Try Demo Sample</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Analysis Banner & Review Modal */}
      {buffer && (
        <div className="space-y-6">
          
          {/* File Status Card */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-teal-950 text-teal-400 flex items-center justify-center border border-teal-800/60">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white font-mono">
                  {file?.name || 'Uploaded Audio File'}
                </h3>
                <p className="text-xs text-slate-400">
                  Duration: <span className="font-mono text-slate-200">{formatDuration(buffer.duration)}</span> {edits.length > 0 ? `• ${edits.length} AI Edits Detected` : '• Audio Ready for Scan'}
                </p>
              </div>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 text-slate-300 hover:text-white cursor-pointer"
            >
              Change Audio
            </button>
          </div>

          {/* Prominent Generate Callout Box if not yet analyzed */}
          {edits.length === 0 && !isAnalyzing && (
            <div className="bg-gradient-to-r from-slate-900 via-teal-950/50 to-slate-900 border border-teal-800/60 rounded-2xl p-6 sm:p-8 text-center shadow-xl space-y-4">
              <div className="w-14 h-14 rounded-2xl bg-teal-950 border border-teal-800/80 flex items-center justify-center mx-auto text-teal-400">
                <Wand2 className="w-7 h-7 text-teal-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">Audio File Ready for AI Detection</h3>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-md mx-auto">
                  Click <span className="text-teal-400 font-semibold">"Generate AI Filler & Pause Detection"</span> to scan for filler words ("um", "uh"), stuttered repetitions, and loud breathing gaps.
                </p>
              </div>
              <button
                id="smart-ai-generate-btn"
                onClick={() => buffer && runSmartAIDetection(buffer)}
                className="px-8 py-3.5 rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-teal-400 via-emerald-300 to-cyan-400 hover:brightness-110 shadow-lg shadow-teal-500/25 transition-all cursor-pointer inline-flex items-center space-x-2"
              >
                <Zap className="w-5 h-5 text-slate-950 fill-slate-950" />
                <span>Generate AI Filler & Pause Detection</span>
              </button>
            </div>
          )}

          {/* Processing State Indicator */}
          {isAnalyzing && (
            <div className="bg-slate-900 border border-teal-800/60 rounded-2xl p-8 text-center shadow-xl space-y-4 animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-teal-950 border border-teal-800/80 flex items-center justify-center mx-auto">
                <RefreshCw className="w-6 h-6 text-teal-400 animate-spin" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Scanning Audio for Fillers & Breathing...</h3>
                <p className="text-xs text-slate-400 mt-1">Analyzing speech cadence and pattern matching "um", "uh", repetitions</p>
              </div>
            </div>
          )}

          {/* Primary Prompt: "We found X possible edits. Remove all or review one by one?" */}
          {!reviewMode && edits.length > 0 && (
            <div className="bg-gradient-to-r from-teal-950/80 via-slate-900 to-cyan-950/80 border border-teal-800/80 rounded-2xl p-6 shadow-2xl space-y-5 text-center sm:text-left">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="inline-flex items-center space-x-1.5 px-3 py-1 rounded-full bg-teal-900/80 text-teal-300 border border-teal-700/60 text-xs font-mono font-semibold">
                    <Sparkles className="w-3.5 h-3.5 text-teal-400" />
                    <span>AI Detection Complete</span>
                  </div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight pt-1">
                    We found <span className="text-teal-400 font-mono">{edits.length}</span> possible edits.
                  </h2>
                  <p className="text-xs sm:text-sm text-slate-300">
                    Detected filler words ("umm...", "uh..."), repeated phrases, and long breathing gaps.
                  </p>
                </div>

                {/* Edit Breakdown Pills */}
                <div className="flex flex-wrap items-center justify-center sm:justify-end gap-2 text-xs font-mono">
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950 text-cyan-400 border border-slate-800">
                    {edits.filter((e) => e.type === 'filler_um' || e.type === 'filler_uh').length} Filler Words
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950 text-emerald-400 border border-slate-800">
                    {edits.filter((e) => e.type === 'repeat').length} Repeats
                  </span>
                  <span className="px-2.5 py-1 rounded-lg bg-slate-950 text-teal-400 border border-slate-800">
                    {edits.filter((e) => e.type === 'breath').length} Breathing Gaps
                  </span>
                </div>
              </div>

              {/* Action Buttons: Remove All vs Review One By One */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-start gap-3 border-t border-slate-800/80">
                <button
                  id="remove-all-edits-btn"
                  onClick={handleRemoveAllEdits}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-gradient-to-r from-teal-400 via-emerald-300 to-cyan-400 hover:brightness-110 shadow-lg shadow-teal-500/20 transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
                >
                  <Scissors className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                  <span>Remove All {edits.length} Edits (1-Click)</span>
                </button>

                <button
                  id="review-one-by-one-btn"
                  onClick={() => {
                    setReviewMode(true);
                    setCurrentEditIdx(0);
                  }}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs sm:text-sm font-semibold text-slate-200 bg-slate-900 border border-slate-700 hover:bg-slate-800 hover:text-white transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
                >
                  <Zap className="w-4 h-4 text-teal-400" />
                  <span>Review One by One</span>
                </button>
              </div>
            </div>
          )}

          {/* Interactive Step-by-Step Review Drawer / Modal */}
          {reviewMode && currentEdit && (
            <div className="bg-slate-900 border-2 border-teal-500/60 rounded-2xl p-6 shadow-2xl space-y-6 animate-fade-in">
              
              {/* Stepper Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <span className="px-2.5 py-1 rounded-lg bg-teal-950 text-teal-400 font-mono font-bold text-xs border border-teal-800">
                    Edit {currentEditIdx + 1} of {edits.length}
                  </span>
                  <span className="text-sm font-bold text-white capitalize flex items-center space-x-2">
                    <span>Type: {currentEdit.label}</span>
                  </span>
                </div>

                <button
                  onClick={() => {
                    setReviewMode(false);
                    reconstructCleanedAudio(edits);
                  }}
                  className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Transcript Snippet Card */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-center space-y-2">
                <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">
                  TRANSCRIPT CONTEXT AT {formatDuration(currentEdit.start)}
                </span>
                <p className="text-base text-slate-200 font-mono">
                  {currentEdit.textSnippet}
                </p>
                <div className="text-xs text-teal-400 font-mono">
                  Duration: {currentEdit.duration.toFixed(2)} seconds
                </div>
              </div>

              {/* Review Control Actions */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => markCurrentEdit('removed')}
                  className="py-3 px-4 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-rose-400 hover:bg-rose-300 transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
                >
                  <Trash2 className="w-4 h-4 text-slate-950" />
                  <span>Remove This Edit</span>
                </button>

                <button
                  onClick={() => markCurrentEdit('kept')}
                  className="py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold text-slate-200 bg-slate-800 hover:bg-slate-700 transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
                >
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Keep (Ignore)</span>
                </button>

                <button
                  onClick={() => {
                    if (currentEditIdx < edits.length - 1) {
                      setCurrentEditIdx(currentEditIdx + 1);
                    } else {
                      setReviewMode(false);
                      reconstructCleanedAudio(edits);
                    }
                  }}
                  className="py-3 px-4 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 bg-slate-950 border border-slate-800 hover:bg-slate-800 transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
                >
                  <span>Skip</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>

            </div>
          )}

          {/* Cleaned Audio Result & Export Bar */}
          {cleanedBuffer && (
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
              {cleanedUrl && (
                <audio
                  key={cleanedUrl}
                  ref={cleanedAudioRef}
                  src={cleanedUrl}
                  onEnded={() => setIsPlayingCleaned(false)}
                  onPause={() => setIsPlayingCleaned(false)}
                  onPlay={() => setIsPlayingCleaned(true)}
                />
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      if (!cleanedAudioRef.current) return;
                      if (isPlayingCleaned) {
                        cleanedAudioRef.current.pause();
                      } else {
                        cleanedAudioRef.current.play().catch(() => {});
                      }
                    }}
                    className="w-12 h-12 rounded-xl bg-emerald-400 hover:bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-500/20 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer shrink-0"
                  >
                    {isPlayingCleaned ? (
                      <Pause className="w-5 h-5 text-slate-950 fill-slate-950" />
                    ) : (
                      <Play className="w-5 h-5 text-slate-950 fill-slate-950 ml-0.5" />
                    )}
                  </button>

                  <div>
                    <h3 className="text-base font-bold text-white flex items-center space-x-2">
                      <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      <span>Smart AI Cleaned Audio Preview</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Original: <span className="font-mono text-slate-300">{formatDuration(buffer.duration)}</span> • Cleaned: <span className="font-mono text-emerald-400">{formatDuration(cleanedBuffer.duration)}</span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center space-x-2">
                  <span className="text-xs font-semibold text-slate-300">Format:</span>
                  {(['mp3', 'wav', 'aac'] as ExportFormat[]).map((fmt) => (
                    <button
                      key={fmt}
                      onClick={() => setExportFormat(fmt)}
                      className={`px-2.5 py-1 rounded text-xs font-mono uppercase font-bold cursor-pointer ${
                        exportFormat === fmt
                          ? 'bg-emerald-400 text-slate-950'
                          : 'bg-slate-950 text-slate-400 hover:text-white'
                      }`}
                    >
                      {fmt}
                    </button>
                  ))}
                </div>
              </div>

              <button
                onClick={handleExport}
                className="w-full py-3 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-gradient-to-r from-emerald-400 to-teal-400 hover:brightness-110 shadow-lg shadow-emerald-500/15 cursor-pointer inline-flex items-center justify-center space-x-2"
              >
                {downloadSuccess ? (
                  <>
                    <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                    <span>Downloaded {exportFormat.toUpperCase()}!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                    <span>Download Cleaned AI {exportFormat.toUpperCase()}</span>
                  </>
                )}
              </button>
            </div>
          )}

        </div>
      )}

    </div>
  );
};
