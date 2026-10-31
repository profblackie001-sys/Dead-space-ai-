import React, { useEffect, useRef, useState } from 'react';
import { SilenceRegion } from '../types';
import { formatDuration } from '../utils/audioProcessor';
import { ZoomIn, ZoomOut, Maximize2, Layers, Eye, ShieldAlert } from 'lucide-react';

interface WaveformVisualizerProps {
  audioBuffer: AudioBuffer | null;
  silenceRegions: SilenceRegion[];
  currentTime: number; // current playback position in seconds
  duration: number;    // total duration in seconds
  onSeek: (timeSec: number) => void;
  title?: string;
  isCleanedVersion?: boolean;
}

export const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({
  audioBuffer,
  silenceRegions,
  currentTime,
  duration,
  onSeek,
  title = 'Audio Waveform & Silence Detection',
  isCleanedVersion = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(1); // 1x to 5x
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverRegion, setHoverRegion] = useState<SilenceRegion | null>(null);

  // Redraw waveform canvas when dependencies change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.parentElement?.clientWidth || 800;
    const height = 140;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    ctx.scale(dpr, dpr);

    // Clear background
    ctx.fillStyle = '#020617'; // slate-950
    ctx.fillRect(0, 0, width, height);

    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const step = Math.ceil(totalSamples / width);
    const centerY = height / 2;

    // Draw baseline grid lines
    ctx.strokeStyle = '#1e293b'; // slate-800
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    // 1. Draw Silence Regions (Red Overlays)
    if (!isCleanedVersion && silenceRegions.length > 0) {
      silenceRegions.forEach((region) => {
        const startX = (region.start / duration) * width;
        const endX = (region.end / duration) * width;
        const regionWidth = Math.max(2, endX - startX);

        // Translucent red fill for silence gap
        ctx.fillStyle = 'rgba(244, 63, 94, 0.18)'; // rose-500/18
        ctx.fillRect(startX, 0, regionWidth, height);

        // Top border line for silence gap
        ctx.fillStyle = '#f43f5e';
        ctx.fillRect(startX, 0, regionWidth, 2);
        ctx.fillRect(startX, height - 2, regionWidth, 2);
      });
    }

    // 2. Draw Peaks Waveform
    const barWidth = 2;
    const barGap = 1;
    const numBars = Math.floor(width / (barWidth + barGap));

    for (let i = 0; i < numBars; i++) {
      const x = i * (barWidth + barGap);
      const startSample = Math.floor((i / numBars) * totalSamples);
      const endSample = Math.min(startSample + step, totalSamples);

      let min = 1.0;
      let max = -1.0;
      for (let j = startSample; j < endSample; j += Math.max(1, Math.floor(step / 10))) {
        const val = channelData[j];
        if (val < min) min = val;
        if (val > max) max = val;
      }

      const amplitude = Math.max(0.02, (max - min) / 2);
      const barHeight = amplitude * (height - 24);

      // Color logic: if in silence region, draw muted rose bar, else energetic cyan/emerald
      const barTimeSec = (i / numBars) * duration;
      const isSilent = !isCleanedVersion && silenceRegions.some(r => barTimeSec >= r.start && barTimeSec <= r.end);

      if (isSilent) {
        ctx.fillStyle = '#9f1239'; // rose-900
      } else {
        // Gradient color for speech peaks
        const gradient = ctx.createLinearGradient(x, centerY - barHeight / 2, x, centerY + barHeight / 2);
        if (isCleanedVersion) {
          gradient.addColorStop(0, '#2dd4bf'); // teal-400
          gradient.addColorStop(1, '#06b6d4'); // cyan-500
        } else {
          gradient.addColorStop(0, '#38bdf8'); // sky-400
          gradient.addColorStop(1, '#10b981'); // emerald-500
        }
        ctx.fillStyle = gradient;
      }

      ctx.fillRect(x, centerY - barHeight / 2, barWidth, barHeight);
    }

    // 3. Draw Timeline Time Markers
    ctx.fillStyle = '#64748b'; // slate-500
    ctx.font = '10px monospace';
    const numRulers = 6;
    for (let r = 0; r <= numRulers; r++) {
      const rulerX = (r / numRulers) * width;
      const timeSec = (r / numRulers) * duration;
      ctx.fillText(formatDuration(timeSec), Math.min(width - 45, Math.max(4, rulerX - 15)), 12);
    }

    // 4. Draw Playhead Position Line
    if (duration > 0 && currentTime >= 0) {
      const playheadX = (currentTime / duration) * width;

      // Playhead vertical line
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

      // Playhead top handle badge
      ctx.fillStyle = '#06b6d4'; // cyan-500
      ctx.beginPath();
      ctx.arc(playheadX, 6, 4, 0, Math.PI * 2);
      ctx.fill();
    }

  }, [audioBuffer, silenceRegions, currentTime, duration, isCleanedVersion]);

  // Handle canvas click to seek
  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = clickX / rect.width;
    const seekTime = ratio * duration;

    onSeek(Math.max(0, Math.min(duration, seekTime)));
  };

  // Handle mouse move to display timestamp and region info
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !duration) return;

    const rect = canvas.getBoundingClientRect();
    const hoverX = e.clientX - rect.left;
    const hoverSec = (hoverX / rect.width) * duration;
    setHoverTime(hoverSec);

    // Find if hover is over a silence region
    const region = silenceRegions.find((r) => hoverSec >= r.start && hoverSec <= r.end);
    setHoverRegion(region || null);
  };

  const handleMouseLeave = () => {
    setHoverTime(null);
    setHoverRegion(null);
  };

  return (
    <div id="waveform-container" className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl space-y-3">
      
      {/* Header Bar */}
      <div className="flex items-center justify-between text-xs font-mono">
        <div className="flex items-center space-x-2">
          <Layers className={`w-4 h-4 ${isCleanedVersion ? 'text-teal-400' : 'text-cyan-400'}`} />
          <span className="font-bold text-white uppercase tracking-wider">{title}</span>
          {!isCleanedVersion && silenceRegions.length > 0 && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-950/80 text-rose-400 border border-rose-800/60">
              {silenceRegions.length} Dead Spaces Highlighted
            </span>
          )}
        </div>

        {/* Legend */}
        <div className="hidden sm:flex items-center space-x-4 text-[11px] text-slate-400">
          <div className="flex items-center space-x-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${isCleanedVersion ? 'bg-teal-400' : 'bg-emerald-400'}`} />
            <span>Speech Active</span>
          </div>
          {!isCleanedVersion && (
            <div className="flex items-center space-x-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" />
              <span>Dead Space Cut</span>
            </div>
          )}
        </div>
      </div>

      {/* Canvas Wrapper */}
      <div
        ref={containerRef}
        className="relative w-full rounded-xl overflow-hidden border border-slate-800 bg-slate-950 cursor-pointer group"
      >
        <canvas
          ref={canvasRef}
          onClick={handleCanvasClick}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-[140px] block"
        />

        {/* Hover Tooltip Overlay */}
        {hoverTime !== null && (
          <div className="absolute bottom-2 right-2 bg-slate-900/95 border border-slate-700/80 text-[11px] font-mono px-2.5 py-1 rounded-md text-slate-200 shadow-lg pointer-events-none z-10 flex items-center space-x-2">
            <span>Pos: {formatDuration(hoverTime)}</span>
            {hoverRegion && (
              <span className="text-rose-400 font-bold border-l border-slate-700 pl-2">
                Gap: -{hoverRegion.duration.toFixed(2)}s
              </span>
            )}
          </div>
        )}

        {!audioBuffer && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-xs font-mono">
            No audio loaded
          </div>
        )}
      </div>

    </div>
  );
};
