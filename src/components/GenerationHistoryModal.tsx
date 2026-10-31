import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GenerationHistoryItem } from '../types';
import {
  clearAllGenerationHistory,
  deleteGenerationHistoryItem,
  formatBytes,
  formatDuration,
} from '../utils/historyStorage';
import { triggerFileDownload } from '../utils/audioExporter';
import {
  History,
  Play,
  Pause,
  Download,
  Trash2,
  Clock,
  Check,
  Search,
  Sliders,
  Layers,
  FileAudio,
  X,
  RotateCcw,
  Sparkles,
  Volume2,
  VolumeX,
  Wand2,
} from 'lucide-react';

interface GenerationHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  historyItems: GenerationHistoryItem[];
  onRestoreItem?: (item: GenerationHistoryItem) => void;
  onTrySample?: () => void;
}

export const GenerationHistoryModal: React.FC<GenerationHistoryModalProps> = ({
  isOpen,
  onClose,
  historyItems,
  onRestoreItem,
  onTrySample,
}) => {
  const [filterMode, setFilterMode] = useState<'all' | 'single' | 'batch'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);
  const [downloadSuccessId, setDownloadSuccessId] = useState<string | null>(null);
  const [restoredSuccessId, setRestoredSuccessId] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlRef = useRef<string | null>(null);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Clean up audio playback when closing or unmounting
  useEffect(() => {
    if (!isOpen) {
      if (audioRef.current) {
        audioRef.current.pause();
      }
      setPlayingId(null);
      setCurrentTime(0);
      if (activeBlobUrlRef.current) {
        URL.revokeObjectURL(activeBlobUrlRef.current);
        activeBlobUrlRef.current = null;
      }
    }
  }, [isOpen]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return historyItems.filter((item) => {
      const matchesFilter =
        filterMode === 'all' ||
        (filterMode === 'single' && item.mode === 'single') ||
        (filterMode === 'batch' && item.mode === 'batch');

      const matchesSearch =
        !searchQuery.trim() ||
        item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.settingsSummary.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.presetName && item.presetName.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchesFilter && matchesSearch;
    });
  }, [historyItems, filterMode, searchQuery]);

  // Total stats
  const totalStats = useMemo(() => {
    const totalCount = historyItems.length;
    const totalTimeSaved = historyItems.reduce((acc, it) => acc + (it.timeRemoved || 0), 0);
    const totalSilences = historyItems.reduce((acc, it) => acc + (it.silenceCount || 0), 0);
    return { totalCount, totalTimeSaved, totalSilences };
  }, [historyItems]);

  // Play / Pause handler
  const handleTogglePlay = (item: GenerationHistoryItem) => {
    if (playingId === item.id) {
      if (audioRef.current) {
        if (audioRef.current.paused) {
          audioRef.current.play();
        } else {
          audioRef.current.pause();
          setPlayingId(null);
        }
      }
      return;
    }

    // Play new item
    if (activeBlobUrlRef.current) {
      URL.revokeObjectURL(activeBlobUrlRef.current);
      activeBlobUrlRef.current = null;
    }

    const url = URL.createObjectURL(item.audioBlob);
    activeBlobUrlRef.current = url;

    if (!audioRef.current) {
      audioRef.current = new Audio();
    }

    audioRef.current.src = url;
    audioRef.current.muted = isMuted;
    audioRef.current.currentTime = 0;
    audioRef.current.play().then(() => {
      setPlayingId(item.id);
      setDuration(item.duration || 0);
    }).catch((err) => {
      console.error('Audio play error:', err);
    });

    audioRef.current.ontimeupdate = () => {
      if (audioRef.current) {
        setCurrentTime(audioRef.current.currentTime);
      }
    };

    audioRef.current.onended = () => {
      setPlayingId(null);
      setCurrentTime(0);
    };
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleToggleMute = () => {
    const next = !isMuted;
    setIsMuted(next);
    if (audioRef.current) {
      audioRef.current.muted = next;
    }
  };

  const handleDownload = (item: GenerationHistoryItem) => {
    const safeName = item.title.replace(/\.[^/.]+$/, '');
    const filename = `${safeName}_cleaned_DeadSpace.wav`;
    triggerFileDownload(item.audioBlob, filename);
    setDownloadSuccessId(item.id);
    setTimeout(() => setDownloadSuccessId(null), 3000);
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (playingId === id) {
      if (audioRef.current) audioRef.current.pause();
      setPlayingId(null);
    }
    await deleteGenerationHistoryItem(id);
  };

  const handleClearAll = async () => {
    if (audioRef.current) audioRef.current.pause();
    setPlayingId(null);
    await clearAllGenerationHistory();
    setConfirmClear(false);
  };

  const handleRestore = (item: GenerationHistoryItem) => {
    if (onRestoreItem) {
      onRestoreItem(item);
      setRestoredSuccessId(item.id);
      setTimeout(() => {
        setRestoredSuccessId(null);
        onClose();
      }, 700);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      id="generation-history-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 md:p-6 bg-slate-950/80 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        id="generation-history-modal"
        className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl shadow-cyan-950/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-800 flex items-start justify-between gap-4 bg-slate-950/60">
          <div className="flex items-start space-x-3.5">
            <div className="w-11 h-11 rounded-xl bg-cyan-950 border border-cyan-800/80 flex items-center justify-center shrink-0 shadow-lg shadow-cyan-500/15 text-cyan-400">
              <History className="w-6 h-6 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg sm:text-xl font-bold text-white font-mono">
                  Generation History
                </h3>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-cyan-950 border border-cyan-800/60 text-cyan-400">
                  {historyItems.length}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1">
                All rendered audio files, dead space reductions, and metrics are stored locally in your browser.
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {historyItems.length > 0 && (
              <>
                {confirmClear ? (
                  <div className="flex items-center space-x-2 bg-rose-950/80 border border-rose-800/80 px-2.5 py-1 rounded-xl">
                    <span className="text-[11px] text-rose-300 font-medium">Clear all?</span>
                    <button
                      id="confirm-clear-history-btn"
                      onClick={handleClearAll}
                      className="px-2 py-0.5 rounded bg-rose-500 hover:bg-rose-400 text-slate-950 text-xs font-bold cursor-pointer transition-colors"
                    >
                      Yes, Clear
                    </button>
                    <button
                      onClick={() => setConfirmClear(false)}
                      className="text-xs text-slate-400 hover:text-white px-1 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    id="clear-all-history-btn"
                    onClick={() => setConfirmClear(true)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 border border-slate-800 hover:border-rose-900/50 transition-all cursor-pointer inline-flex items-center space-x-1.5"
                    title="Clear all generation history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Clear All</span>
                  </button>
                )}
              </>
            )}

            <button
              id="close-history-modal-btn"
              onClick={onClose}
              className="w-9 h-9 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer border border-slate-700"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Stats Summary Bar (if there are items) */}
        {historyItems.length > 0 && (
          <div className="px-5 py-3 bg-slate-950/40 border-b border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex items-center space-x-4 text-slate-300 font-mono">
              <span className="flex items-center space-x-1.5">
                <span className="text-slate-500">Saved:</span>
                <span className="text-cyan-400 font-bold">{totalStats.totalCount} tracks</span>
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="text-slate-500">Dead Space Removed:</span>
                <span className="text-emerald-400 font-bold">{formatDuration(totalStats.totalTimeSaved)}</span>
              </span>
              {totalStats.totalSilences > 0 && (
                <span className="hidden sm:flex items-center space-x-1.5">
                  <span className="text-slate-500">Gaps Cut:</span>
                  <span className="text-teal-300 font-bold">{totalStats.totalSilences}</span>
                </span>
              )}
            </div>

            {/* Quick Filter tabs */}
            <div className="flex items-center space-x-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
              <button
                onClick={() => setFilterMode('all')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterMode === 'all'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                All ({historyItems.length})
              </button>
              <button
                onClick={() => setFilterMode('single')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterMode === 'single'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Single ({historyItems.filter((i) => i.mode === 'single').length})
              </button>
              <button
                onClick={() => setFilterMode('batch')}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                  filterMode === 'batch'
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Batch ({historyItems.filter((i) => i.mode === 'batch').length})
              </button>
            </div>
          </div>
        )}

        {/* Search Bar (shown when multiple items) */}
        {historyItems.length > 2 && (
          <div className="px-5 py-2.5 border-b border-slate-800/60 bg-slate-900/50">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                id="history-search-input"
                type="text"
                placeholder="Search history by audio name, preset, or settings..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-8 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-white text-xs cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Modal Body: List of Generations */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
          {historyItems.length === 0 ? (
            /* Empty State */
            <div className="text-center py-12 px-4 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center mx-auto text-slate-400">
                <Clock className="w-8 h-8 text-slate-500" />
              </div>
              <div className="max-w-md mx-auto">
                <h4 className="text-base sm:text-lg font-bold text-white">No Previous Generations Yet</h4>
                <p className="text-xs sm:text-sm text-slate-400 mt-1">
                  Once you process a single audio file or merge multiple clips in Batch Merge mode, your completed tracks and reduction metrics will appear here so you can listen, compare, and re-download them anytime.
                </p>
              </div>

              {onTrySample && (
                <button
                  onClick={() => {
                    onClose();
                    onTrySample();
                  }}
                  className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl text-xs font-bold text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:brightness-110 shadow-lg shadow-emerald-500/15 transition-all cursor-pointer mt-2"
                >
                  <Wand2 className="w-4 h-4 text-slate-950" />
                  <span>Try Sample Audio Now</span>
                </button>
              )}
            </div>
          ) : filteredItems.length === 0 ? (
            /* Search filter yielded no results */
            <div className="text-center py-10 text-slate-400 space-y-2">
              <p className="text-sm">No generations found matching "{searchQuery}".</p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setFilterMode('all');
                }}
                className="text-xs text-cyan-400 hover:underline cursor-pointer"
              >
                Reset filters
              </button>
            </div>
          ) : (
            /* List of Generations */
            filteredItems.map((item) => {
              const isPlaying = playingId === item.id;
              const isCurrentRestored = restoredSuccessId === item.id;
              const isDownloadSuccess = downloadSuccessId === item.id;

              return (
                <div
                  key={item.id}
                  id={`history-item-${item.id}`}
                  className={`bg-slate-950 border rounded-2xl p-4 sm:p-5 transition-all space-y-3.5 ${
                    isPlaying
                      ? 'border-cyan-500/70 shadow-lg shadow-cyan-500/10'
                      : 'border-slate-800 hover:border-slate-700/80'
                  }`}
                >
                  {/* Top Bar: Tags, Title, Date, Delete */}
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span
                          className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold uppercase tracking-wider ${
                            item.mode === 'batch'
                              ? 'bg-purple-950 text-purple-300 border border-purple-800/60'
                              : 'bg-cyan-950 text-cyan-300 border border-cyan-800/60'
                          }`}
                        >
                          {item.mode === 'batch'
                            ? `Batch Merge (${item.clipsCount || 'Multiple'} Clips)`
                            : 'Single Track'}
                        </span>
                        <span className="text-[11px] text-slate-400 flex items-center space-x-1 font-mono">
                          <Clock className="w-3 h-3 text-slate-500" />
                          <span>{item.formattedDate}</span>
                        </span>
                      </div>

                      <h4 className="text-sm sm:text-base font-bold text-white flex items-center space-x-2">
                        <FileAudio className="w-4 h-4 text-cyan-400 shrink-0" />
                        <span className="truncate max-w-md sm:max-w-xl">{item.title}</span>
                      </h4>
                    </div>

                    {/* Delete button */}
                    <button
                      onClick={(e) => handleDelete(item.id, e)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-400 hover:bg-rose-950/40 transition-colors cursor-pointer"
                      title="Delete from history"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Metrics Badge Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                    <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-2.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 block">Cleaned Duration</span>
                      <span className="font-mono font-bold text-white text-sm">
                        {formatDuration(item.cleanedDuration)}
                      </span>
                      <span className="text-[10px] text-slate-400 block line-through">
                        orig: {formatDuration(item.originalDuration)}
                      </span>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-2.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 block">Dead Space Cut</span>
                      <span className="font-mono font-bold text-emerald-400 text-sm">
                        -{formatDuration(item.timeRemoved)}
                      </span>
                      <span className="text-[10px] text-emerald-500 font-semibold block">
                        ({item.percentageRemoved.toFixed(1)}% trimmed)
                      </span>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-2.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 block">Silent Pauses</span>
                      <span className="font-mono font-bold text-teal-300 text-sm">
                        {item.silenceCount !== undefined ? item.silenceCount : 'Optimized'}
                      </span>
                      <span className="text-[10px] text-slate-500 block">silence intervals</span>
                    </div>

                    <div className="bg-slate-900/90 border border-slate-800/90 rounded-xl p-2.5">
                      <span className="text-[10px] font-mono uppercase text-slate-500 block">Settings Preset</span>
                      <span className="font-mono font-bold text-cyan-300 text-xs truncate block" title={item.settingsSummary}>
                        {item.presetName || 'Custom'}
                      </span>
                      <span className="text-[10px] text-slate-500 block">{formatBytes(item.fileSize)} WAV</span>
                    </div>
                  </div>

                  {/* Settings summary tag */}
                  {item.settingsSummary && (
                    <div className="flex items-center space-x-1.5 text-[11px] text-slate-400 font-mono bg-slate-900/50 px-3 py-1.5 rounded-lg border border-slate-800/60">
                      <Sliders className="w-3 h-3 text-cyan-400 shrink-0" />
                      <span className="truncate">{item.settingsSummary}</span>
                    </div>
                  )}

                  {/* Inline Audio Player Bar */}
                  <div className="bg-slate-900 border border-slate-800 rounded-xl p-3 flex flex-col sm:flex-row items-center gap-3">
                    <div className="flex items-center space-x-2.5 w-full sm:w-auto">
                      {/* Play / Pause button */}
                      <button
                        id={`history-play-btn-${item.id}`}
                        onClick={() => handleTogglePlay(item)}
                        className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all cursor-pointer shrink-0 shadow-md ${
                          isPlaying
                            ? 'bg-amber-400 text-slate-950 font-bold hover:bg-amber-300 shadow-amber-500/25'
                            : 'bg-cyan-400 text-slate-950 font-bold hover:bg-cyan-300 shadow-cyan-500/25'
                        }`}
                        title={isPlaying ? 'Pause' : 'Play cleaned audio'}
                      >
                        {isPlaying ? <Pause className="w-4 h-4 fill-slate-950" /> : <Play className="w-4 h-4 fill-slate-950 ml-0.5" />}
                      </button>

                      {/* Time display */}
                      <span className="text-xs font-mono text-slate-300 shrink-0 w-24">
                        {isPlaying ? formatDuration(currentTime) : '0:00.0s'} / {formatDuration(item.cleanedDuration)}
                      </span>
                    </div>

                    {/* Interactive Scrubber Bar */}
                    <div className="flex-1 w-full flex items-center space-x-2">
                      <input
                        type="range"
                        min={0}
                        max={item.cleanedDuration || 100}
                        step={0.05}
                        value={isPlaying ? currentTime : 0}
                        onChange={handleSeek}
                        disabled={!isPlaying}
                        className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-40"
                      />
                    </div>

                    {/* Mute button (when playing) */}
                    {isPlaying && (
                      <button
                        onClick={handleToggleMute}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white cursor-pointer transition-colors"
                        title={isMuted ? 'Unmute' : 'Mute'}
                      >
                        {isMuted ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                    )}

                    {/* Action buttons: Restore into Workspace & Download */}
                    <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
                      {onRestoreItem && (
                        <button
                          id={`history-restore-btn-${item.id}`}
                          onClick={() => handleRestore(item)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer inline-flex items-center space-x-1.5 ${
                            isCurrentRestored
                              ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white border-slate-700'
                          }`}
                          title="Load this track into the studio workspace"
                        >
                          {isCurrentRestored ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                              <span>Loaded!</span>
                            </>
                          ) : (
                            <>
                              <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
                              <span>Load in Studio</span>
                            </>
                          )}
                        </button>
                      )}

                      <button
                        id={`history-download-btn-${item.id}`}
                        onClick={() => handleDownload(item)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center space-x-1.5 shadow-sm ${
                          isDownloadSuccess
                            ? 'bg-emerald-500 text-slate-950'
                            : 'bg-gradient-to-r from-emerald-400 to-cyan-400 hover:brightness-110 text-slate-950'
                        }`}
                        title="Download WAV file"
                      >
                        {isDownloadSuccess ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-slate-950 stroke-[3]" />
                            <span>Downloaded!</span>
                          </>
                        ) : (
                          <>
                            <Download className="w-3.5 h-3.5 text-slate-950 stroke-[2.5]" />
                            <span>Download WAV</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/80 flex items-center justify-between text-xs text-slate-400">
          <span className="font-mono">
            {historyItems.length} generation{historyItems.length === 1 ? '' : 's'} recorded
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer border border-slate-700"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
