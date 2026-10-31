import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  BatchItem,
  BatchMergeMetrics,
  InterClipGapMs,
  AudioProcessingSettings,
  ExportFormat,
} from '../types';
import { PRESET_OPTIONS } from '../constants/presets';
import {
  decodeAudioFile,
  detectSilenceRegions,
  processAndConcatenateBuffer,
  formatDuration,
} from '../utils/audioProcessor';
import {
  mergeAudioBuffers,
  exportAudioBuffer,
  triggerFileDownload,
} from '../utils/audioExporter';
import { generateBatchSampleFiles } from '../utils/batchSampleGenerator';
import { saveGenerationHistoryItem } from '../utils/historyStorage';

import {
  Upload,
  Layers,
  ArrowUp,
  ArrowDown,
  Trash2,
  GripVertical,
  Plus,
  Sliders,
  CheckCircle2,
  Download,
  Play,
  Pause,
  Clock,
  Scissors,
  Volume2,
  Wand2,
  SortAsc,
  FileAudio,
  Zap,
  Check,
  Music,
  RefreshCw,
  AlertCircle,
  Archive,
  FileArchive,
  FolderArchive,
  FileText,
  Sparkles,
  ArrowDownUp,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import {
  unpackMultipleZipAndAudioFiles,
  isZipFile,
  isAudioFileName,
  createAudioZipArchive,
} from '../utils/zipHandler';
import { VoiceoverScriptArranger } from './VoiceoverScriptArranger';
import { SAMPLE_FISHAUDIO_DEMO } from '../utils/scriptAligner';
import { audioBufferToWavBlob } from '../utils/audioProcessor';
import { naturalSortClips, extractNaturalNumber, deduplicateClips } from '../utils/clientSpeechRecognizer';

export interface BatchMergePanelProps {
  initialFiles?: File[];
  onClearInitialFiles?: () => void;
  onOpenSubtitles?: (mergedUrl: string | null, mergedBuf: AudioBuffer | null, items: BatchItem[]) => void;
}

export const BatchMergePanel: React.FC<BatchMergePanelProps> = ({
  initialFiles,
  onClearInitialFiles,
  onOpenSubtitles,
}) => {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [gapMs, setGapMs] = useState<InterClipGapMs>(100);
  const [normalizeVolume, setNormalizeVolume] = useState<boolean>(true);
  const [trimSilence, setTrimSilence] = useState<boolean>(false); // false = Preserve 100% Speech (Zero Cuts)
  const [settings, setSettings] = useState<AudioProcessingSettings>(
    PRESET_OPTIONS[0].settings
  );
  const [exportFormat, setExportFormat] = useState<ExportFormat>('mp3');
  const [mp3Bitrate, setMp3Bitrate] = useState<number>(320);

  const [isProcessingBatch, setIsProcessingBatch] = useState<boolean>(false);
  const [isUnpackingZips, setIsUnpackingZips] = useState<boolean>(false);
  const [zipProgressText, setZipProgressText] = useState<string>('');
  const [zipExtractionNotice, setZipExtractionNotice] = useState<string | null>(null);
  const [duplicateNotice, setDuplicateNotice] = useState<string | null>(null);

  // Script Auto-Arranger (Fish Audio / Voiceover)
  const [showScriptArranger, setShowScriptArranger] = useState<boolean>(true);

  const [mergedBuffer, setMergedBuffer] = useState<AudioBuffer | null>(null);
  const [mergedAudioUrl, setMergedAudioUrl] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<BatchMergeMetrics | null>(null);

  // Track generation status and pending changes when user deletes/moves/adds clips
  const [hasGeneratedOnce, setHasGeneratedOnce] = useState<boolean>(false);
  const [hasPendingChanges, setHasPendingChanges] = useState<boolean>(false);
  const [lastChangeReason, setLastChangeReason] = useState<string>('');

  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);
  const [isDownloading, setIsDownloading] = useState<boolean>(false);
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [isDownloadingZipClips, setIsDownloadingZipClips] = useState<boolean>(false);
  const [downloadZipSuccess, setDownloadZipSuccess] = useState<boolean>(false);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playPromiseRef = useRef<Promise<void> | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Concurrency & file picker debounce refs
  const processedInitialFilesRef = useRef<File[] | null>(null);
  const isAddingFilesRef = useRef<boolean>(false);
  const isOpeningFilePickerRef = useRef<boolean>(false);
  const knownSignaturesRef = useRef<Set<string>>(new Set());

  // Keep knownSignaturesRef in sync with loaded items
  useEffect(() => {
    knownSignaturesRef.current = new Set(
      items.map((it) => `${it.name.toLowerCase().trim()}_${it.size}`)
    );
  }, [items]);

  const triggerBatchFileInput = () => {
    if (isOpeningFilePickerRef.current || isProcessingBatch) return;
    isOpeningFilePickerRef.current = true;
    fileInputRef.current?.click();
    setTimeout(() => {
      isOpeningFilePickerRef.current = false;
    }, 400);
  };

  // Sync playback rate & load new merged audio preview URL
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  useEffect(() => {
    if (audioRef.current && mergedAudioUrl) {
      audioRef.current.load();
      setIsPlaying(false);
    }
  }, [mergedAudioUrl]);

  // Handle incoming initialFiles idempotently (prevents double-processing in React StrictMode/re-renders)
  useEffect(() => {
    if (
      initialFiles &&
      initialFiles.length > 0 &&
      processedInitialFilesRef.current !== initialFiles
    ) {
      processedInitialFilesRef.current = initialFiles;
      addFilesToBatch(initialFiles);
      onClearInitialFiles?.();
    }
  }, [initialFiles, onClearInitialFiles]);

  const toggleBatchPlayPause = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      if (playPromiseRef.current) {
        await playPromiseRef.current.catch(() => {});
      }
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      try {
        const promise = audioRef.current.play();
        playPromiseRef.current = promise;
        await promise;
        setIsPlaying(true);
      } catch (err: unknown) {
        setIsPlaying(false);
      } finally {
        playPromiseRef.current = null;
      }
    }
  };

  // Item audio preview player
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const itemAudioRef = useRef<HTMLAudioElement | null>(null);
  const itemAudioUrlsRef = useRef<Map<string, string>>(new Map());

  // Clean up item preview URLs on unmount
  useEffect(() => {
    return () => {
      itemAudioUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      itemAudioUrlsRef.current.clear();
      if (itemAudioRef.current) {
        itemAudioRef.current.pause();
      }
    };
  }, []);

  const togglePlayItem = (itemId: string) => {
    const item = items.find((it) => it.id === itemId);
    if (!item) return;

    if (playingItemId === itemId) {
      if (itemAudioRef.current) {
        itemAudioRef.current.pause();
      }
      setPlayingItemId(null);
      return;
    }

    if (itemAudioRef.current) {
      itemAudioRef.current.pause();
    }

    let url = itemAudioUrlsRef.current.get(itemId);
    if (!url) {
      if (item.cleanedBuffer) {
        const blob = audioBufferToWavBlob(item.cleanedBuffer);
        url = URL.createObjectURL(blob);
      } else if (item.originalBuffer) {
        const blob = audioBufferToWavBlob(item.originalBuffer);
        url = URL.createObjectURL(blob);
      } else {
        url = URL.createObjectURL(item.file);
      }
      itemAudioUrlsRef.current.set(itemId, url);
    }

    const audio = new Audio(url);
    itemAudioRef.current = audio;
    audio.onended = () => setPlayingItemId(null);
    audio.onerror = () => setPlayingItemId(null);
    audio.play().catch(() => setPlayingItemId(null));
    setPlayingItemId(itemId);
  };

  // Helper natural numeric sorting (1, 2, ... 10, 11)
  const sortItemsByFilename = (itemList: BatchItem[]) => {
    return naturalSortClips(itemList);
  };

  // Count duplicate clips in current items list (matching by filename and size)
  const duplicateCount = useMemo(() => {
    const seen = new Set<string>();
    let dupes = 0;
    for (const it of items) {
      const sig = `${it.name.toLowerCase().trim()}_${it.size}`;
      if (seen.has(sig)) {
        dupes++;
      } else {
        seen.add(sig);
      }
    }
    return dupes;
  }, [items]);

  // Remove duplicate clips with one click
  const handleRemoveDuplicates = () => {
    const unique = deduplicateClips(items);
    const removedCount = items.length - unique.length;
    if (removedCount > 0) {
      setItems(unique);
      setHasPendingChanges(true);
      setLastChangeReason(`Removed ${removedCount} duplicate clip(s).`);
      setDuplicateNotice(`Removed ${removedCount} duplicate clip(s). Batch now has ${unique.length} unique clips.`);
      setTimeout(() => setDuplicateNotice(null), 4000);
    }
  };

  // Add files to batch list (supports audio files and multiple ZIP archives, with zero duplicate injection)
  const addFilesToBatch = async (files: File[]) => {
    if (files.length === 0) return;
    while (isAddingFilesRef.current) {
      await new Promise((r) => setTimeout(r, 40));
    }
    isAddingFilesRef.current = true;

    try {
      // Step 1: Deduplicate incoming raw files
      const seenIncoming = new Set<string>();
      const uniqueIncomingFiles: File[] = [];
      for (const f of files) {
        const sig = `${f.name.toLowerCase().trim()}_${f.size}`;
        if (!seenIncoming.has(sig)) {
          seenIncoming.add(sig);
          uniqueIncomingFiles.push(f);
        }
      }

      if (uniqueIncomingFiles.length === 0) return;

      const hasZip = uniqueIncomingFiles.some((f) => isZipFile(f));
      let filesToProcess: { file: File; archiveName?: string }[] = [];

      if (hasZip) {
        setIsUnpackingZips(true);
        setZipProgressText('Scanning and extracting audio tracks from ZIP archives...');
        try {
          const result = await unpackMultipleZipAndAudioFiles(uniqueIncomingFiles, (msg) => {
            setZipProgressText(msg);
          });

          if (result.audioFiles.length === 0) {
            alert('No supported audio files (.mp3, .wav, .m4a, .flac, .ogg, .aac) found inside the provided ZIP archive(s).');
            setIsUnpackingZips(false);
            return;
          }

          filesToProcess = result.audioFiles.map((af) => ({
            file: af.file,
            archiveName: af.archiveName || undefined,
          }));

          const zipCountStr = `${result.zipCount} ZIP archive${result.zipCount > 1 ? 's' : ''}`;
          setZipExtractionNotice(`Extracted ${result.audioFiles.length} audio tracks from ${zipCountStr} (${result.archiveNames.join(', ')}).`);
        } catch (err) {
          console.error('Failed to unpack ZIP archive:', err);
          alert('Could not unpack one or more ZIP archives. Please ensure the files are not password-protected or corrupted.');
          setIsUnpackingZips(false);
          return;
        } finally {
          setIsUnpackingZips(false);
        }
      } else {
        filesToProcess = uniqueIncomingFiles
          .filter((f) => f.type.startsWith('audio/') || isAudioFileName(f.name))
          .map((f) => ({ file: f }));
      }

      if (filesToProcess.length === 0) return;

      // Step 2: Use full identity (including archiveName and lastModified) so different clips are never dropped
      const genuinelyNewFiles: { file: File; archiveName?: string }[] = [];
      const seenCurrentBatch = new Set<string>();

      for (const item of filesToProcess) {
        const sig = `${item.archiveName || ''}_${item.file.name.toLowerCase().trim()}_${item.file.size}_${item.file.lastModified}`;
        if (!knownSignaturesRef.current.has(sig) && !seenCurrentBatch.has(sig)) {
          seenCurrentBatch.add(sig);
          knownSignaturesRef.current.add(sig);
          genuinelyNewFiles.push(item);
        }
      }

      const skippedDuplicates = filesToProcess.length - genuinelyNewFiles.length;

      if (genuinelyNewFiles.length === 0) {
        setDuplicateNotice(
          `All ${filesToProcess.length} selected audio clip(s) are already loaded in your batch list.`
        );
        setTimeout(() => setDuplicateNotice(null), 4500);
        return;
      }

      if (skippedDuplicates > 0) {
        setDuplicateNotice(
          `Added ${genuinelyNewFiles.length} new clip(s) (${skippedDuplicates} already loaded clip(s) skipped).`
        );
        setTimeout(() => setDuplicateNotice(null), 4500);
      }

      setIsProcessingBatch(true);
      const newItems: BatchItem[] = [];

      for (const item of genuinelyNewFiles) {
        const id = `batch-${Math.random().toString(36).substring(2, 8)}`;
        try {
          const buffer = await decodeAudioFile(item.file);
          const origDur = buffer.duration;

          newItems.push({
            id,
            file: item.file,
            name: item.file.name,
            size: item.file.size,
            archiveName: item.archiveName,
            originalBuffer: buffer,
            cleanedBuffer: null,
            originalDuration: origDur,
            cleanedDuration: origDur,
            silenceRemovedSec: 0,
            silenceCount: 0,
            status: 'ready',
          });
        } catch (err) {
          console.error(`Error decoding batch file ${item.file.name}:`, err);
          newItems.push({
            id,
            file: item.file,
            name: item.file.name,
            size: item.file.size,
            archiveName: item.archiveName,
            originalBuffer: null,
            cleanedBuffer: null,
            originalDuration: 0,
            cleanedDuration: 0,
            silenceRemovedSec: 0,
            silenceCount: 0,
            status: 'error',
            error: 'Failed to decode audio file',
          });
        }
      }

      setItems((prev) => {
        // Step 4: Strict defense-in-depth deduplication when appending to state
        const seenKeys = new Set<string>();
        const seenIds = new Set<string>();
        const combined: BatchItem[] = [];

        for (const it of prev) {
          const key = `${it.name.toLowerCase().trim()}_${it.size}`;
          if (!seenKeys.has(key) && !seenIds.has(it.id)) {
            seenKeys.add(key);
            seenIds.add(it.id);
            combined.push(it);
          }
        }

        for (const it of newItems) {
          const key = `${it.name.toLowerCase().trim()}_${it.size}`;
          if (!seenKeys.has(key) && !seenIds.has(it.id)) {
            seenKeys.add(key);
            seenIds.add(it.id);
            combined.push(it);
          }
        }

        const hasNumbers = combined.some((it) => extractNaturalNumber(it.name) !== null);
        if (prev.length === 0 && hasNumbers) {
          return sortItemsByFilename(combined);
        }
        return combined;
      });

      if (hasGeneratedOnce) {
        setHasPendingChanges(true);
        setLastChangeReason(`Added ${newItems.length} new audio clip(s). Click Regenerate to update master track.`);
      }
    } finally {
      setIsProcessingBatch(false);
      isAddingFilesRef.current = false;
    }
  };

  // Explicit Generate / Regenerate function triggered by user clicking Generate / Regenerate button
  const handleGenerateMergedAudio = async () => {
    const readyItems = items.filter((it) => it.status === 'ready' && it.originalBuffer);
    if (readyItems.length === 0) return;

    setIsProcessingBatch(true);

    try {
      // 1. Process individual clips (respecting trimSilence mode)
      const processedItems = await Promise.all(
        items.map(async (item) => {
          if (!item.originalBuffer) return item;

          if (!trimSilence) {
            // ZERO CUTS: Preserve 100% original speech and audio intact
            return {
              ...item,
              cleanedBuffer: item.originalBuffer,
              cleanedDuration: item.originalBuffer.duration,
              silenceRemovedSec: 0,
              silenceCount: 0,
              status: 'ready' as const,
            };
          }

          const { silenceRegions, keepRegions } = detectSilenceRegions(item.originalBuffer, settings);
          let cleaned = processAndConcatenateBuffer(item.originalBuffer, keepRegions);

          // Safety guard: if silence removal wiped out short speech, preserve originalBuffer
          if (cleaned.duration < 0.2 && item.originalBuffer.duration >= 0.3) {
            cleaned = item.originalBuffer;
          }

          const origDur = item.originalBuffer.duration;
          const cleanDur = cleaned.duration;

          return {
            ...item,
            cleanedBuffer: cleaned,
            cleanedDuration: cleanDur,
            silenceRemovedSec: Math.max(0, origDur - cleanDur),
            silenceCount: silenceRegions.length,
            status: 'ready' as const,
          };
        })
      );

      setItems(processedItems);

      // 2. Merge all cleaned buffers in current item order
      const validCleanedItems = processedItems.filter((it) => it.status === 'ready' && it.cleanedBuffer);
      if (validCleanedItems.length === 0) {
        setIsProcessingBatch(false);
        return;
      }

      const buffersToMerge = validCleanedItems.map((it) => it.cleanedBuffer!);
      const merged = mergeAudioBuffers(buffersToMerge, gapMs, normalizeVolume);

      const origTotal = validCleanedItems.reduce((sum, it) => sum + it.originalDuration, 0);
      const cleanTotal = merged.duration;
      const clipCleanTotalNoGaps = validCleanedItems.reduce((sum, it) => sum + it.cleanedDuration, 0);
      const totalRemoved = Math.max(0, origTotal - clipCleanTotalNoGaps);

      setMergedBuffer(merged);

      const res = await exportAudioBuffer(merged, 'wav');
      setMergedAudioUrl((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return URL.createObjectURL(res.blob);
      });

      setMetrics({
        originalTotalDuration: origTotal,
        cleanedTotalDuration: cleanTotal,
        totalSilenceRemoved: totalRemoved,
        clipsMergedCount: validCleanedItems.length,
      });

      // Save to generation history
      const now = new Date();
      const formattedDate = now.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      saveGenerationHistoryItem({
        id: `gen-batch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: Date.now(),
        formattedDate,
        title: `Batch Merged (${validCleanedItems.length} Clips)`,
        mode: 'batch',
        audioBlob: res.blob,
        duration: merged.duration,
        fileSize: res.blob.size,
        originalDuration: origTotal,
        cleanedDuration: cleanTotal,
        timeRemoved: totalRemoved,
        percentageRemoved: origTotal > 0 ? (totalRemoved / origTotal) * 100 : 0,
        clipsCount: validCleanedItems.length,
        silenceCount: processedItems.reduce((acc, it) => acc + (it.silenceCount || 0), 0),
        settingsSummary: `Merged ${validCleanedItems.length} clips • Gap: ${gapMs}ms • ${normalizeVolume ? 'Volume Normalized' : 'Natural Gain'}`,
        presetName: `Batch (${gapMs}ms gap)`,
      }).catch((err) => console.warn('Could not record batch generation history:', err));

      // Mark generation completed cleanly and clear pending state
      setHasGeneratedOnce(true);
      setHasPendingChanges(false);
      setLastChangeReason('');
    } catch (err) {
      console.error('Failed to generate merged audio:', err);
    } finally {
      setIsProcessingBatch(false);
    }
  };

  // Re-run settings on generate
  const reprocessAllItemsWithNewSettings = (newSettings: AudioProcessingSettings) => {
    setSettings(newSettings);
    if (hasGeneratedOnce) {
      setHasPendingChanges(true);
      setLastChangeReason('Silence detection settings updated. Click Regenerate to apply.');
    }
  };

  const handleGapChange = (newGap: InterClipGapMs) => {
    setGapMs(newGap);
    if (hasGeneratedOnce) {
      setHasPendingChanges(true);
      setLastChangeReason(`Inter-clip gap updated to ${newGap}ms. Click Regenerate to apply.`);
    }
  };

  const handleNormalizeVolumeChange = (val: boolean) => {
    setNormalizeVolume(val);
    if (hasGeneratedOnce) {
      setHasPendingChanges(true);
      setLastChangeReason(`Volume normalization ${val ? 'enabled' : 'disabled'}. Click Regenerate to apply.`);
    }
  };

  // Reordering functions
  const moveItem = (fromIdx: number, toIdx: number) => {
    if (toIdx < 0 || toIdx >= items.length) return;
    const updated = [...items];
    const [moved] = updated.splice(fromIdx, 1);
    updated.splice(toIdx, 0, moved);
    setItems(updated);
    if (hasGeneratedOnce) {
      setHasPendingChanges(true);
      setLastChangeReason('Clip order rearranged. Click Regenerate to update your master merged track.');
    }
  };

  const removeItem = (idx: number) => {
    const itemToRemove = items[idx];
    if (itemToRemove) {
      knownSignaturesRef.current.delete(`${itemToRemove.name.toLowerCase().trim()}_${itemToRemove.size}`);
    }
    const updated = items.filter((_, i) => i !== idx);
    setItems(updated);

    if (updated.length === 0) {
      setMergedBuffer(null);
      if (mergedAudioUrl) URL.revokeObjectURL(mergedAudioUrl);
      setMergedAudioUrl(null);
      setMetrics(null);
      setHasGeneratedOnce(false);
      setHasPendingChanges(false);
      setLastChangeReason('');
    } else {
      setHasPendingChanges(true);
      setLastChangeReason(
        `Deleted "${itemToRemove?.name || 'audio clip'}" (${updated.length} clips remaining). Click Regenerate to update your merged audio.`
      );
    }
  };

  const handleResetOrder = () => {
    setItems((prev) => sortItemsByFilename(prev));
    if (hasGeneratedOnce) {
      setHasPendingChanges(true);
      setLastChangeReason('Clips sorted in filename order. Click Regenerate to update audio.');
    }
  };

  const handleLoadDemoBatch = async () => {
    setIsProcessingBatch(true);
    try {
      const demoFiles = await generateBatchSampleFiles();
      await addFilesToBatch(demoFiles);
    } catch (err) {
      console.error('Failed to generate batch sample files:', err);
    } finally {
      setIsProcessingBatch(false);
    }
  };

  const handleLoadFishAudioDemo = async () => {
    setIsProcessingBatch(true);
    setShowScriptArranger(true);
    try {
      const sampleRate = 44100;
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const demoFiles: File[] = [];

      for (let i = 0; i < SAMPLE_FISHAUDIO_DEMO.clips.length; i++) {
        const demoClip = SAMPLE_FISHAUDIO_DEMO.clips[i];
        const duration = 4.0 + (i % 2) * 1.5;
        const totalSamples = Math.floor(sampleRate * duration);
        const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
        const channel = buffer.getChannelData(0);

        const pitch = 210 + i * 25;
        for (let s = 0; s < totalSamples; s++) {
          const t = s / sampleRate;
          if (t > 0.3 && t < duration - 0.3) {
            const tone =
              Math.sin(2 * Math.PI * pitch * t) * 0.4 +
              Math.sin(2 * Math.PI * pitch * 1.5 * t) * 0.2 +
              (Math.random() * 2 - 1) * 0.02;
            channel[s] = tone * 0.35;
          }
        }

        const wavBlob = audioBufferToWavBlob(buffer);
        const file = new File([wavBlob], demoClip.name, { type: 'audio/wav' });
        demoFiles.push(file);
      }

      await addFilesToBatch(demoFiles);
    } catch (err) {
      console.error('Failed to generate Fish Audio demo:', err);
    } finally {
      setIsProcessingBatch(false);
    }
  };

  // Handle Export Download
  const handleExportDownload = async () => {
    if (!mergedBuffer) return;
    setIsDownloading(true);

    try {
      const { blob, extension } = await exportAudioBuffer(mergedBuffer, exportFormat, mp3Bitrate);
      const fileName = `batch_merged_${items.length}_clips.${extension}`;
      triggerFileDownload(blob, fileName);

      setDownloadSuccess(true);
      setTimeout(() => setDownloadSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to export audio:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Handle Exporting All Cleaned Individual Clips as a ZIP archive
  const handleExportZipClips = async () => {
    const readyItems = items.filter((it) => it.cleanedBuffer && it.status === 'ready');
    if (readyItems.length === 0) {
      alert('Please click "Generate Audio" first so the clips have silence removed before exporting.');
      return;
    }

    setIsDownloadingZipClips(true);
    try {
      const zipEntries: { name: string; blob: Blob }[] = [];
      for (let i = 0; i < readyItems.length; i++) {
        const it = readyItems[i];
        if (!it.cleanedBuffer) continue;
        const baseName = it.name.replace(/\.[^/.]+$/, '');
        const ext = exportFormat === 'aac' ? 'm4a' : exportFormat;
        const clipFileName = `${String(i + 1).padStart(2, '0')}_cleaned_${baseName}.${ext}`;

        const res = await exportAudioBuffer(it.cleanedBuffer, exportFormat, mp3Bitrate);
        zipEntries.push({
          name: clipFileName,
          blob: res.blob,
        });
      }

      const zipBlob = await createAudioZipArchive(zipEntries);
      triggerFileDownload(zipBlob, `cleaned_audio_clips_${readyItems.length}_tracks.zip`);
      setDownloadZipSuccess(true);
      setTimeout(() => setDownloadZipSuccess(false), 3000);
    } catch (err) {
      console.error('Failed to export cleaned clips as zip:', err);
      alert('Could not generate ZIP archive of clips.');
    } finally {
      setIsDownloadingZipClips(false);
    }
  };

  // Drag and drop handler for files (supports audio and multiple zip archives)
  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const rawFiles = Array.from(e.dataTransfer.files) as File[];
    const files = rawFiles.filter(
      (f) => isZipFile(f) || f.type.startsWith('audio/') || isAudioFileName(f.name)
    );
    if (files.length > 0) {
      addFilesToBatch(files);
    }
  };

  return (
    <div id="batch-merge-panel" className="space-y-8 animate-fade-in">
      
      {/* Hidden File Input for Batch Upload */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.zip,application/zip,application/x-zip-compressed,multipart/x-zip"
        className="hidden"
        onChange={(e) => {
          if (e.target.files) {
            addFilesToBatch(Array.from(e.target.files));
          }
          e.target.value = '';
        }}
      />

      {/* ZIP Unpacking Progress State */}
      {isUnpackingZips && (
        <div className="bg-slate-900 border border-indigo-500/60 rounded-2xl p-6 sm:p-8 text-center shadow-2xl space-y-4 animate-pulse">
          <div className="w-14 h-14 rounded-2xl bg-indigo-950 border border-indigo-700/80 flex items-center justify-center mx-auto text-indigo-400">
            <Archive className="w-7 h-7 text-indigo-400 animate-bounce" />
          </div>
          <div>
            <h3 className="text-base font-bold text-white">Extracting Audio from ZIP Archive(s)...</h3>
            <p className="text-xs text-indigo-300 font-mono mt-1">{zipProgressText || 'Scanning and extracting audio files in browser...'}</p>
          </div>
        </div>
      )}

      {/* ZIP Extraction Notice Banner */}
      {zipExtractionNotice && (
        <div className="bg-gradient-to-r from-indigo-950/90 via-slate-900 to-indigo-950/90 border border-indigo-700/80 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs text-indigo-200 shadow-lg animate-fade-in">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-indigo-900/80 border border-indigo-700 flex items-center justify-center shrink-0">
              <Archive className="w-3.5 h-3.5 text-indigo-300" />
            </div>
            <span className="font-medium truncate">{zipExtractionNotice}</span>
          </div>
          <button
            onClick={() => setZipExtractionNotice(null)}
            className="text-indigo-400 hover:text-white text-xs px-2 py-1 rounded bg-indigo-900/70 hover:bg-indigo-800 transition-colors shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Duplicate Audio Notice Banner */}
      {duplicateNotice && (
        <div className="bg-gradient-to-r from-amber-950/90 via-slate-900 to-amber-950/90 border border-amber-600/70 rounded-xl p-3.5 sm:p-4 flex items-center justify-between gap-3 text-xs text-amber-200 shadow-lg animate-fade-in">
          <div className="flex items-center space-x-2.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-amber-900/80 border border-amber-600 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-3.5 h-3.5 text-amber-300" />
            </div>
            <span className="font-medium truncate">{duplicateNotice}</span>
          </div>
          <button
            onClick={() => setDuplicateNotice(null)}
            className="text-amber-400 hover:text-white text-xs px-2 py-1 rounded bg-amber-900/70 hover:bg-amber-800 transition-colors shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Top Upload / Demo Trigger Box if no items */}
      {items.length === 0 && !isUnpackingZips && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleFileDrop}
          onClick={triggerBatchFileInput}
          className="border-2 border-dashed border-slate-800 hover:border-cyan-500/60 bg-slate-900/60 hover:bg-slate-900/90 rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer group"
        >
          <div className="flex flex-col items-center space-y-4">
            <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-700/80 flex items-center justify-center group-hover:scale-110 group-hover:border-cyan-400 transition-all">
              <Layers className="w-7 h-7 text-cyan-400" />
            </div>

            <div>
              <div className="flex items-center justify-center space-x-2 mb-1.5">
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-950 text-indigo-300 border border-indigo-800 inline-flex items-center space-x-1">
                  <Archive className="w-3 h-3 text-indigo-400" />
                  <span>Multiple ZIPs Supported</span>
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-cyan-950 text-cyan-300 border border-cyan-800">
                  Batch Merger
                </span>
              </div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                Batch Audio Cleaner & Merger
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-lg mx-auto">
                Upload multiple audio files or <span className="text-cyan-400 font-medium">multiple .ZIP archives</span>. Audio tracks inside will be automatically extracted, cleaned of silence individually, volume normalized, and merged into one seamless track.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  triggerBatchFileInput();
                }}
                className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer inline-flex items-center space-x-2"
              >
                <Upload className="w-4 h-4 text-slate-950" />
                <span>Select Audio Files or ZIPs</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLoadDemoBatch();
                }}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all cursor-pointer inline-flex items-center space-x-2"
              >
                <Wand2 className="w-4 h-4 text-emerald-400" />
                <span>Try 3-Clip Batch Demo</span>
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleLoadFishAudioDemo();
                }}
                className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-indigo-200 bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/80 hover:border-indigo-500 transition-all cursor-pointer inline-flex items-center space-x-2 shadow-md shadow-indigo-950/30"
                title="Test with 4 out-of-order clips and full voiceover script"
              >
                <Sparkles className="w-4 h-4 text-cyan-400" />
                <span>Fish Audio Demo (Script Arranger)</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content Area when items exist */}
      {items.length > 0 && (
        <div className="space-y-8">
          
          {/* Controls & Options Bar */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl space-y-5">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center">
                  <Layers className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white flex items-center space-x-2">
                    <span>Batch Clip Manager</span>
                    <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                      {items.length} Files Uploaded
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400">
                    Arrange order, set clip spacing, and normalize volume levels
                  </p>
                </div>
              </div>

              {/* Top Action buttons: Add files, Filename Sort, Script Arranger, and Regenerate Audio */}
              <div className="flex flex-wrap items-center space-x-2 w-full md:w-auto justify-end gap-y-2">
                <button
                  id="batch-script-arranger-toggle-btn"
                  onClick={() => setShowScriptArranger((prev) => !prev)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer inline-flex items-center space-x-1.5 border ${
                    showScriptArranger
                      ? 'bg-gradient-to-r from-indigo-600 to-cyan-600 text-white border-cyan-400 shadow-md shadow-indigo-500/25'
                      : 'bg-indigo-950/80 text-indigo-300 border-indigo-700/80 hover:bg-indigo-900/90 hover:text-white'
                  }`}
                  title="Auto-arrange clips using original full voiceover script (Fish Audio mode)"
                >
                  <FileText className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Script Arranger</span>
                  <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-900 text-cyan-300 border border-indigo-700">
                    Fish Audio
                  </span>
                </button>

                {duplicateCount > 0 && (
                  <button
                    id="batch-remove-duplicates-btn"
                    onClick={handleRemoveDuplicates}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-950/90 text-amber-300 border border-amber-600/80 hover:bg-amber-900 hover:text-white transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow-md shadow-amber-950/40 animate-pulse"
                    title="Remove duplicate clips with identical filenames and file sizes"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-amber-400" />
                    <span>Remove {duplicateCount} Duplicate{duplicateCount > 1 ? 's' : ''}</span>
                  </button>
                )}

                <button
                  id="batch-sort-filename-btn"
                  onClick={handleResetOrder}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800/80 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all cursor-pointer inline-flex items-center space-x-1.5"
                  title="Sort clips by filename order (a1, a2, a3...)"
                >
                  <SortAsc className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Sort Order</span>
                </button>

                <button
                  id="batch-add-more-btn"
                  onClick={triggerBatchFileInput}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-950 bg-cyan-400 hover:bg-cyan-300 transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow-md shadow-cyan-500/10 font-semibold"
                >
                  <Plus className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                  <span>Add Clips</span>
                </button>

                <button
                  id="batch-header-regenerate-btn"
                  onClick={handleGenerateMergedAudio}
                  disabled={isProcessingBatch || items.length === 0}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow-md ${
                    hasPendingChanges
                      ? 'bg-gradient-to-r from-amber-400 to-orange-400 text-slate-950 hover:brightness-110 shadow-amber-500/25 animate-pulse'
                      : hasGeneratedOnce
                      ? 'bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 text-slate-950 hover:brightness-110 shadow-cyan-500/20'
                      : 'bg-gradient-to-r from-cyan-400 to-emerald-400 text-slate-950 hover:brightness-110 shadow-cyan-500/20'
                  }`}
                  title={hasGeneratedOnce ? 'Regenerate merged audio track' : 'Generate merged audio track'}
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-slate-950 stroke-[2.5] ${isProcessingBatch ? 'animate-spin' : ''}`} />
                  <span>{hasGeneratedOnce ? 'Regenerate Audio' : 'Generate Audio'}</span>
                </button>
              </div>
            </div>

            {/* Gap & Normalization Settings Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              
              {/* Inter-clip Gap Selector */}
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 space-y-1.5">
                <label className="text-xs font-semibold text-slate-300 flex items-center justify-between">
                  <span>Gap Between Clips</span>
                  <span className="font-mono text-cyan-400 font-bold">{gapMs} ms</span>
                </label>
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {([0, 100, 250, 500] as InterClipGapMs[]).map((ms) => (
                    <button
                      key={ms}
                      onClick={() => handleGapChange(ms)}
                      className={`py-1.5 rounded-lg text-xs font-mono font-semibold transition-all cursor-pointer ${
                        gapMs === ms
                          ? 'bg-cyan-400 text-slate-950 font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-white hover:bg-slate-800'
                      }`}
                    >
                      {ms} ms
                    </button>
                  ))}
                </div>
              </div>

              {/* Volume Normalization Toggle */}
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 flex items-center justify-between">
                <div>
                  <span className="text-xs font-semibold text-slate-200 block">
                    Normalize Volume Across Clips
                  </span>
                  <span className="text-[11px] text-slate-400 block mt-0.5">
                    Equalizes peak volume (0.95) across all tracks
                  </span>
                </div>
                <button
                  id="normalize-volume-toggle"
                  onClick={() => handleNormalizeVolumeChange(!normalizeVolume)}
                  className={`w-12 h-6 rounded-full transition-colors relative cursor-pointer p-0.5 ${
                    normalizeVolume ? 'bg-emerald-400' : 'bg-slate-800'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-slate-950 transition-transform ${
                      normalizeVolume ? 'translate-x-6' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Speech Preservation & Silence Mode */}
              <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800/80 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center space-x-1.5">
                    <ShieldCheck className={`w-3.5 h-3.5 ${!trimSilence ? 'text-emerald-400' : 'text-slate-400'}`} />
                    <span>Speech Mode</span>
                  </label>
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                    !trimSilence
                      ? 'bg-emerald-950/80 text-emerald-300 border-emerald-800/80'
                      : 'bg-amber-950/80 text-amber-300 border-amber-800/80'
                  }`}>
                    {!trimSilence ? 'Zero Cuts (100% Speech)' : `${settings.thresholdDb} dB Cut`}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setTrimSilence(false);
                      if (hasGeneratedOnce) {
                        setHasPendingChanges(true);
                        setLastChangeReason('Switched to Zero Cuts: All original speech preserved. Click Regenerate to update.');
                      }
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 border ${
                      !trimSilence
                        ? 'bg-emerald-950 text-emerald-300 border-emerald-500 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                    title="100% of speech audio is kept intact. No soft words or sentence endings are trimmed."
                  >
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Preserve Speech</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setTrimSilence(true);
                      if (hasGeneratedOnce) {
                        setHasPendingChanges(true);
                        setLastChangeReason('Switched to Trim Silence mode. Click Regenerate to update.');
                      }
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center justify-center space-x-1.5 border ${
                      trimSilence
                        ? 'bg-cyan-950 text-cyan-300 border-cyan-500 shadow-sm'
                        : 'bg-slate-900 text-slate-400 border-slate-800 hover:text-white'
                    }`}
                    title="Remove dead pauses from inside audio clips before merging"
                  >
                    <Scissors className="w-3.5 h-3.5" />
                    <span>Trim In-Clip Silence</span>
                  </button>
                </div>

                {trimSilence && (
                  <select
                    value={settings.thresholdDb}
                    onChange={(e) => {
                      const db = parseInt(e.target.value, 10);
                      reprocessAllItemsWithNewSettings({
                        ...settings,
                        thresholdDb: db,
                      });
                    }}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg text-xs text-white p-1.5 cursor-pointer focus:outline-none focus:border-cyan-400 font-mono mt-1"
                  >
                    <option value={-45}>Podcast Natural (-45 dB)</option>
                    <option value={-38}>Voiceover Standard (-38 dB)</option>
                    <option value={-30}>Aggressive Speech Cut (-30 dB)</option>
                    <option value={-55}>Conservative Low Noise (-55 dB)</option>
                  </select>
                )}
              </div>

            </div>
          </div>

          {/* Prominent Pending Changes Banner (e.g. When a clip is deleted or rearranged) */}
          {hasPendingChanges && (
            <div className="bg-gradient-to-r from-amber-950/70 via-slate-900 to-amber-950/70 border border-amber-500/60 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl animate-fade-in">
              <div className="flex items-center space-x-3 text-left">
                <div className="w-10 h-10 rounded-xl bg-amber-950 border border-amber-500/50 flex items-center justify-center shrink-0">
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-amber-200">Clip List Modified</h4>
                  <p className="text-xs text-amber-300/90 mt-0.5">
                    {lastChangeReason || 'You updated the clip list. Click Regenerate to update your master audio preview.'}
                  </p>
                </div>
              </div>

              <button
                id="batch-banner-regenerate-btn"
                onClick={handleGenerateMergedAudio}
                disabled={isProcessingBatch}
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-950 bg-gradient-to-r from-amber-400 to-orange-400 hover:brightness-110 shadow-lg shadow-amber-500/25 transition-all cursor-pointer inline-flex items-center justify-center space-x-2 shrink-0"
              >
                <RefreshCw className={`w-4 h-4 text-slate-950 stroke-[2.5] ${isProcessingBatch ? 'animate-spin' : ''}`} />
                <span>Regenerate Merged Audio</span>
              </button>
            </div>
          )}

          {/* Voiceover Script Auto-Arranger Panel (Fish Audio / AI Voiceover clips) */}
          {showScriptArranger ? (
            <VoiceoverScriptArranger
              items={items}
              onApplyArrangement={(reordered) => {
                setItems(reordered);
                setHasPendingChanges(true);
                setLastChangeReason('Clips rearranged to match voiceover script sequence');
              }}
              onAddGeneratedDemoClips={(demoFiles) => {
                addFilesToBatch(demoFiles);
              }}
              isProcessingBatch={isProcessingBatch}
            />
          ) : (
            <div className="bg-gradient-to-r from-indigo-950/60 via-slate-900 to-indigo-950/60 border border-indigo-800/70 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
              <div className="flex items-center space-x-3.5 text-left">
                <div className="w-11 h-11 rounded-xl bg-indigo-950 border border-indigo-700/80 flex items-center justify-center shrink-0">
                  <Sparkles className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>Generated voiceover clips in Fish Audio or ElevenLabs?</span>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-900 text-indigo-300 border border-indigo-700">
                      Auto-Arrange
                    </span>
                  </h4>
                  <p className="text-xs text-indigo-200/80 mt-0.5 max-w-xl">
                    Because text-to-speech character limits force scripts into separate audio chunks, clips are often out of order. Paste your original voiceover script to automatically transcribe each clip and arrange them in the exact right sequence!
                  </p>
                </div>
              </div>

              <button
                id="open-script-arranger-btn"
                onClick={() => setShowScriptArranger(true)}
                className="w-full sm:w-auto px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer inline-flex items-center justify-center space-x-2 shrink-0"
              >
                <FileText className="w-4 h-4 text-slate-950" />
                <span>Open Script Arranger</span>
              </button>
            </div>
          )}

          {/* Drag and Drop Reorderable Clip List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-slate-400 px-1 font-mono">
              <span>DRAG OR USE ARROWS TO REORDER MERGE SEQUENCE</span>
              <div className="flex items-center space-x-2">
                <span>{items.length} CLIPS</span>
                <button
                  type="button"
                  id="batch-natural-sort-btn"
                  onClick={() => {
                    const sorted = sortItemsByFilename(items);
                    setItems(sorted);
                    setHasPendingChanges(true);
                    setLastChangeReason('Sorted clips naturally by numeric sequence (1, 2, ... 10)');
                  }}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 text-[11px] font-mono cursor-pointer transition-colors inline-flex items-center space-x-1"
                  title="Sort clips by natural numbers in filename (e.g. 1, 2... 10)"
                >
                  <ArrowDownUp className="w-3 h-3 text-cyan-400" />
                  <span>Natural Sort</span>
                </button>
                <button
                  id="batch-list-regenerate-btn"
                  onClick={handleGenerateMergedAudio}
                  disabled={isProcessingBatch || items.length === 0}
                  className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-cyan-400 hover:text-cyan-300 border border-slate-700 text-[11px] font-mono cursor-pointer transition-colors inline-flex items-center space-x-1 font-bold"
                  title="Regenerate merged audio"
                >
                  <RefreshCw className={`w-3 h-3 ${isProcessingBatch ? 'animate-spin' : ''}`} />
                  <span>Regenerate</span>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDraggedIdx(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedIdx !== null && draggedIdx !== idx) {
                      moveItem(draggedIdx, idx);
                      setDraggedIdx(idx);
                    }
                  }}
                  onDragEnd={() => setDraggedIdx(null)}
                  className={`bg-slate-900 border border-slate-800/90 rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all ${
                    draggedIdx === idx ? 'border-cyan-400 bg-slate-800/80 opacity-60 scale-[0.99]' : 'hover:border-slate-700'
                  }`}
                >
                  {/* Left: Drag Handle, Sequence #, Preview Button & File Details */}
                  <div className="flex items-center space-x-3 min-w-0 flex-1">
                    <div className="text-slate-600 hover:text-slate-300 cursor-grab active:cursor-grabbing p-1">
                      <GripVertical className="w-5 h-5" />
                    </div>

                    <div className="w-7 h-7 rounded-lg bg-cyan-950 text-cyan-400 font-mono font-bold text-xs flex items-center justify-center shrink-0 border border-cyan-800/60">
                      #{idx + 1}
                    </div>

                    {/* Quick Preview Button */}
                    <button
                      type="button"
                      onClick={() => togglePlayItem(item.id)}
                      className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors cursor-pointer border ${
                        playingItemId === item.id
                          ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-md shadow-cyan-500/30'
                          : 'bg-slate-800 hover:bg-slate-700 text-cyan-400 border-slate-700'
                      }`}
                      title={playingItemId === item.id ? 'Pause clip' : 'Audition clip audio'}
                    >
                      {playingItemId === item.id ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                      )}
                    </button>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                        <span className="text-sm font-semibold text-white truncate font-mono">
                          {item.name}
                        </span>
                        {item.archiveName && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-indigo-950/90 text-indigo-300 border border-indigo-700 shrink-0 inline-flex items-center space-x-1">
                            <Archive className="w-3 h-3 text-indigo-400" />
                            <span>{item.archiveName}</span>
                          </span>
                        )}
                        {item.matchConfidence && (
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/90 text-cyan-300 border border-cyan-800 shrink-0">
                            {item.matchConfidence}% script match
                          </span>
                        )}
                        {item.status === 'ready' && (
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 shrink-0">
                            Cleaned
                          </span>
                        )}
                      </div>

                      {/* Display matched script snippet or transcript if present */}
                      {(item.matchedSnippet || item.transcript) && (
                        <p className="text-[11px] text-cyan-300/80 font-sans italic truncate max-w-xl mt-0.5">
                          "{item.matchedSnippet || item.transcript}"
                        </p>
                      )}

                      <div className="flex items-center space-x-3 text-xs text-slate-400 mt-0.5">
                        <span>Original: <span className="font-mono text-slate-300">{formatDuration(item.originalDuration)}</span></span>
                        <span>•</span>
                        <span>Cleaned: <span className="font-mono text-emerald-400">{formatDuration(item.cleanedDuration)}</span></span>
                        <span>•</span>
                        <span className="text-cyan-400">-{formatDuration(item.silenceRemovedSec)} silence</span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Up/Down arrow controls & remove */}
                  <div className="flex items-center space-x-1.5 shrink-0 self-end sm:self-center">
                    <button
                      onClick={() => moveItem(idx, idx - 1)}
                      disabled={idx === 0}
                      className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 cursor-pointer transition-colors"
                      title="Move clip up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => moveItem(idx, idx + 1)}
                      disabled={idx === items.length - 1}
                      className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-white hover:bg-slate-800 disabled:opacity-20 cursor-pointer transition-colors"
                      title="Move clip down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeItem(idx)}
                      className="p-1.5 rounded-lg bg-slate-950 text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 cursor-pointer transition-colors"
                      title="Remove clip"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Prominent Generate / Regenerate Callout Box */}
          {(!mergedAudioUrl || hasPendingChanges) && !isProcessingBatch && items.length > 0 && (
            <div className={`bg-gradient-to-r ${hasPendingChanges ? 'from-slate-900 via-amber-950/40 to-slate-900 border-amber-500/60' : 'from-slate-900 via-cyan-950/50 to-slate-900 border-cyan-800/60'} border rounded-2xl p-6 sm:p-8 text-center shadow-xl space-y-4`}>
              <div className={`w-14 h-14 rounded-2xl ${hasPendingChanges ? 'bg-amber-950/80 border-amber-500/80 text-amber-400' : 'bg-cyan-950 border-cyan-800/80 text-cyan-400'} border flex items-center justify-center mx-auto`}>
                <RefreshCw className="w-7 h-7" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-white">
                  {hasGeneratedOnce ? 'Audio Clips Modified — Ready to Regenerate' : `${items.length} Audio Clips Arranged & Ready`}
                </h3>
                <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-md mx-auto">
                  {hasPendingChanges
                    ? (lastChangeReason || 'Your clips list was modified. Click "Regenerate Cleaned & Merged Audio" to update your master audio preview.')
                    : 'Click "Generate Cleaned & Merged Audio" to trim silence from each file and stitch them into a seamless master track.'}
                </p>
              </div>
              <button
                id="batch-generate-btn"
                onClick={handleGenerateMergedAudio}
                className={`px-8 py-3.5 rounded-xl text-sm font-bold text-slate-950 ${
                  hasPendingChanges
                    ? 'bg-gradient-to-r from-amber-400 via-amber-300 to-orange-400 shadow-amber-500/25'
                    : 'bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 shadow-cyan-500/25'
                } hover:brightness-110 shadow-lg transition-all cursor-pointer inline-flex items-center space-x-2`}
              >
                <RefreshCw className="w-5 h-5 text-slate-950 stroke-[2.5]" />
                <span>{hasGeneratedOnce ? 'Regenerate Cleaned & Merged Audio' : 'Generate Cleaned & Merged Audio'}</span>
              </button>
            </div>
          )}

          {/* Processing Indicator State */}
          {isProcessingBatch && (
            <div className="bg-slate-900 border border-cyan-800/60 rounded-2xl p-8 text-center shadow-xl space-y-4 animate-pulse">
              <div className="w-12 h-12 rounded-2xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center mx-auto">
                <RefreshCw className="w-6 h-6 text-cyan-400 animate-spin" />
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Processing & Merging {items.length} Clips...</h3>
                <p className="text-xs text-slate-400 mt-1">Removing dead space, normalizing peak volume, and rendering preview track</p>
              </div>
            </div>
          )}

          {/* Merged Summary Metrics Cards */}
          {metrics && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Original Duration */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
                <div className="flex items-center justify-between text-xs text-slate-400 font-medium">
                  <span>Original Total</span>
                  <Clock className="w-4 h-4 text-slate-500" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-white font-mono">
                  {formatDuration(metrics.originalTotalDuration)}
                </div>
                <p className="text-[11px] text-slate-500">Combined raw audio length</p>
              </div>

              {/* Cleaned Duration */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
                <div className="flex items-center justify-between text-xs text-emerald-400 font-medium">
                  <span>Cleaned Total</span>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-emerald-400 font-mono">
                  {formatDuration(metrics.cleanedTotalDuration)}
                </div>
                <p className="text-[11px] text-slate-500">With {gapMs}ms clip gaps</p>
              </div>

              {/* Total Silence Removed */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
                <div className="flex items-center justify-between text-xs text-cyan-400 font-medium">
                  <span>Silence Removed</span>
                  <Scissors className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-cyan-400 font-mono">
                  -{formatDuration(metrics.totalSilenceRemoved)}
                </div>
                <p className="text-[11px] text-slate-500">Dead space cut out</p>
              </div>

              {/* Clips Merged Count */}
              <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-lg space-y-1">
                <div className="flex items-center justify-between text-xs text-teal-400 font-medium">
                  <span>Clips Merged</span>
                  <Layers className="w-4 h-4 text-teal-400" />
                </div>
                <div className="text-xl sm:text-2xl font-extrabold text-teal-400 font-mono">
                  {metrics.clipsMergedCount} Files
                </div>
                <p className="text-[11px] text-slate-500">Sequential seamless export</p>
              </div>
            </div>
          )}

          {/* Preview Player & Export Bar */}
          {mergedAudioUrl && (
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-6 shadow-2xl space-y-6">
              
              <audio
                key={mergedAudioUrl}
                ref={audioRef}
                src={mergedAudioUrl}
                onTimeUpdate={() => {
                  if (audioRef.current) setCurrentTime(audioRef.current.currentTime);
                }}
                onEnded={() => setIsPlaying(false)}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
              />

              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
                <div className="flex items-center space-x-3">
                  <button
                    onClick={toggleBatchPlayPause}
                    className="w-12 h-12 rounded-xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/20 flex items-center justify-center transition-transform hover:scale-105 cursor-pointer shrink-0"
                  >
                    {isPlaying ? (
                      <Pause className="w-5 h-5 text-slate-950 fill-slate-950" />
                    ) : (
                      <Play className="w-5 h-5 text-slate-950 fill-slate-950 ml-0.5" />
                    )}
                  </button>

                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                      <span>Final Merged Audio Preview</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950 text-cyan-400 border border-cyan-800">
                        {formatDuration(mergedBuffer?.duration || 0)}
                      </span>
                    </h4>
                    <p className="text-xs text-slate-400 mt-0.5 font-mono">
                      Current position: {formatDuration(currentTime)}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Regenerate button inside player header */}
                  <button
                    id="batch-player-regenerate-btn"
                    onClick={handleGenerateMergedAudio}
                    disabled={isProcessingBatch}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all cursor-pointer inline-flex items-center space-x-1.5 ${
                      hasPendingChanges
                        ? 'bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 shadow-md shadow-amber-500/25 animate-pulse'
                        : 'text-slate-200 bg-slate-950 hover:bg-slate-800 hover:text-white border border-slate-800'
                    }`}
                    title="Regenerate merged audio preview"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${hasPendingChanges ? 'text-slate-950' : 'text-cyan-400'} ${isProcessingBatch ? 'animate-spin' : ''}`} />
                    <span>Regenerate Audio</span>
                  </button>

                  {/* Speed selector */}
                  <div className="flex items-center space-x-1 text-xs text-slate-400 bg-slate-950 px-3 py-1.5 rounded-xl border border-slate-800">
                    <span className="text-[10px] font-mono uppercase text-slate-500 mr-1">Speed:</span>
                    {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                      <button
                        key={rate}
                        onClick={() => {
                          setPlaybackRate(rate);
                          if (audioRef.current) audioRef.current.playbackRate = rate;
                        }}
                        className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                          playbackRate === rate ? 'bg-cyan-400 text-slate-950 font-bold' : 'hover:text-white'
                        }`}
                      >
                        {rate}x
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Scrubber Range */}
              <input
                type="range"
                min="0"
                max={mergedBuffer?.duration || 100}
                step="0.1"
                value={currentTime}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setCurrentTime(val);
                  if (audioRef.current) audioRef.current.currentTime = val;
                }}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />

              {/* Export Config & Download Bar */}
              <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-4">
                
                {/* Format selection */}
                <div className="flex items-center space-x-4 w-full sm:w-auto">
                  <div>
                    <span className="text-xs font-semibold text-slate-300 block">Export Format</span>
                    <div className="flex items-center space-x-1.5 mt-1">
                      {(['mp3', 'wav', 'aac'] as ExportFormat[]).map((fmt) => (
                        <button
                          key={fmt}
                          onClick={() => setExportFormat(fmt)}
                          className={`px-3 py-1 rounded-lg text-xs font-mono uppercase font-bold transition-all cursor-pointer ${
                            exportFormat === fmt
                              ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                              : 'bg-slate-900 text-slate-400 hover:text-white'
                          }`}
                        >
                          {fmt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {exportFormat === 'mp3' && (
                    <div>
                      <span className="text-xs font-semibold text-slate-300 block">Bitrate</span>
                      <select
                        value={mp3Bitrate}
                        onChange={(e) => setMp3Bitrate(parseInt(e.target.value, 10))}
                        className="bg-slate-900 border border-slate-800 rounded-lg text-xs text-white p-1 mt-1 font-mono focus:outline-none"
                      >
                        <option value={192}>192 kbps (Standard)</option>
                        <option value={256}>256 kbps (High)</option>
                        <option value={320}>320 kbps (Maximum Quality)</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Download and Regenerate Action Buttons */}
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end">
                  <button
                    id="batch-footer-regenerate-btn"
                    onClick={handleGenerateMergedAudio}
                    disabled={isProcessingBatch}
                    className="px-3.5 py-3 rounded-xl text-xs sm:text-sm font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 hover:text-white border border-slate-800 transition-all cursor-pointer inline-flex items-center justify-center space-x-1.5"
                    title="Regenerate merged audio"
                  >
                    <RefreshCw className={`w-4 h-4 text-cyan-400 ${isProcessingBatch ? 'animate-spin' : ''}`} />
                    <span>Regenerate</span>
                  </button>

                  {/* Download All Cleaned Clips as ZIP */}
                  <button
                    id="batch-download-zip-btn"
                    onClick={handleExportZipClips}
                    disabled={isDownloadingZipClips || !hasGeneratedOnce}
                    className={`px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold border transition-all cursor-pointer inline-flex items-center justify-center space-x-1.5 ${
                      downloadZipSuccess
                        ? 'bg-indigo-500 text-white border-indigo-400 shadow-md shadow-indigo-500/20'
                        : 'bg-indigo-950/90 hover:bg-indigo-900/90 text-indigo-200 border-indigo-700/80 hover:border-indigo-500 shadow-sm'
                    }`}
                    title="Download individual cleaned clips packaged into one ZIP archive"
                  >
                    {downloadZipSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-white stroke-[3]" />
                        <span>Clips ZIP Downloaded!</span>
                      </>
                    ) : (
                      <>
                        <Archive className="w-4 h-4 text-indigo-400" />
                        <span>{isDownloadingZipClips ? 'Packing ZIP...' : 'Export Clips (.ZIP)'}</span>
                      </>
                    )}
                  </button>

                  {/* Create SRT Subtitles Studio Button */}
                  <button
                    id="batch-create-srt-btn"
                    onClick={() => {
                      onOpenSubtitles?.(mergedAudioUrl, mergedBuffer, items);
                    }}
                    className="px-4 py-3 rounded-xl text-xs sm:text-sm font-semibold border bg-cyan-950/80 hover:bg-cyan-900/80 text-cyan-200 border-cyan-700/80 hover:border-cyan-500 shadow-sm transition-all cursor-pointer inline-flex items-center justify-center space-x-1.5"
                    title="Generate and export .SRT and .VTT subtitle captions for YouTube and video editors"
                  >
                    <FileText className="w-4 h-4 text-cyan-400" />
                    <span>Create .SRT Captions</span>
                  </button>

                  {/* Download Merged Audio Track Button */}
                  <button
                    id="batch-download-btn"
                    onClick={handleExportDownload}
                    disabled={isDownloading || !mergedBuffer}
                    className={`flex-1 sm:flex-initial px-5 py-3 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-lg cursor-pointer inline-flex items-center justify-center space-x-2 border ${
                      downloadSuccess
                        ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                        : 'bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:brightness-110 text-slate-950 border-emerald-400/50 shadow-emerald-500/15'
                    }`}
                  >
                    {downloadSuccess ? (
                      <>
                        <Check className="w-4 h-4 text-slate-950 stroke-[3]" />
                        <span>Downloaded {exportFormat.toUpperCase()}!</span>
                      </>
                    ) : (
                      <>
                        <Download className="w-4 h-4 text-slate-950 stroke-[2.5]" />
                        <span>Download Merged {exportFormat.toUpperCase()}</span>
                      </>
                    )}
                  </button>
                </div>

              </div>

            </div>
          )}

        </div>
      )}

    </div>
  );
};
