import { AudioProcessingSettings, KeepRegion, ProcessingMetrics, SilenceRegion } from '../types';

/**
 * Shared AudioContext helper
 */
let audioCtxInstance: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtxInstance || audioCtxInstance.state === 'closed') {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtxInstance = new AudioContextClass();
  }
  if (audioCtxInstance.state === 'suspended') {
    audioCtxInstance.resume();
  }
  return audioCtxInstance;
}

/**
 * Decode an audio File into an AudioBuffer using Web Audio API
 */
export async function decodeAudioFile(file: File): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  const ctx = getAudioContext();
  
  // decodeAudioData returns a Promise in standard modern browsers
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } catch (err) {
    // Fallback for older Safari implementations
    return new Promise((resolve, reject) => {
      ctx.decodeAudioData(
        arrayBuffer.slice(0),
        (decoded) => resolve(decoded),
        (error) => reject(error || new Error('Failed to decode audio file'))
      );
    });
  }
}

/**
 * Detect silent regions in an AudioBuffer based on threshold and duration settings
 */
export function detectSilenceRegions(
  buffer: AudioBuffer,
  settings: AudioProcessingSettings
): {
  silenceRegions: SilenceRegion[];
  keepRegions: KeepRegion[];
  metrics: ProcessingMetrics;
} {
  const sampleRate = buffer.sampleRate;
  const numChannels = buffer.numberOfChannels;
  const totalSamples = buffer.length;
  const totalDuration = buffer.duration;

  // Convert dB threshold to linear amplitude (e.g., -40 dB -> 0.01)
  const linearThreshold = Math.pow(10, settings.thresholdDb / 20);
  
  // Frame window size (~15ms window)
  const frameSize = Math.floor(sampleRate * 0.015);
  const minSilenceSamples = Math.floor((settings.minSilenceDurationMs / 1000) * sampleRate);
  const paddingSamples = Math.floor((settings.paddingMs / 1000) * sampleRate);
  const keepSilenceSamples = Math.floor((settings.keepMinSilenceMs / 1000) * sampleRate);

  // Extract PCM sample arrays for each channel
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  // Calculate RMS for each frame
  const isSilentFrame: boolean[] = [];
  const numFrames = Math.floor(totalSamples / frameSize);

  for (let f = 0; f < numFrames; f++) {
    const startIdx = f * frameSize;
    const endIdx = Math.min(startIdx + frameSize, totalSamples);
    
    // Compute peak / RMS across channels
    let maxRms = 0;
    for (let c = 0; c < numChannels; c++) {
      let sumSquare = 0;
      const data = channelData[c];
      for (let i = startIdx; i < endIdx; i++) {
        const val = data[i];
        sumSquare += val * val;
      }
      const rms = Math.sqrt(sumSquare / (endIdx - startIdx || 1));
      if (rms > maxRms) maxRms = rms;
    }

    isSilentFrame.push(maxRms < linearThreshold);
  }

  // Find continuous silent frame runs
  const rawSilenceRegions: { startSample: number; endSample: number }[] = [];
  let inSilence = false;
  let silenceStartFrame = 0;

  for (let f = 0; f < isSilentFrame.length; f++) {
    if (isSilentFrame[f] && !inSilence) {
      inSilence = true;
      silenceStartFrame = f;
    } else if (!isSilentFrame[f] && inSilence) {
      inSilence = false;
      const silenceEndFrame = f;
      const startSample = silenceStartFrame * frameSize;
      const endSample = silenceEndFrame * frameSize;
      
      if (endSample - startSample >= minSilenceSamples) {
        rawSilenceRegions.push({ startSample, endSample });
      }
    }
  }

  // Check ending silence
  if (inSilence) {
    const startSample = silenceStartFrame * frameSize;
    const endSample = totalSamples;
    if (endSample - startSample >= minSilenceSamples) {
      rawSilenceRegions.push({ startSample, endSample });
    }
  }

  // Apply padding and keepMinSilence logic to silence regions
  const silenceRegions: SilenceRegion[] = [];
  const processedSilenceSamples: { startSample: number; endSample: number }[] = [];

  for (let idx = 0; idx < rawSilenceRegions.length; idx++) {
    const raw = rawSilenceRegions[idx];
    
    // Adjust start and end samples with padding (speech buffer)
    let adjStartSample = raw.startSample + paddingSamples;
    let adjEndSample = raw.endSample - paddingSamples;

    // If keepMinSilenceMs > 0, leave a tiny pause in the middle
    if (keepSilenceSamples > 0 && (adjEndSample - adjStartSample) > keepSilenceSamples) {
      const middle = Math.floor((adjStartSample + adjEndSample) / 2);
      const halfKeep = Math.floor(keepSilenceSamples / 2);
      adjStartSample = adjStartSample; // keep left padding
      // cut from adjStart to middle - halfKeep, and middle + halfKeep to adjEnd
      // For simplicity, shift adjStart forward or shrink silence range:
      adjStartSample += Math.floor(keepSilenceSamples / 2);
      adjEndSample -= Math.floor(keepSilenceSamples / 2);
    }

    // Ensure valid boundaries
    if (adjStartSample < adjEndSample && (adjEndSample - adjStartSample) >= (sampleRate * 0.05)) {
      // Don't cut leading/trailing beyond bounds
      adjStartSample = Math.max(0, adjStartSample);
      adjEndSample = Math.min(totalSamples, adjEndSample);

      processedSilenceSamples.push({ startSample: adjStartSample, endSample: adjEndSample });

      const startSec = adjStartSample / sampleRate;
      const endSec = adjEndSample / sampleRate;
      silenceRegions.push({
        id: `silence-${idx}-${Math.random().toString(36).substring(2, 6)}`,
        start: startSec,
        end: endSec,
        duration: endSec - startSec,
      });
    }
  }

  // Invert silence regions to compute Keep Regions
  const keepRegions: KeepRegion[] = [];
  let currentSample = 0;

  for (const sRegion of processedSilenceSamples) {
    if (sRegion.startSample > currentSample) {
      const startSec = currentSample / sampleRate;
      const endSec = sRegion.startSample / sampleRate;
      keepRegions.push({
        start: startSec,
        end: endSec,
        duration: endSec - startSec,
      });
    }
    currentSample = sRegion.endSample;
  }

  if (currentSample < totalSamples) {
    const startSec = currentSample / sampleRate;
    const endSec = totalSamples / sampleRate;
    keepRegions.push({
      start: startSec,
      end: endSec,
      duration: endSec - startSec,
    });
  }

  // Calculate Metrics
  const cleanedDuration = keepRegions.reduce((sum, r) => sum + r.duration, 0);
  const timeRemoved = Math.max(0, totalDuration - cleanedDuration);
  const percentageRemoved = totalDuration > 0 ? (timeRemoved / totalDuration) * 100 : 0;
  const speechRatio = totalDuration > 0 ? (cleanedDuration / totalDuration) * 100 : 0;

  const metrics: ProcessingMetrics = {
    originalDuration: totalDuration,
    cleanedDuration,
    timeRemoved,
    percentageRemoved,
    silenceCount: silenceRegions.length,
    speechRatio,
  };

  return {
    silenceRegions,
    keepRegions,
    metrics,
  };
}

/**
 * Process AudioBuffer to remove silence regions and concatenate keep regions with anti-pop crossfades
 */
export function processAndConcatenateBuffer(
  originalBuffer: AudioBuffer,
  keepRegions: KeepRegion[]
): AudioBuffer {
  const sampleRate = originalBuffer.sampleRate;
  const numChannels = originalBuffer.numberOfChannels;

  // Calculate total sample length for new buffer
  let totalOutputSamples = 0;
  const keepSampleRanges = keepRegions.map((r) => {
    const startSample = Math.floor(r.start * sampleRate);
    const endSample = Math.min(originalBuffer.length, Math.floor(r.end * sampleRate));
    const length = Math.max(0, endSample - startSample);
    totalOutputSamples += length;
    return { startSample, endSample, length };
  });

  if (totalOutputSamples <= 0) {
    // If entire audio was silent, return a minimal 0.1s silent buffer
    const ctx = getAudioContext();
    return ctx.createBuffer(numChannels, Math.floor(sampleRate * 0.1), sampleRate);
  }

  const ctx = getAudioContext();
  const cleanedBuffer = ctx.createBuffer(numChannels, totalOutputSamples, sampleRate);

  // Anti-pop fade length (4 ms)
  const fadeLengthSamples = Math.min(Math.floor(sampleRate * 0.004), 256);

  for (let channel = 0; channel < numChannels; channel++) {
    const srcData = originalBuffer.getChannelData(channel);
    const destData = cleanedBuffer.getChannelData(channel);

    let writeOffset = 0;

    for (const range of keepSampleRanges) {
      if (range.length <= 0) continue;

      // Copy source channel section
      for (let i = 0; i < range.length; i++) {
        let sample = srcData[range.startSample + i];

        // Apply anti-click fade in at start of region
        if (i < fadeLengthSamples) {
          const fadeFactor = i / fadeLengthSamples;
          sample *= fadeFactor;
        }

        // Apply anti-click fade out at end of region
        if (i > range.length - fadeLengthSamples) {
          const fadeFactor = (range.length - i) / fadeLengthSamples;
          sample *= fadeFactor;
        }

        destData[writeOffset + i] = sample;
      }

      writeOffset += range.length;
    }
  }

  return cleanedBuffer;
}

/**
 * Convert AudioBuffer to downloadable WAV Blob (16-bit PCM Stereo/Mono)
 */
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;

  const numSamples = buffer.length * numChannels;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataSize = numSamples * bytesPerSample;
  const bufferLength = 44 + dataSize;

  const arrayBuffer = new ArrayBuffer(bufferLength);
  const view = new DataView(arrayBuffer);

  /* RIFF chunk descriptor */
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  /* fmt sub-chunk */
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, format, true); // AudioFormat
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true); // ByteRate
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);

  /* data sub-chunk */
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Interleave channels and write 16-bit PCM samples
  const channelData: Float32Array[] = [];
  for (let c = 0; c < numChannels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      let sample = channelData[c][i];
      // Clamp float sample between -1.0 and 1.0
      sample = Math.max(-1, Math.min(1, sample));
      // Convert to 16-bit signed integer
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Format duration in seconds to MM:SS.s or HH:MM:SS string
 */
export function formatDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00.0';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = (seconds % 60).toFixed(1);

  const minsStr = mins < 10 ? `0${mins}` : `${mins}`;
  const secsParts = secs.split('.');
  const wholeSecs = parseInt(secsParts[0], 10);
  const secsStr = wholeSecs < 10 ? `0${wholeSecs}` : `${wholeSecs}`;
  const tenths = secsParts[1] || '0';

  if (hrs > 0) {
    const hrsStr = hrs < 10 ? `0${hrs}` : `${hrs}`;
    return `${hrsStr}:${minsStr}:${secsStr}`;
  }
  return `${minsStr}:${secsStr}.${tenths}`;
}

/**
 * Generate a synthetic audio sample file with speech simulation and dead spaces for instant 1-click testing
 */
export async function generateSampleAudio(): Promise<File> {
  const sampleRate = 44100;
  const durationSec = 14;
  const totalSamples = sampleRate * durationSec;
  
  const ctx = getAudioContext();
  const buffer = ctx.createBuffer(1, totalSamples, sampleRate);
  const data = buffer.getChannelData(0);

  // Timeline of speech segments vs dead silences
  // [0 - 2.5s]: Speech phrase 1
  // [2.5 - 4.5s]: 2.0s DEAD SPACE SILENCE
  // [4.5 - 7.0s]: Speech phrase 2
  // [7.0 - 9.2s]: 2.2s DEAD SPACE SILENCE
  // [9.2 - 11.8s]: Speech phrase 3
  // [11.8 - 14.0s]: 2.2s DEAD SPACE SILENCE

  const speechRanges = [
    { start: 0, end: 2.5, baseFreq: 220 },
    { start: 4.5, end: 7.0, baseFreq: 260 },
    { start: 9.2, end: 11.8, baseFreq: 240 },
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const range of speechRanges) {
      if (t >= range.start && t <= range.end) {
        const localT = t - range.start;
        // Synthesize multi-tone vocal formant simulation
        const f1 = range.baseFreq;
        const f2 = range.baseFreq * 1.5;
        const f3 = range.baseFreq * 2.2;
        
        // Amplitude envelope for speech cadence
        const envelope = Math.sin(localT * Math.PI * 3) * 0.4 + 0.5;
        const tone = (Math.sin(2 * Math.PI * f1 * t) * 0.5 + 
                     Math.sin(2 * Math.PI * f2 * t) * 0.3 + 
                     Math.sin(2 * Math.PI * f3 * t) * 0.2);

        // Add subtle room noise to vocal segment
        const noise = (Math.random() * 2 - 1) * 0.02;

        sample = (tone + noise) * envelope * 0.4;
        break;
      }
    }

    // Gentle baseline noise in silence (very quiet -70dB)
    if (sample === 0) {
      sample = (Math.random() * 2 - 1) * 0.0001;
    }

    data[i] = sample;
  }

  const wavBlob = audioBufferToWavBlob(buffer);
  return new File([wavBlob], 'sample_podcast_demo.wav', { type: 'audio/wav' });
}
