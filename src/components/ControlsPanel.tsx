import React from 'react';
import { AudioProcessingSettings, PresetType } from '../types';
import { PRESET_OPTIONS } from '../constants/presets';
import { Sliders, Zap, Info, RotateCcw, Play, Layers, RefreshCw } from 'lucide-react';

interface ControlsPanelProps {
  settings: AudioProcessingSettings;
  activePreset: PresetType;
  onSettingsChange: (newSettings: AudioProcessingSettings, presetId?: PresetType) => void;
  onProcess: () => void;
  isProcessing: boolean;
  hasAudio: boolean;
  autoApply: boolean;
  onToggleAutoApply: (val: boolean) => void;
  hasGenerated?: boolean;
}

export const ControlsPanel: React.FC<ControlsPanelProps> = ({
  settings,
  activePreset,
  onSettingsChange,
  onProcess,
  isProcessing,
  hasAudio,
  autoApply,
  onToggleAutoApply,
  hasGenerated = false,
}) => {
  const handleSelectPreset = (presetId: PresetType) => {
    const found = PRESET_OPTIONS.find((p) => p.id === presetId);
    if (found) {
      onSettingsChange({ ...found.settings }, presetId);
    }
  };

  const handleSliderChange = (key: keyof AudioProcessingSettings, value: number) => {
    const updated = { ...settings, [key]: value };
    onSettingsChange(updated, 'custom');
  };

  const resetToDefault = () => {
    handleSelectPreset('podcast');
  };

  return (
    <div id="controls-panel" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 sm:p-6 shadow-xl backdrop-blur-sm space-y-6">
      
      {/* Panel Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-4">
        <div className="flex items-center space-x-2.5">
          <div className="w-8 h-8 rounded-lg bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center">
            <Sliders className="w-4 h-4 text-cyan-400" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-white tracking-wide uppercase font-mono">
              Detection Controls
            </h3>
            <p className="text-xs text-slate-400">
              Fine-tune sensitivity & threshold parameters
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Auto apply toggle */}
          <label className="inline-flex items-center cursor-pointer text-xs text-slate-400 hover:text-slate-300">
            <input
              type="checkbox"
              checked={autoApply}
              onChange={(e) => onToggleAutoApply(e.target.checked)}
              className="sr-only peer"
            />
            <div className="relative w-8 h-4.5 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-slate-300 after:border-slate-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-cyan-500"></div>
            <span className="ms-2">Auto-Process</span>
          </label>

          {/* Reset button */}
          <button
            onClick={resetToDefault}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 text-xs transition-all flex items-center space-x-1 cursor-pointer"
            title="Reset to default settings"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Reset</span>
          </button>
        </div>
      </div>

      {/* Preset Pills */}
      <div>
        <label className="text-xs font-semibold text-slate-300 uppercase tracking-wider block mb-2.5 font-mono">
          Presets
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {PRESET_OPTIONS.map((preset) => {
            const isSelected = activePreset === preset.id;
            return (
              <button
                key={preset.id}
                onClick={() => handleSelectPreset(preset.id)}
                className={`px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer border ${
                  isSelected
                    ? 'bg-cyan-950/80 border-cyan-500 text-white shadow-md shadow-cyan-500/10'
                    : 'bg-slate-950/50 border-slate-800 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold">{preset.name}</span>
                  {isSelected && <Zap className="w-3 h-3 text-cyan-400" />}
                </div>
                <p className="text-[10px] text-slate-400 mt-1 line-clamp-1 leading-tight">
                  {preset.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Slider Sliders Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 pt-1">
        
        {/* Silence Threshold (dB) */}
        <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              Silence Threshold
              <span className="group relative">
                <Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 p-2 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded shadow-lg z-20">
                  Audio energy below this dB level is treated as silence. Higher (e.g. -25dB) cuts background noise.
                </span>
              </span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">{settings.thresholdDb} dB</span>
          </div>
          <input
            type="range"
            min="-60"
            max="-15"
            step="1"
            value={settings.thresholdDb}
            onChange={(e) => handleSliderChange('thresholdDb', parseFloat(e.target.value))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>-60 dB (Quietest)</span>
            <span>-15 dB (Loudest)</span>
          </div>
        </div>

        {/* Minimum Silence Duration (ms) */}
        <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              Min Silence Duration
              <span className="group relative">
                <Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 p-2 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded shadow-lg z-20">
                  Minimum duration a quiet gap must last to be removed. Shorter gaps will be kept.
                </span>
              </span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">{settings.minSilenceDurationMs} ms</span>
          </div>
          <input
            type="range"
            min="100"
            max="2000"
            step="25"
            value={settings.minSilenceDurationMs}
            onChange={(e) => handleSliderChange('minSilenceDurationMs', parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>100ms (Micro gaps)</span>
            <span>2000ms (Long gaps)</span>
          </div>
        </div>

        {/* Speech Padding / Margin (ms) */}
        <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              Speech Buffer Padding
              <span className="group relative">
                <Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 p-2 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded shadow-lg z-20">
                  Safety margin kept around words so speech start/end sounds natural without word clipping.
                </span>
              </span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">{settings.paddingMs} ms</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="10"
            value={settings.paddingMs}
            onChange={(e) => handleSliderChange('paddingMs', parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>0ms (Tight cut)</span>
            <span>200ms (Extra padding)</span>
          </div>
        </div>

        {/* Keep Natural Pause Duration (ms) */}
        <div className="space-y-2 bg-slate-950/40 p-3.5 rounded-xl border border-slate-800/60">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-slate-300 flex items-center gap-1.5">
              Pause Retention
              <span className="group relative">
                <Info className="w-3.5 h-3.5 text-slate-500 cursor-help" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block w-48 p-2 bg-slate-900 border border-slate-700 text-[10px] text-slate-300 rounded shadow-lg z-20">
                  Leaves a tiny remaining pause (e.g., 50ms) between spoken sentences to prevent robotic sounding audio.
                </span>
              </span>
            </span>
            <span className="font-mono text-cyan-400 font-bold">{settings.keepMinSilenceMs} ms</span>
          </div>
          <input
            type="range"
            min="0"
            max="150"
            step="10"
            value={settings.keepMinSilenceMs}
            onChange={(e) => handleSliderChange('keepMinSilenceMs', parseInt(e.target.value, 10))}
            className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
          />
          <div className="flex justify-between text-[10px] text-slate-400 font-mono">
            <span>0ms (No pause)</span>
            <span>150ms (Natural breathing)</span>
          </div>
        </div>

      </div>

      {/* Main Process Trigger Button (if autoApply is disabled or on demand) */}
      <div className="flex items-center justify-end pt-2">
        <button
          id="process-audio-btn"
          onClick={onProcess}
          disabled={!hasAudio || isProcessing}
          className="w-full sm:w-auto px-6 py-3 rounded-xl text-sm font-bold text-slate-950 bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center space-x-2"
        >
          {isProcessing ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-slate-950 border-t-transparent animate-spin" />
              <span>Detecting & Removing Dead Space...</span>
            </>
          ) : hasGenerated ? (
            <>
              <RefreshCw className="w-4 h-4 text-slate-950 stroke-[2.5]" />
              <span>Regenerate Cleaned Audio</span>
            </>
          ) : (
            <>
              <Zap className="w-4 h-4 text-slate-950 fill-slate-950" />
              <span>Process & Cut Dead Space</span>
            </>
          )}
        </button>
      </div>

    </div>
  );
};
