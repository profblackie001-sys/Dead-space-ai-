import React from 'react';
import { ShieldCheck, Command, Zap } from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer id="app-footer" className="border-t border-slate-800 bg-slate-950 text-slate-400 py-8 text-xs font-mono">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
        
        {/* Keyboard Shortcuts Bar */}
        <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-[11px]">
          <div className="flex items-center space-x-2 text-slate-300 font-semibold">
            <Command className="w-3.5 h-3.5 text-cyan-400" />
            <span>Shortcuts:</span>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-slate-400">
            <span className="flex items-center space-x-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-200">Space</kbd>
              <span>Play / Pause</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-200">A / B</kbd>
              <span>Toggle Cleaned / Original</span>
            </span>
            <span className="flex items-center space-x-1.5">
              <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-200">← / →</kbd>
              <span>Seek 5s</span>
            </span>
          </div>
        </div>

        {/* Footer bottom bar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500 text-[11px]">
          <div className="flex items-center space-x-2">
            <Zap className="w-3.5 h-3.5 text-cyan-400" />
            <span>DeadSpace AI • Professional Silence & Dead Space Remover</span>
          </div>

          <div className="flex items-center space-x-4">
            <span className="flex items-center space-x-1 text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-teal-400" />
              <span>In-Browser WebAudio Engine</span>
            </span>
            <span>•</span>
            <span>© {new Date().getFullYear()} DeadSpace AI</span>
          </div>
        </div>

      </div>
    </footer>
  );
};
