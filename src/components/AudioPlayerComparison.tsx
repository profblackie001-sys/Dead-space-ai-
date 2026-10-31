import React, { useEffect, useRef, useState } from 'react';
import { formatDuration } from '../utils/audioProcessor';
import { exportAudioBuffer, triggerFileDownload } from '../utils/audioExporter';
import { ExportFormat } from '../types';
import {
  Play,
  Pause,
  Download,
  Volume2,
  VolumeX,
  Zap,
  Music,
  Check,
  RefreshCw,
} from 'lucide-react';

interface AudioPlayerComparisonProps {
  originalAudioUrl: string | null;
  cleanedWavUrl: string | null;
  cleanedWavBlob: Blob | null;
  cleanedBuffer?: AudioBuffer | null;
  originalFileName?: string;
  originalDuration: number;
  cleanedDuration: number;
  currentTime: number;
  onTimeUpdate: (timeSec: number) => void;
  activeMode: 'cleaned' | 'original';
  onSwitchMode: (mode: 'cleaned' | 'original') => void;
  onRegenerate?: () => void;
  isProcessing?: boolean;
}

export const AudioPlayerComparison: React.FC<AudioPlayerComparisonProps> = ({
  originalAudioUrl,
  cleanedWavUrl,
  cleanedWavBlob,
  cleanedBuffer,
  originalFileName = 'audio',
  originalDuration,
  cleanedDuration,
  currentTime,
  onTimeUpdate,
  activeMode,
  onSwitchMode,
  onRegenerate,
  isProcessing = false,
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('wav');
  const [downloadSuccess, setDownloadSuccess] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);

  const activeUrl = activeMode === 'cleaned' ? cleanedWavUrl : originalAudioUrl;
  const activeTotalDuration = activeMode === 'cleaned' ? cleanedDuration : originalDuration;

  const playPromiseRef = useRef<Promise<void> | null>(null);

  // Handle URL change or audio node binding
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume;
      audioRef.current.playbackRate = playbackRate;
    }
  }, [volume, isMuted, playbackRate]);

  useEffect(() => {
    if (audioRef.current && activeUrl) {
      audioRef.current.load();
      setIsPlaying(false);
    }
  }, [activeUrl]);

  // Sync external seek time if playhead moved manually
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = newTime;
    }
    onTimeUpdate(newTime);
  };

  const togglePlayPause = async () => {
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

  const handleAudioTimeUpdate = () => {
    if (audioRef.current) {
      onTimeUpdate(audioRef.current.currentTime);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    onTimeUpdate(0);
  };

  const handleDownload = async () => {
    const baseName = originalFileName.replace(/\.[^/.]+$/, '');

    if (cleanedBuffer) {
      setIsExporting(true);
      try {
        const { blob, extension } = await exportAudioBuffer(cleanedBuffer, exportFormat, 320);
        triggerFileDownload(blob, `${baseName}_deadspace_removed.${extension}`);
        setDownloadSuccess(true);
        setTimeout(() => setDownloadSuccess(false), 3000);
      } catch (err) {
        console.error('Failed to export audio:', err);
      } finally {
        setIsExporting(false);
      }
      return;
    }

    if (!cleanedWavUrl && !cleanedWavBlob) return;
    const cleanFileName = `${baseName}_deadspace_removed.wav`;

    const a = document.createElement('a');
    a.href = cleanedWavUrl || (cleanedWavBlob ? URL.createObjectURL(cleanedWavBlob) : '');
    a.download = cleanFileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setDownloadSuccess(true);
    setTimeout(() => setDownloadSuccess(false), 3000);
  };

  const toggleMode = async (mode: 'cleaned' | 'original') => {
    const wasPlaying = isPlaying;
    if (audioRef.current) {
      if (playPromiseRef.current) {
        await playPromiseRef.current.catch(() => {});
      }
      audioRef.current.pause();
    }
    setIsPlaying(false);
    onTimeUpdate(0);
    onSwitchMode(mode);

    if (wasPlaying) {
      setTimeout(() => {
        if (audioRef.current) {
          const promise = audioRef.current.play();
          playPromiseRef.current = promise;
          promise.then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
      }, 100);
    }
  };

  return (
    <div id="audio-player-card" className="bg-gradient-to-b from-slate-900 to-slate-950 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-2xl space-y-6">
      
      {/* Hidden audio element */}
      {activeUrl && (
        <audio
          key={activeUrl}
          ref={audioRef}
          src={activeUrl}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={handleAudioEnded}
          onPause={() => setIsPlaying(false)}
          onPlay={() => setIsPlaying(true)}
        />
      )}

      {/* Top Bar: A/B Mode Toggle & Download Button */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        
        {/* A/B Switcher */}
        <div className="bg-slate-950 p-1.5 rounded-xl border border-slate-800 flex items-center space-x-1.5 w-full sm:w-auto">
          <button
            id="play-cleaned-tab"
            onClick={() => toggleMode('cleaned')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 ${
              activeMode === 'cleaned'
                ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-md shadow-cyan-500/20'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Cleaned Audio (Silence Removed)</span>
          </button>

          <button
            id="play-original-tab"
            onClick={() => toggleMode('original')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 ${
              activeMode === 'original'
                ? 'bg-slate-800 text-white shadow-md'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Music className="w-3.5 h-3.5" />
            <span>Original Raw Audio</span>
          </button>
        </div>

        {/* Download Cleaned Audio Button & Format Selector */}
        <div className="flex flex-wrap items-center space-x-2.5 w-full sm:w-auto justify-end gap-y-2">
          {onRegenerate && (
            <button
              id="player-regenerate-btn"
              onClick={onRegenerate}
              disabled={isProcessing}
              className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-300 bg-slate-900 hover:bg-slate-800 hover:text-white border border-slate-800 transition-all cursor-pointer inline-flex items-center space-x-1.5"
              title="Regenerate cleaned audio"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-cyan-400 ${isProcessing ? 'animate-spin' : ''}`} />
              <span>Regenerate</span>
            </button>
          )}

          {/* Format selector */}
          <div className="bg-slate-950 p-1 rounded-xl border border-slate-800 flex items-center space-x-1">
            {(['wav', 'mp3', 'aac'] as ExportFormat[]).map((fmt) => (
              <button
                key={fmt}
                onClick={() => setExportFormat(fmt)}
                className={`px-2.5 py-1 rounded-lg text-xs font-mono uppercase font-bold transition-all cursor-pointer ${
                  exportFormat === fmt
                    ? 'bg-emerald-400 text-slate-950 shadow-md shadow-emerald-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-slate-900'
                }`}
              >
                {fmt}
              </button>
            ))}
          </div>

          <button
            id="download-cleaned-audio-btn"
            onClick={handleDownload}
            disabled={isExporting || (!cleanedWavUrl && !cleanedWavBlob && !cleanedBuffer)}
            className={`flex-1 sm:flex-none px-5 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all shadow-lg cursor-pointer inline-flex items-center justify-center space-x-2 border ${
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
                <span>Download {exportFormat.toUpperCase()}</span>
              </>
            )}
          </button>
        </div>

      </div>

      {/* Primary Player Controls */}
      <div className="bg-slate-950/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 space-y-4">
        
        {/* Playback Progress Scrubber */}
        <div className="space-y-1.5">
          <input
            type="range"
            min="0"
            max={activeTotalDuration || 100}
            step="0.1"
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex items-center justify-between text-xs font-mono text-slate-400">
            <span>{formatDuration(currentTime)}</span>
            <span className="text-slate-500 text-[10px] uppercase tracking-wider font-semibold">
              Currently Previewing: {activeMode === 'cleaned' ? 'Cleaned Version' : 'Original Raw'}
            </span>
            <span>{formatDuration(activeTotalDuration)}</span>
          </div>
        </div>

        {/* Control Buttons Row */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-1">
          
          {/* Left: Play/Pause Big Button */}
          <div className="flex items-center space-x-3 w-full sm:w-auto justify-center sm:justify-start">
            <button
              id="main-play-pause-btn"
              onClick={togglePlayPause}
              disabled={!activeUrl}
              className="w-12 h-12 rounded-2xl bg-cyan-400 hover:bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-500/25 flex items-center justify-center transition-all transform hover:scale-105 cursor-pointer disabled:opacity-50"
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 text-slate-950 fill-slate-950" />
              ) : (
                <Play className="w-5 h-5 text-slate-950 fill-slate-950 ml-0.5" />
              )}
            </button>

            {/* Live VU meter animation during playback */}
            <div className="flex items-center space-x-1 h-6 px-3 bg-slate-900 rounded-lg border border-slate-800">
              {[0.4, 0.8, 0.6, 1.0, 0.5, 0.7].map((heightRatio, i) => (
                <div
                  key={i}
                  className={`w-1 rounded-full bg-cyan-400 transition-all duration-150 ${
                    isPlaying ? 'animate-pulse' : 'opacity-30'
                  }`}
                  style={{
                    height: isPlaying ? `${Math.max(20, heightRatio * 100)}%` : '20%',
                    animationDelay: `${i * 100}ms`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Center/Right: Speed & Volume Controls */}
          <div className="flex items-center space-x-4 w-full sm:w-auto justify-center sm:justify-end">
            
            {/* Speed Selector */}
            <div className="flex items-center space-x-1 text-xs text-slate-400 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800">
              <span className="text-[10px] font-mono uppercase text-slate-500 mr-1">Speed:</span>
              {[0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <button
                  key={rate}
                  onClick={() => setPlaybackRate(rate)}
                  className={`px-1.5 py-0.5 rounded text-[11px] font-mono cursor-pointer transition-colors ${
                    playbackRate === rate
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'hover:text-white'
                  }`}
                >
                  {rate}x
                </button>
              ))}
            </div>

            {/* Volume Control */}
            <div className="flex items-center space-x-2 text-slate-400 bg-slate-900 px-2.5 py-1.5 rounded-xl border border-slate-800">
              <button
                onClick={() => setIsMuted(!isMuted)}
                className="hover:text-white transition-colors cursor-pointer"
              >
                {isMuted || volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-rose-400" />
                ) : (
                  <Volume2 className="w-4 h-4 text-cyan-400" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={(e) => {
                  setVolume(parseFloat(e.target.value));
                  setIsMuted(false);
                }}
                className="w-16 h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

          </div>

        </div>

      </div>

    </div>
  );
};
