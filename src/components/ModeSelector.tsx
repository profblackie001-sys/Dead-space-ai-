import React from 'react';
import { AppMode } from '../types';
import { Zap, Layers, Sparkles, FileText } from 'lucide-react';

interface ModeSelectorProps {
  activeMode: AppMode;
  onModeChange: (mode: AppMode) => void;
  batchCount?: number;
}

export const ModeSelector: React.FC<ModeSelectorProps> = ({
  activeMode,
  onModeChange,
  batchCount = 0,
}) => {
  return (
    <div id="mode-selector-nav" className="w-full max-w-3xl mx-auto mb-6">
      <div className="bg-slate-900/90 border border-slate-800 p-1.5 rounded-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-1 shadow-xl backdrop-blur-md">
        
        {/* Single File Mode Tab */}
        <button
          id="mode-single-tab"
          onClick={() => onModeChange('single')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 shrink-0 ${
            activeMode === 'single'
              ? 'bg-gradient-to-r from-cyan-500 to-teal-400 text-slate-950 shadow-lg shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Zap className={`w-4 h-4 ${activeMode === 'single' ? 'text-slate-950' : 'text-cyan-400'}`} />
          <span>Single File</span>
        </button>

        {/* Batch Merge & Script Arranger Tab */}
        <button
          id="mode-batch-tab"
          onClick={() => onModeChange('batch')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 relative shrink-0 ${
            activeMode === 'batch'
              ? 'bg-gradient-to-r from-cyan-500 to-emerald-400 text-slate-950 shadow-lg shadow-cyan-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Layers className={`w-4 h-4 ${activeMode === 'batch' ? 'text-slate-950' : 'text-emerald-400'}`} />
          <span>Batch & Arranger</span>
          {batchCount > 0 && (
            <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full font-bold ${
              activeMode === 'batch' ? 'bg-slate-950 text-cyan-300' : 'bg-cyan-950 text-cyan-400 border border-cyan-800'
            }`}>
              {batchCount}
            </span>
          )}
        </button>

        {/* Smart AI Detection Tab */}
        <button
          id="mode-smart-ai-tab"
          onClick={() => onModeChange('smart_ai')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 shrink-0 ${
            activeMode === 'smart_ai'
              ? 'bg-gradient-to-r from-teal-400 to-emerald-400 text-slate-950 shadow-lg shadow-teal-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <Sparkles className={`w-4 h-4 ${activeMode === 'smart_ai' ? 'text-slate-950' : 'text-teal-400'}`} />
          <span>Smart AI</span>
        </button>

        {/* SRT Subtitle Studio Tab */}
        <button
          id="mode-subtitles-tab"
          onClick={() => onModeChange('subtitles')}
          className={`flex-1 py-2.5 px-3 rounded-xl text-xs sm:text-sm font-semibold transition-all cursor-pointer inline-flex items-center justify-center space-x-2 shrink-0 ${
            activeMode === 'subtitles'
              ? 'bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 text-slate-950 shadow-lg shadow-emerald-500/20'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
          }`}
        >
          <FileText className={`w-4 h-4 ${activeMode === 'subtitles' ? 'text-slate-950' : 'text-emerald-400'}`} />
          <span>SRT Subtitles</span>
        </button>

      </div>
    </div>
  );
};
