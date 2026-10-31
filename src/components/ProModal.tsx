import React from 'react';
import { X, Sparkles, Check, Layers, Zap, Music2, ShieldCheck, CheckCircle2 } from 'lucide-react';

interface ProModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProModal: React.FC<ProModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const proFeatures = [
    {
      icon: Layers,
      title: 'Batch Silence Removal & Merge',
      description: 'Upload and clean multiple audio files simultaneously, with custom inter-clip gaps.',
    },
    {
      icon: Sparkles,
      title: 'Smart AI Filler & Pause Detector',
      description: 'Automatically scan speech for filler words ("umm", "uh"), repeats, and heavy breaths.',
    },
    {
      icon: Music2,
      title: 'Multi-Format Export (MP3, WAV, AAC)',
      description: 'Export high-quality audio at up to 320kbps MP3 or crisp uncompressed WAV & AAC.',
    },
    {
      icon: Zap,
      title: 'Volume Peak Normalization',
      description: 'Automatically balance gain levels across all tracks to ensure consistent listening volume.',
    },
    {
      icon: ShieldCheck,
      title: '100% Client-Side Privacy',
      description: 'All audio processing runs locally in your browser. Zero cloud uploads or file storage.',
    },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        
        {/* Glowing Background Accent */}
        <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-slate-400 hover:text-white bg-slate-800/80 hover:bg-slate-800 transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Badge & Title */}
        <div className="space-y-3 text-center sm:text-left">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/80 text-xs font-bold font-mono">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Pro AI Features — 100% Free & Unlocked</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            All Studio AI Features are Free!
          </h2>
          <p className="text-sm text-slate-300">
            Enjoy full access to single file cleaning, batch merging, filler word detection, and high-quality MP3 exports with zero restrictions or payment required.
          </p>
        </div>

        {/* Features List */}
        <div className="mt-6 space-y-3">
          {proFeatures.map((feat, idx) => {
            const Icon = feat.icon;
            return (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-slate-950/80 border border-slate-800/80 flex items-start space-x-3.5"
              >
                <div className="w-10 h-10 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center shrink-0 mt-0.5">
                  <Icon className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white flex items-center space-x-2">
                    <span>{feat.title}</span>
                    <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-emerald-950 text-emerald-400 border border-emerald-800/60 font-mono">
                      Unlocked Free
                    </span>
                  </h4>
                  <p className="text-xs text-slate-400 mt-0.5">{feat.description}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Authorized VIP Accounts List */}
        <div className="mt-6 p-4 rounded-2xl bg-slate-950/90 border border-emerald-500/30 space-y-2">
          <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400 font-mono uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>VIP Lifetime Pro Access Granted</span>
          </div>
          <p className="text-xs text-slate-300">
            Unlimited access to all Pro AI audio tools (Batch cleaning, filler removal, peak normalizer, 320kbps MP3 export) has been permanently activated for:
          </p>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {[
              'olamideoladiji58@gmail.com',
              'oladijiolamide762@gmail.com',
              'oladio741@gmail.com',
              'olamideoladiji83@gmail.com',
              'ooladiji626@gmail.com'
            ].map((email) => (
              <span key={email} className="px-2.5 py-1 rounded-lg bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-mono text-[11px] flex items-center space-x-1">
                <Check className="w-3 h-3 text-emerald-400 stroke-[3]" />
                <span>{email}</span>
              </span>
            ))}
          </div>
        </div>

        {/* Active Free Banner */}
        <div className="mt-6 p-5 rounded-2xl bg-gradient-to-r from-emerald-950/60 via-slate-950 to-cyan-950/60 border border-emerald-800/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <div className="flex items-baseline space-x-2">
              <span className="text-3xl font-black text-emerald-400 font-mono">$0</span>
              <span className="text-xs text-slate-300 font-mono">/ Free Forever</span>
            </div>
            <p className="text-xs text-emerald-400 font-medium mt-0.5 flex items-center space-x-1">
              <Check className="w-3.5 h-3.5 stroke-[3]" />
              <span>All Pro AI features are currently active on your app</span>
            </p>
          </div>

          <button
            onClick={() => {
              onClose();
            }}
            className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-emerald-400 via-teal-300 to-cyan-400 hover:brightness-110 shadow-lg shadow-emerald-500/20 transition-all cursor-pointer inline-flex items-center justify-center space-x-2"
          >
            <span>Start Using Pro Features Free</span>
          </button>
        </div>

        {/* Security / Privacy reassurance */}
        <p className="text-center text-[11px] text-slate-500 mt-4">
          🔒 100% In-Browser Local Audio Processing • No Account or Credit Card Needed
        </p>

      </div>
    </div>
  );
};

