/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  AppMode,
  AudioProcessingSettings,
  PresetType,
  ProcessedAudioState,
  GenerationHistoryItem,
  BatchItem,
} from './types';
import { PRESET_OPTIONS } from './constants/presets';
import {
  audioBufferToWavBlob,
  decodeAudioFile,
  detectSilenceRegions,
  generateSampleAudio,
  processAndConcatenateBuffer,
} from './utils/audioProcessor';

import { Header } from './components/Header';
import { ModeSelector } from './components/ModeSelector';
import { UploadZone } from './components/UploadZone';
import { ControlsPanel } from './components/ControlsPanel';
import { MetricsCards } from './components/MetricsCards';
import { WaveformVisualizer } from './components/WaveformVisualizer';
import { AudioPlayerComparison } from './components/AudioPlayerComparison';
import { BatchMergePanel } from './components/BatchMergePanel';
import { SmartAIDetectionPanel } from './components/SmartAIDetectionPanel';
import { SrtSubtitleStudio } from './components/SrtSubtitleStudio';
import { ProModal } from './components/ProModal';
import { GenerationHistoryModal } from './components/GenerationHistoryModal';
import { Footer } from './components/Footer';
import {
  saveGenerationHistoryItem,
  subscribeToHistory,
} from './utils/historyStorage';
import { isZipFile, unpackMultipleZipAndAudioFiles } from './utils/zipHandler';

import { Zap, Wand2, RefreshCw, History, Check } from 'lucide-react';

export default function App() {
  const [appMode, setAppMode] = useState<AppMode>('single');
  const [settings, setSettings] = useState<AudioProcessingSettings>(
    PRESET_OPTIONS[0].settings
  );
  const [activePreset, setActivePreset] = useState<PresetType>('podcast');
  const [autoApply, setAutoApply] = useState<boolean>(false);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [loadingProgressText, setLoadingProgressText] = useState<string>('Loading audio...');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isProcessingSample, setIsProcessingSample] = useState<boolean>(false);

  const [isProOpen, setIsProOpen] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [historyItems, setHistoryItems] = useState<GenerationHistoryItem[]>([]);
  const [historyToast, setHistoryToast] = useState<{ show: boolean; title: string } | null>(null);

  const [activeMode, setActiveMode] = useState<'cleaned' | 'original'>('cleaned');
  const [currentTime, setCurrentTime] = useState<number>(0);

  const [processedData, setProcessedData] = useState<ProcessedAudioState>({
    originalFile: null,
    originalFileName: '',
    originalFileType: '',
    originalFileSize: 0,
    originalBuffer: null,
    cleanedBuffer: null,
    silenceRegions: [],
    keepRegions: [],
    metrics: null,
    cleanedWavBlob: null,
    cleanedWavUrl: null,
    originalAudioUrl: null,
  });

  const [pendingBatchFiles, setPendingBatchFiles] = useState<File[]>([]);
  const [subtitlesMergedAudioUrl, setSubtitlesMergedAudioUrl] = useState<string | null>(null);
  const [subtitlesMergedBuffer, setSubtitlesMergedBuffer] = useState<AudioBuffer | null>(null);
  const [subtitlesBatchItems, setSubtitlesBatchItems] = useState<BatchItem[]>([]);
  const [subtitlesScript, setSubtitlesScript] = useState<string>('');

  // Handle setting updates
  const handleSettingsChange = (
    newSettings: AudioProcessingSettings,
    presetId: PresetType = 'custom'
  ) => {
    setSettings(newSettings);
    setActivePreset(presetId);
  };

  // Run silence detection & audio stitching
  const processAudio = useCallback(
    async (
      buffer: AudioBuffer,
      procSettings: AudioProcessingSettings,
      origFile: File | null
    ) => {
      if (!buffer) return;
      setIsProcessing(true);

      try {
        // 1. Detect silence regions
        const { silenceRegions, keepRegions, metrics } = detectSilenceRegions(
          buffer,
          procSettings
        );

        // 2. Stitch non-silent regions into cleaned buffer
        const cleanedBuffer = processAndConcatenateBuffer(buffer, keepRegions);

        // 3. Encode cleaned buffer to WAV Blob
        const wavBlob = audioBufferToWavBlob(cleanedBuffer);

        // Clean up previous blob URL to avoid memory leaks
        if (processedData.cleanedWavUrl) {
          URL.revokeObjectURL(processedData.cleanedWavUrl);
        }

        const newWavUrl = URL.createObjectURL(wavBlob);

        // Create original audio blob URL if not present
        let origUrl = processedData.originalAudioUrl;
        if (!origUrl && origFile) {
          origUrl = URL.createObjectURL(origFile);
        } else if (!origUrl) {
          const rawWavBlob = audioBufferToWavBlob(buffer);
          origUrl = URL.createObjectURL(rawWavBlob);
        }

        setProcessedData((prev) => ({
          ...prev,
          originalBuffer: buffer,
          cleanedBuffer,
          silenceRegions,
          keepRegions,
          metrics,
          cleanedWavBlob: wavBlob,
          cleanedWavUrl: newWavUrl,
          originalAudioUrl: origUrl,
        }));

        // 4. Record to generation history
        const now = new Date();
        const formattedDate = now.toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        });

        const presetObj = PRESET_OPTIONS.find((p) => p.id === activePreset);
        const trackTitle = origFile?.name || processedData.originalFileName || 'Audio Track';

        saveGenerationHistoryItem({
          id: `gen-single-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          timestamp: Date.now(),
          formattedDate,
          title: trackTitle,
          mode: 'single',
          audioBlob: wavBlob,
          duration: cleanedBuffer.duration,
          fileSize: wavBlob.size,
          originalDuration: buffer.duration,
          cleanedDuration: cleanedBuffer.duration,
          timeRemoved: metrics.timeRemoved,
          percentageRemoved: metrics.percentageRemoved,
          silenceCount: metrics.silenceCount,
          settingsSummary: `Threshold: ${procSettings.thresholdDb}dB • Min Silence: ${procSettings.minSilenceDurationMs}ms • Pad: ${procSettings.paddingMs}ms`,
          presetName: presetObj ? presetObj.name : 'Custom',
        }).catch((err) => console.warn('Could not save single track history:', err));

        setHistoryToast({
          show: true,
          title: trackTitle,
        });
      } catch (err) {
        console.error('Error processing audio:', err);
      } finally {
        setIsProcessing(false);
      }
    },
    [processedData.cleanedWavUrl, processedData.originalAudioUrl, activePreset, processedData.originalFileName]
  );

  // Subscribe to generation history
  useEffect(() => {
    const unsubscribe = subscribeToHistory((items) => {
      setHistoryItems(items);
    });
    return unsubscribe;
  }, []);

  // Auto-dismiss toast
  useEffect(() => {
    if (historyToast?.show) {
      const timer = setTimeout(() => {
        setHistoryToast(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [historyToast]);

  // Restore previous generation to studio workspace
  const handleRestoreHistoryItem = async (item: GenerationHistoryItem) => {
    try {
      setIsLoading(true);
      setLoadingProgressText('Restoring generation to studio workspace...');

      const arrayBuffer = await item.audioBlob.arrayBuffer();
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      const buffer = await ctx.decodeAudioData(arrayBuffer);
      const newWavUrl = URL.createObjectURL(item.audioBlob);

      if (item.mode === 'batch') {
        setAppMode('batch');
      } else {
        setAppMode('single');
        setProcessedData((prev) => {
          if (prev.cleanedWavUrl) URL.revokeObjectURL(prev.cleanedWavUrl);
          return {
            ...prev,
            originalFileName: item.title,
            originalBuffer: prev.originalBuffer || buffer,
            cleanedBuffer: buffer,
            cleanedWavBlob: item.audioBlob,
            cleanedWavUrl: newWavUrl,
            originalAudioUrl: prev.originalAudioUrl || newWavUrl,
            metrics: {
              originalDuration: item.originalDuration,
              cleanedDuration: item.cleanedDuration,
              timeRemoved: item.timeRemoved,
              percentageRemoved: item.percentageRemoved,
              silenceCount: item.silenceCount || 0,
              speechRatio:
                item.originalDuration > 0
                  ? (item.cleanedDuration / item.originalDuration) * 100
                  : 100,
            },
          };
        });
        setActiveMode('cleaned');
        setCurrentTime(0);
      }
    } catch (err) {
      console.error('Failed to restore history item:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Auto-process when settings change if autoApply is enabled
  useEffect(() => {
    if (autoApply && processedData.originalBuffer) {
      const timer = setTimeout(() => {
        processAudio(processedData.originalBuffer!, settings, processedData.originalFile);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [settings, autoApply, processedData.originalBuffer]);

  // Handle file selection
  const handleFileSelected = async (file: File) => {
    setIsLoading(true);
    setLoadingProgressText('Decoding PCM audio channels...');

    try {
      const buffer = await decodeAudioFile(file);
      const origUrl = URL.createObjectURL(file);

      setProcessedData((prev) => {
        if (prev.cleanedWavUrl) URL.revokeObjectURL(prev.cleanedWavUrl);
        if (prev.originalAudioUrl) URL.revokeObjectURL(prev.originalAudioUrl);

        return {
          originalFile: file,
          originalFileName: file.name,
          originalFileType: file.type,
          originalFileSize: file.size,
          originalBuffer: buffer,
          cleanedBuffer: null,
          silenceRegions: [],
          keepRegions: [],
          metrics: null,
          cleanedWavBlob: null,
          cleanedWavUrl: null,
          originalAudioUrl: origUrl,
        };
      });
    } catch (err) {
      console.error('Failed to decode audio file:', err);
      alert('Could not decode this audio file. Please try another standard MP3 or WAV file.');
    } finally {
      setIsLoading(false);
    }
  };

  // Handle demo sample generator
  const handleLoadSample = async () => {
    setIsProcessingSample(true);
    setIsLoading(true);
    setLoadingProgressText('Generating synthetic spoken podcast demo...');

    try {
      const sampleFile = await generateSampleAudio();
      await handleFileSelected(sampleFile);
    } catch (err) {
      console.error('Failed to generate sample audio:', err);
    } finally {
      setIsProcessingSample(false);
      setIsLoading(false);
    }
  };

  // Handle files or zip selected from single track upload zone
  const handleFilesOrZipSelected = async (files: File[]) => {
    if (files.length === 0) return;

    // Single non-zip file -> load in single mode
    if (files.length === 1 && !isZipFile(files[0])) {
      await handleFileSelected(files[0]);
      return;
    }

    // Single ZIP file -> extract and inspect
    if (files.length === 1 && isZipFile(files[0])) {
      setIsLoading(true);
      setLoadingProgressText('Extracting audio from ZIP archive...');
      try {
        const result = await unpackMultipleZipAndAudioFiles(files, (msg) => {
          setLoadingProgressText(msg);
        });

        if (result.audioFiles.length === 0) {
          alert('No supported audio files (.mp3, .wav, .m4a, .aac, .flac, .ogg) found inside the ZIP archive.');
          return;
        }

        if (result.audioFiles.length === 1) {
          // Exactly 1 clip -> load directly in single track mode
          await handleFileSelected(result.audioFiles[0].file);
          return;
        }

        // Multiple audio tracks inside ZIP -> pass to batch merge mode!
        setPendingBatchFiles(result.audioFiles.map((af) => af.file));
        setAppMode('batch');
      } catch (err) {
        console.error('Failed to unpack zip file:', err);
        alert('Could not unpack ZIP file. Please verify it is not password-protected.');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Multiple files or multiple ZIP archives -> pass directly to batch merge mode
    setPendingBatchFiles(files);
    setAppMode('batch');
  };

  // Reset audio state
  const handleReset = () => {
    if (processedData.cleanedWavUrl) URL.revokeObjectURL(processedData.cleanedWavUrl);
    if (processedData.originalAudioUrl) URL.revokeObjectURL(processedData.originalAudioUrl);

    setProcessedData({
      originalFile: null,
      originalFileName: '',
      originalFileType: '',
      originalFileSize: 0,
      originalBuffer: null,
      cleanedBuffer: null,
      silenceRegions: [],
      keepRegions: [],
      metrics: null,
      cleanedWavBlob: null,
      cleanedWavUrl: null,
      originalAudioUrl: null,
    });
    setCurrentTime(0);
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if user is typing inside an input or range
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'KeyA') {
        setActiveMode('cleaned');
      } else if (e.code === 'KeyB') {
        setActiveMode('original');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const hasAudioLoaded = Boolean(processedData.originalBuffer);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-slate-950">
      
      {/* Header */}
      <Header
        onOpenPro={() => setIsProOpen(true)}
        onLoadSample={handleLoadSample}
        isProcessingSample={isProcessingSample}
        hasAudioLoaded={hasAudioLoaded}
        historyCount={historyItems.length}
        onOpenHistory={() => setIsHistoryOpen(true)}
      />

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Mode Selector Navigation */}
        <ModeSelector activeMode={appMode} onModeChange={setAppMode} />

        {/* Hero Banner Title (if in single mode & no audio loaded) */}
        {appMode === 'single' && !hasAudioLoaded && (
          <div className="text-center space-y-3 max-w-3xl mx-auto py-4">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/60 text-xs font-semibold font-mono">
              <Zap className="w-3.5 h-3.5 text-cyan-400 fill-cyan-400/20" />
              <span>Smart Audio Silence Remover</span>
            </div>
            <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
              Remove Dead Space from Audio <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">Instantly</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-400 max-w-xl mx-auto leading-relaxed">
              Automatically detect silent gaps, cut dead space, and preserve natural speech cadence for podcasts, talks, and voiceovers.
            </p>

            {/* Quick link to history if previous generations exist */}
            {historyItems.length > 0 && (
              <div className="pt-2">
                <button
                  id="hero-history-pill-btn"
                  onClick={() => setIsHistoryOpen(true)}
                  className="inline-flex items-center space-x-2 px-4 py-2 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-slate-800 hover:border-cyan-500/50 text-xs font-semibold text-slate-300 hover:text-white transition-all cursor-pointer shadow-lg shadow-cyan-950/20"
                >
                  <History className="w-3.5 h-3.5 text-cyan-400" />
                  <span>You have {historyItems.length} previous generation{historyItems.length === 1 ? '' : 's'} in history</span>
                  <span className="text-cyan-400 font-bold ml-1">View &rarr;</span>
                </button>
              </div>
            )}
          </div>
        )}

        {/* MODE 1: SINGLE FILE CLEANER */}
        {appMode === 'single' && (
          <div className="space-y-8">
            <UploadZone
              onFileSelected={handleFileSelected}
              onFilesOrZipSelected={handleFilesOrZipSelected}
              isLoading={isLoading}
              loadingProgressText={loadingProgressText}
              loadedFileName={processedData.originalFileName}
              loadedFileSize={processedData.originalFileSize}
              onReset={handleReset}
              onLoadSample={handleLoadSample}
            />

            {hasAudioLoaded && (
              <div className="space-y-8 animate-fade-in">
                {/* Detection Controls Panel */}
                <ControlsPanel
                  settings={settings}
                  activePreset={activePreset}
                  onSettingsChange={handleSettingsChange}
                  onProcess={() =>
                    processedData.originalBuffer &&
                    processAudio(processedData.originalBuffer, settings, processedData.originalFile)
                  }
                  isProcessing={isProcessing}
                  hasAudio={hasAudioLoaded}
                  autoApply={autoApply}
                  onToggleAutoApply={setAutoApply}
                  hasGenerated={Boolean(processedData.cleanedBuffer)}
                />

                {/* Prominent Generate Callout if not yet generated */}
                {!processedData.cleanedBuffer && !isProcessing && (
                  <div className="bg-gradient-to-r from-slate-900 via-cyan-950/50 to-slate-900 border border-cyan-800/60 rounded-2xl p-6 sm:p-8 text-center shadow-xl space-y-4">
                    <div className="w-14 h-14 rounded-2xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center mx-auto text-cyan-400">
                      <Wand2 className="w-7 h-7 text-cyan-400" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-white">Audio Loaded & Ready</h3>
                      <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-md mx-auto">
                        Click <span className="text-cyan-400 font-semibold">"Generate Cleaned Audio"</span> to scan for silent gaps, cut dead space, and generate your cleaned track preview.
                      </p>
                    </div>
                    <button
                      id="single-generate-btn"
                      onClick={() =>
                        processedData.originalBuffer &&
                        processAudio(processedData.originalBuffer, settings, processedData.originalFile)
                      }
                      className="px-8 py-3.5 rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/25 transition-all cursor-pointer inline-flex items-center space-x-2"
                    >
                      <Zap className="w-4 h-4 text-slate-950 fill-slate-950" />
                      <span>Generate Cleaned Audio</span>
                    </button>
                  </div>
                )}

                {/* Processing Indicator State */}
                {isProcessing && (
                  <div className="bg-slate-900 border border-cyan-800/60 rounded-2xl p-8 text-center shadow-xl space-y-4 animate-pulse">
                    <div className="w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center mx-auto">
                      <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-white">Processing Audio & Cutting Dead Space...</h3>
                      <p className="text-xs text-slate-400 mt-1">Analyzing PCM channel levels and stitching non-silent regions</p>
                    </div>
                  </div>
                )}

                {/* Results Section (Metrics, Waveform, Audio Player) */}
                {processedData.cleanedBuffer && (
                  <>
                    <MetricsCards metrics={processedData.metrics} />

                    <WaveformVisualizer
                      audioBuffer={
                        activeMode === 'cleaned'
                          ? processedData.cleanedBuffer
                          : processedData.originalBuffer
                      }
                      silenceRegions={
                        activeMode === 'cleaned' ? [] : processedData.silenceRegions
                      }
                      currentTime={currentTime}
                      duration={
                        activeMode === 'cleaned'
                          ? processedData.metrics?.cleanedDuration || 0
                          : processedData.metrics?.originalDuration || 0
                      }
                      onSeek={(timeSec) => setCurrentTime(timeSec)}
                      title={
                        activeMode === 'cleaned'
                          ? 'Cleaned Waveform (Silence Removed)'
                          : 'Original Waveform with Silence Overlay'
                      }
                      isCleanedVersion={activeMode === 'cleaned'}
                    />

                    <AudioPlayerComparison
                      originalAudioUrl={processedData.originalAudioUrl}
                      cleanedWavUrl={processedData.cleanedWavUrl}
                      cleanedWavBlob={processedData.cleanedWavBlob}
                      cleanedBuffer={processedData.cleanedBuffer}
                      originalFileName={processedData.originalFileName}
                      originalDuration={processedData.metrics?.originalDuration || 0}
                      cleanedDuration={processedData.metrics?.cleanedDuration || 0}
                      currentTime={currentTime}
                      onTimeUpdate={setCurrentTime}
                      activeMode={activeMode}
                      onSwitchMode={(mode) => {
                        setActiveMode(mode);
                        setCurrentTime(0);
                      }}
                      onRegenerate={() =>
                        processedData.originalBuffer &&
                        processAudio(processedData.originalBuffer, settings, processedData.originalFile)
                      }
                      isProcessing={isProcessing}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* MODE 2: BATCH MERGE MODE */}
        {appMode === 'batch' && (
          <BatchMergePanel
            initialFiles={pendingBatchFiles}
            onClearInitialFiles={() => setPendingBatchFiles([])}
            onOpenSubtitles={(mergedUrl, mergedBuf, items) => {
              setSubtitlesMergedAudioUrl(mergedUrl);
              setSubtitlesMergedBuffer(mergedBuf);
              setSubtitlesBatchItems(items);
              setAppMode('subtitles');
            }}
          />
        )}

        {/* MODE 3: SMART AI FILLER DETECTOR */}
        {appMode === 'smart_ai' && (
          <SmartAIDetectionPanel
            initialFile={processedData.originalFile}
            initialBuffer={processedData.originalBuffer}
          />
        )}

        {/* MODE 4: SRT SUBTITLES & CAPTIONS STUDIO */}
        {appMode === 'subtitles' && (
          <SrtSubtitleStudio
            batchItems={subtitlesBatchItems}
            mergedAudioUrl={subtitlesMergedAudioUrl || processedData.cleanedWavUrl || processedData.originalAudioUrl}
            mergedBuffer={subtitlesMergedBuffer || processedData.cleanedBuffer || processedData.originalBuffer}
            initialScript={subtitlesScript}
            onNavigateToBatch={() => setAppMode('batch')}
          />
        )}

      </main>

      {/* Footer */}
      <Footer />

      {/* Pro Modal */}
      <ProModal isOpen={isProOpen} onClose={() => setIsProOpen(false)} />

      {/* Generation History Modal */}
      <GenerationHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        historyItems={historyItems}
        onRestoreItem={handleRestoreHistoryItem}
        onTrySample={handleLoadSample}
      />

      {/* Floating Toast Notification when generation is saved */}
      {historyToast?.show && (
        <div
          id="history-toast"
          className="fixed bottom-6 right-6 z-40 bg-slate-900 border border-cyan-500/60 rounded-2xl p-4 shadow-2xl shadow-cyan-950/60 flex items-center space-x-3.5 max-w-sm animate-fade-in"
        >
          <div className="w-9 h-9 rounded-xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center text-cyan-400 shrink-0">
            <Check className="w-5 h-5 text-cyan-400 stroke-[2.5]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-white truncate">Saved to Generation History</p>
            <p className="text-[11px] text-slate-400 truncate">{historyToast.title}</p>
          </div>
          <button
            id="view-history-toast-btn"
            onClick={() => {
              setHistoryToast(null);
              setIsHistoryOpen(true);
            }}
            className="px-2.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 text-xs font-bold transition-colors cursor-pointer shrink-0"
          >
            View
          </button>
        </div>
      )}

    </div>
  );
}
