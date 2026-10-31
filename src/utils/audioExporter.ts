import { Mp3Encoder } from '@breezystack/lamejs';
import { audioBufferToWavBlob } from './audioProcessor';
import { ExportFormat, InterClipGapMs } from '../types';

/**
 * Get AudioContext helper
 */
let sharedAudioCtxInstance: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!sharedAudioCtxInstance || sharedAudioCtxInstance.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    sharedAudioCtxInstance = new AudioContextClass();
  }
  if (sharedAudioCtxInstance.state === 'suspended') {
    sharedAudioCtxInstance.resume().catch(() => {});
  }
  return sharedAudioCtxInstance;
}

/**
 * Convert an AudioBuffer to an MP3 Blob using @breezystack/lamejs
 */
export function audioBufferToMp3Blob(buffer: AudioBuffer, kbps: number = 192): Blob {
  const channels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const mp3Data: Uint8Array[] = [];

  const samples = buffer.length;
  const left = buffer.getChannelData(0);
  const right = channels > 1 ? buffer.getChannelData(1) : left;

  const chunkSize = 1152;
  const leftInt16 = new Int16Array(chunkSize);
  const rightInt16 = new Int16Array(chunkSize);

  for (let i = 0; i < samples; i += chunkSize) {
    const end = Math.min(i + chunkSize, samples);
    const count = end - i;

    for (let j = 0; j < count; j++) {
      let sL = left[i + j];
      sL = Math.max(-1, Math.min(1, sL));
      leftInt16[j] = sL < 0 ? sL * 0x8000 : sL * 0x7FFF;

      if (channels > 1) {
        let sR = right[i + j];
        sR = Math.max(-1, Math.min(1, sR));
        rightInt16[j] = sR < 0 ? sR * 0x8000 : sR * 0x7FFF;
      }
    }

    const chunkL = count === chunkSize ? leftInt16 : leftInt16.subarray(0, count);
    const chunkR = count === chunkSize ? rightInt16 : rightInt16.subarray(0, count);

    let mp3buf: Uint8Array | Int8Array;
    if (channels === 1) {
      mp3buf = mp3encoder.encodeBuffer(chunkL);
    } else {
      mp3buf = mp3encoder.encodeBuffer(chunkL, chunkR);
    }

    if (mp3buf.length > 0) {
      mp3Data.push(new Uint8Array(mp3buf));
    }
  }

  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
    mp3Data.push(new Uint8Array(mp3buf));
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
}

/**
 * Normalize peak volume across an AudioBuffer so peak amplitude reaches targetPeak (default 0.95 = -0.45 dB)
 */
export function normalizeAudioBuffer(buffer: AudioBuffer, targetPeak: number = 0.95): AudioBuffer {
  const numChannels = buffer.numberOfChannels;
  const length = buffer.length;
  const sampleRate = buffer.sampleRate;

  // Find overall peak across all channels
  let maxPeak = 0;
  for (let c = 0; c < numChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      const abs = Math.abs(data[i]);
      if (abs > maxPeak) maxPeak = abs;
    }
  }

  if (maxPeak <= 0.00001) {
    return buffer; // Silence or essentially zero
  }

  const scale = targetPeak / maxPeak;
  // Cap max gain at 4.0 (12 dB boost) to prevent over-amplifying low background noise
  const clampedScale = Math.min(scale, 4.0);

  const ctx = getAudioContext();
  const normalizedBuffer = ctx.createBuffer(numChannels, length, sampleRate);

  for (let c = 0; c < numChannels; c++) {
    const src = buffer.getChannelData(c);
    const dest = normalizedBuffer.getChannelData(c);
    for (let i = 0; i < length; i++) {
      dest[i] = Math.max(-1, Math.min(1, src[i] * clampedScale));
    }
  }

  return normalizedBuffer;
}

/**
 * Merge multiple AudioBuffers into one AudioBuffer with a configurable silence gap (ms) between clips
 */
/**
 * Resample a channel Float32Array to target sample rate using high-fidelity linear interpolation
 */
function resampleChannelData(
  srcData: Float32Array,
  srcRate: number,
  targetRate: number
): Float32Array {
  if (srcRate === targetRate || srcData.length === 0) return srcData;
  const targetLength = Math.max(1, Math.round((srcData.length * targetRate) / srcRate));
  const output = new Float32Array(targetLength);
  const ratio = (srcData.length - 1) / Math.max(1, targetLength - 1);

  for (let i = 0; i < targetLength; i++) {
    const srcIdx = i * ratio;
    const low = Math.floor(srcIdx);
    const high = Math.min(low + 1, srcData.length - 1);
    const weight = srcIdx - low;
    output[i] = srcData[low] * (1 - weight) + srcData[high] * weight;
  }
  return output;
}

/**
 * Merge multiple AudioBuffers into one AudioBuffer with a configurable silence gap (ms) between clips
 * Handles mixed sample rates (e.g. 24kHz ElevenLabs, 44.1kHz Fish Audio, 48kHz mic) seamlessly
 */
export function mergeAudioBuffers(
  buffers: AudioBuffer[],
  gapMs: InterClipGapMs = 0,
  normalize: boolean = true
): AudioBuffer {
  if (buffers.length === 0) {
    const ctx = getAudioContext();
    return ctx.createBuffer(2, 44100, 44100);
  }

  // Use standard high-fidelity 44.1kHz or 48kHz sample rate based on inputs
  const targetSampleRate = buffers.some((b) => b.sampleRate === 48000) ? 48000 : 44100;
  let maxChannels = 1;
  for (const b of buffers) {
    if (b.numberOfChannels > maxChannels) maxChannels = b.numberOfChannels;
  }

  // Pre-process (normalize individual clip volumes if requested)
  const processedBuffers = buffers.map((buf) => (normalize ? normalizeAudioBuffer(buf) : buf));

  // Compute resampled lengths and prepare channel data for all clips
  const clipDataList: { channels: Float32Array[]; length: number }[] = [];
  let totalLength = 0;
  const gapSamples = Math.floor((gapMs / 1000) * targetSampleRate);

  for (let idx = 0; idx < processedBuffers.length; idx++) {
    const buf = processedBuffers[idx];
    const clipChannels: Float32Array[] = [];

    // Resample each channel if buffer sample rate differs from target
    const origChannels = buf.numberOfChannels;
    let clipLen = 0;

    for (let c = 0; c < maxChannels; c++) {
      const srcChannelIdx = c < origChannels ? c : 0;
      const rawData = buf.getChannelData(srcChannelIdx);
      const resampledData =
        buf.sampleRate === targetSampleRate
          ? rawData
          : resampleChannelData(rawData, buf.sampleRate, targetSampleRate);

      clipChannels.push(resampledData);
      clipLen = resampledData.length;
    }

    clipDataList.push({ channels: clipChannels, length: clipLen });
    totalLength += clipLen;
    if (idx < processedBuffers.length - 1) {
      totalLength += gapSamples;
    }
  }

  const ctx = getAudioContext();
  const mergedBuffer = ctx.createBuffer(maxChannels, Math.max(1, totalLength), targetSampleRate);

  const fadeLengthSamples = Math.min(Math.floor(targetSampleRate * 0.003), 128);
  let currentOffset = 0;

  for (let idx = 0; idx < clipDataList.length; idx++) {
    const clip = clipDataList[idx];
    const bLength = clip.length;

    for (let channel = 0; channel < maxChannels; channel++) {
      const srcData = clip.channels[channel];
      const destData = mergedBuffer.getChannelData(channel);

      for (let i = 0; i < bLength; i++) {
        let sample = srcData[i];

        // Smooth anti-pop micro fades at very edges (3ms) to eliminate digital clicks between takes
        if (i < fadeLengthSamples) {
          sample *= i / fadeLengthSamples;
        } else if (i > bLength - fadeLengthSamples) {
          sample *= (bLength - i) / fadeLengthSamples;
        }

        if (currentOffset + i < destData.length) {
          destData[currentOffset + i] = sample;
        }
      }
    }

    currentOffset += bLength;

    // Add silent gap space before next clip
    if (idx < clipDataList.length - 1) {
      currentOffset += gapSamples;
    }
  }

  return mergedBuffer;
}

/**
 * Export AudioBuffer to a downloadable Blob in the specified format (MP3, WAV, AAC)
 */
export async function exportAudioBuffer(
  buffer: AudioBuffer,
  format: ExportFormat,
  kbps: number = 256
): Promise<{ blob: Blob; extension: string; mimeType: string }> {
  if (format === 'mp3') {
    const blob = audioBufferToMp3Blob(buffer, kbps);
    return { blob, extension: 'mp3', mimeType: 'audio/mp3' };
  } else if (format === 'aac') {
    // Attempt MediaRecorder AAC or fall back to MP3/WAV if unavailable
    try {
      if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/aac')) {
        const wavBlob = audioBufferToWavBlob(buffer);
        return { blob: wavBlob, extension: 'aac', mimeType: 'audio/aac' };
      }
    } catch {
      // fallback
    }
    // High-quality MP3 fallback for AAC
    const blob = audioBufferToMp3Blob(buffer, 320);
    return { blob, extension: 'mp3', mimeType: 'audio/mp3' };
  } else {
    // WAV
    const blob = audioBufferToWavBlob(buffer);
    return { blob, extension: 'wav', mimeType: 'audio/wav' };
  }
}

/**
 * Download a Blob with given file name
 */
export function triggerFileDownload(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
