import React from 'react';
import { ProcessingMetrics } from '../types';
import { formatDuration } from '../utils/audioProcessor';
import { Clock, Scissors, Zap, Sparkles, TrendingDown, Percent } from 'lucide-react';

interface MetricsCardsProps {
  metrics: ProcessingMetrics | null;
}

export const MetricsCards: React.FC<MetricsCardsProps> = ({ metrics }) => {
  if (!metrics) return null;

  return (
    <div id="metrics-summary" className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        
        {/* Original Duration */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">Original</span>
            <Clock className="w-4 h-4 text-slate-400" />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-white tracking-tight">
              {formatDuration(metrics.originalDuration)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Raw audio duration</p>
          </div>
        </div>

        {/* Cleaned Duration */}
        <div className="bg-slate-900/80 border border-cyan-900/50 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg relative overflow-hidden">
          <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none" />
          <div className="flex items-center justify-between text-cyan-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">New Duration</span>
            <Sparkles className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-cyan-300 tracking-tight">
              {formatDuration(metrics.cleanedDuration)}
            </div>
            <p className="text-[11px] text-teal-400 mt-0.5 font-medium">Compact & speech-only</p>
          </div>
        </div>

        {/* Total Time Removed */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">Time Saved</span>
            <TrendingDown className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <div className="flex items-baseline space-x-1.5">
              <span className="text-xl sm:text-2xl font-bold font-mono text-emerald-400 tracking-tight">
                -{metrics.timeRemoved.toFixed(1)}s
              </span>
              <span className="text-xs font-bold text-emerald-400/90 font-mono">
                ({metrics.percentageRemoved.toFixed(1)}%)
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Dead space eliminated</p>
          </div>
        </div>

        {/* Silent Sections Removed */}
        <div className="bg-slate-900/80 border border-slate-800/80 rounded-2xl p-4 sm:p-5 flex flex-col justify-between shadow-lg">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider font-mono">Dead Spaces Cut</span>
            <Scissors className="w-4 h-4 text-rose-400" />
          </div>
          <div>
            <div className="text-xl sm:text-2xl font-bold font-mono text-rose-300 tracking-tight">
              {metrics.silenceCount} <span className="text-sm font-normal text-slate-400">gaps</span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Silence segments detected</p>
          </div>
        </div>

      </div>

      {/* Speech Density Gauge Bar */}
      <div className="bg-slate-900/60 border border-slate-800/60 rounded-xl p-3.5 sm:p-4">
        <div className="flex items-center justify-between text-xs font-mono mb-2">
          <span className="text-slate-300 font-semibold flex items-center space-x-1.5">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>Audio Composition Ratio</span>
          </span>
          <span className="text-slate-400">
            Speech: <span className="text-cyan-400 font-bold">{metrics.speechRatio.toFixed(1)}%</span> • Dead Space: <span className="text-rose-400 font-bold">{(100 - metrics.speechRatio).toFixed(1)}%</span>
          </span>
        </div>

        {/* Visual Progress Bar */}
        <div className="w-full h-3 bg-slate-950 rounded-full overflow-hidden flex p-0.5 border border-slate-800">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, metrics.speechRatio))}%` }}
            title={`Speech Active: ${metrics.speechRatio.toFixed(1)}%`}
          />
          <div
            className="h-full bg-rose-500/40 rounded-r-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, 100 - metrics.speechRatio))}%` }}
            title={`Dead Space Cut: ${(100 - metrics.speechRatio).toFixed(1)}%`}
          />
        </div>
      </div>
    </div>
  );
};
