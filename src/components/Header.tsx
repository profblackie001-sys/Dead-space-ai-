import React from 'react';
import { Sparkles, Zap, ShieldCheck, Wand2, History } from 'lucide-react';

interface HeaderProps {
  onOpenPro: () => void;
  onLoadSample: () => void;
  isProcessingSample: boolean;
  hasAudioLoaded: boolean;
  historyCount?: number;
  onOpenHistory?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  onOpenPro,
  onLoadSample,
  isProcessingSample,
  hasAudioLoaded,
  historyCount = 0,
  onOpenHistory,
}) => {
  return (
    <header id="app-header" className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Brand Logo & Name */}
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-500 to-emerald-400 p-0.5 shadow-lg shadow-cyan-500/20 flex items-center justify-center">
            <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
              <Zap className="w-5 h-5 text-cyan-400 fill-cyan-400/20" />
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="text-xl font-bold tracking-tight text-white font-mono">
                DeadSpace<span className="text-cyan-400">.AI</span>
              </span>
              <span className="text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-cyan-950/80 text-cyan-400 border border-cyan-800/50">
                Audio Engine v2.4
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Instant In-Browser Silence & Dead Space Removal
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2 sm:space-x-3">
          
          {/* Load Demo Sample Audio Button */}
          {!hasAudioLoaded && (
            <button
              id="load-sample-btn"
              onClick={onLoadSample}
              disabled={isProcessingSample}
              className="inline-flex items-center space-x-2 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-lg text-xs font-medium text-slate-300 bg-slate-900/90 border border-slate-700/80 hover:bg-slate-800 hover:text-white hover:border-slate-600 transition-all cursor-pointer disabled:opacity-50"
            >
              <Wand2 className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
              <span className="hidden xs:inline">
                {isProcessingSample ? 'Generating Demo...' : 'Try Sample Audio'}
              </span>
            </button>
          )}

          {/* Generation History Button */}
          {onOpenHistory && (
            <button
              id="open-history-btn"
              onClick={onOpenHistory}
              className="inline-flex items-center space-x-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-semibold text-slate-300 bg-slate-900/90 border border-slate-700/80 hover:bg-slate-800 hover:text-white hover:border-cyan-500/50 transition-all cursor-pointer"
              title="View generation history"
            >
              <History className="w-3.5 h-3.5 text-cyan-400" />
              <span>History</span>
              {historyCount > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-cyan-500 text-slate-950 font-bold text-[10px]">
                  {historyCount}
                </span>
              )}
            </button>
          )}

          {/* Privacy badge */}
          <div className="hidden lg:flex items-center space-x-1.5 text-xs text-slate-400 px-3 py-1.5 rounded-lg bg-slate-900/50 border border-slate-800/80">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
            <span>100% Private (Local)</span>
          </div>

          {/* Pro Upgrade Button */}
          <button
            id="open-pro-btn"
            onClick={onOpenPro}
            className="inline-flex items-center space-x-2 px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:brightness-110 shadow-md shadow-emerald-500/15 transition-all cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 text-slate-950 fill-slate-950" />
            <span>Pro Features (Free)</span>
          </button>
        </div>

      </div>
    </header>
  );
};
