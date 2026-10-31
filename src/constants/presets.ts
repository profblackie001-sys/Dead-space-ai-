import { PresetOption } from '../types';

export const PRESET_OPTIONS: PresetOption[] = [
  {
    id: 'podcast',
    name: 'Podcast & Voiceover',
    description: 'Optimal balance for interviews, narrative podcasts, and audiobooks.',
    settings: {
      thresholdDb: -40,
      minSilenceDurationMs: 400,
      paddingMs: 80,
      keepMinSilenceMs: 50,
    },
  },
  {
    id: 'fast_talk',
    name: 'Fast Tech & Youtube',
    description: 'Snappy cuts for fast-paced video commentary and social clips.',
    settings: {
      thresholdDb: -35,
      minSilenceDurationMs: 250,
      paddingMs: 50,
      keepMinSilenceMs: 20,
    },
  },
  {
    id: 'conservative',
    name: 'Gentle & Natural',
    description: 'Preserves natural pause rhythm; only removes noticeable long dead spaces.',
    settings: {
      thresholdDb: -48,
      minSilenceDurationMs: 700,
      paddingMs: 120,
      keepMinSilenceMs: 100,
    },
  },
  {
    id: 'aggressive',
    name: 'Maximum Cut',
    description: 'Aggressively trims every micro-pause for ultra-compact audio.',
    settings: {
      thresholdDb: -30,
      minSilenceDurationMs: 180,
      paddingMs: 30,
      keepMinSilenceMs: 0,
    },
  },
];
