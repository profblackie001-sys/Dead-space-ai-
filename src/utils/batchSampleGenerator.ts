import { audioBufferToWavBlob } from './audioProcessor';

/**
 * Generate 3 synthetic audio files for instant batch merge testing:
 * a1_intro.wav, a2_interview.wav, a3_outro.wav
 */
export async function generateBatchSampleFiles(): Promise<File[]> {
  const sampleRate = 44100;
  const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();

  const configs = [
    {
      name: 'a1_intro_podcast.wav',
      duration: 5.5,
      speechRanges: [
        { start: 0.2, end: 2.0, pitch: 220 },
        { start: 3.8, end: 5.2, pitch: 240 },
      ],
    },
    {
      name: 'a2_interview_segment.wav',
      duration: 7.0,
      speechRanges: [
        { start: 0.1, end: 2.2, pitch: 300 },
        { start: 4.0, end: 6.8, pitch: 320 },
      ],
    },
    {
      name: 'a3_outro_summary.wav',
      duration: 6.0,
      speechRanges: [
        { start: 0.3, end: 2.5, pitch: 210 },
        { start: 4.5, end: 5.8, pitch: 190 },
      ],
    },
  ];

  const files: File[] = [];

  for (const cfg of configs) {
    const totalSamples = Math.floor(sampleRate * cfg.duration);
    const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
    const channel = buffer.getChannelData(0);

    for (let i = 0; i < totalSamples; i++) {
      const t = i / sampleRate;
      let sample = 0;

      for (const range of cfg.speechRanges) {
        if (t >= range.start && t <= range.end) {
          const localT = t - range.start;
          const envelope = Math.sin(localT * Math.PI * 2.5) * 0.4 + 0.5;
          const f1 = range.pitch;
          const tone =
            Math.sin(2 * Math.PI * f1 * t) * 0.5 +
            Math.sin(2 * Math.PI * f1 * 1.5 * t) * 0.3 +
            Math.sin(2 * Math.PI * f1 * 2.1 * t) * 0.2;
          const noise = (Math.random() * 2 - 1) * 0.015;
          sample = (tone + noise) * envelope * 0.35;
          break;
        }
      }

      if (sample === 0) {
        sample = (Math.random() * 2 - 1) * 0.0001; // subtle silent room tone
      }
      channel[i] = sample;
    }

    const blob = audioBufferToWavBlob(buffer);
    files.push(new File([blob], cfg.name, { type: 'audio/wav' }));
  }

  return files;
}
