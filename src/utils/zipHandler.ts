import JSZip from 'jszip';

export interface ExtractedAudioFile {
  file: File;
  archiveName: string;
  originalPath: string;
}

export interface ZipExtractionResult {
  audioFiles: ExtractedAudioFile[];
  zipCount: number;
  totalExtracted: number;
  skippedNonAudioCount: number;
  archiveNames: string[];
}

/**
 * Known audio file extensions supported by modern web browsers
 */
const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'webm',
  'opus',
  'wma',
  'aiff',
  'aif',
]);

/**
 * Returns MIME type corresponding to audio file extension
 */
export function getAudioMimeType(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  switch (ext) {
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'aac':
      return 'audio/aac';
    case 'flac':
      return 'audio/flac';
    case 'ogg':
    case 'opus':
      return 'audio/ogg';
    case 'webm':
      return 'audio/webm';
    case 'aiff':
    case 'aif':
      return 'audio/aiff';
    default:
      return 'audio/wav';
  }
}

/**
 * Checks if a file is a ZIP archive by extension or MIME type
 */
export function isZipFile(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return (
    name.endsWith('.zip') ||
    type === 'application/zip' ||
    type === 'application/x-zip-compressed' ||
    type === 'multipart/x-zip'
  );
}

/**
 * Checks if a filename or path has an audio extension
 */
export function isAudioFileName(filename: string): boolean {
  const ext = filename.split('.').pop()?.toLowerCase() || '';
  return AUDIO_EXTENSIONS.has(ext);
}

/**
 * Unpacks a single ZIP archive and extracts all audio files
 */
export async function extractAudioFromZip(
  zipFile: File | Blob,
  archiveName?: string
): Promise<ExtractedAudioFile[]> {
  const actualArchiveName = archiveName || (zipFile instanceof File ? zipFile.name : 'archive.zip');
  const zip = new JSZip();
  const loadedZip = await zip.loadAsync(zipFile);

  const extracted: ExtractedAudioFile[] = [];
  const entryPromises: Promise<void>[] = [];

  loadedZip.forEach((relativePath, zipEntry) => {
    // Skip directories and metadata/hidden files
    if (zipEntry.dir) return;
    if (relativePath.includes('__MACOSX') || relativePath.startsWith('.')) return;
    const baseName = relativePath.split('/').pop() || relativePath;
    if (baseName.startsWith('.')) return;

    if (isAudioFileName(baseName)) {
      const mime = getAudioMimeType(baseName);
      const promise = zipEntry.async('blob').then((blob) => {
        // Create standard browser File object
        const file = new File([blob], baseName, {
          type: mime,
          lastModified: zipEntry.date ? zipEntry.date.getTime() : Date.now(),
        });

        extracted.push({
          file,
          archiveName: actualArchiveName,
          originalPath: relativePath,
        });
      });
      entryPromises.push(promise);
    }
  });

  await Promise.all(entryPromises);

  // Sort files naturally by path/name within the archive
  extracted.sort((a, b) =>
    a.originalPath.localeCompare(b.originalPath, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );

  return extracted;
}

/**
 * Unpacks MULTIPLE ZIP archives (and any passed audio files), returning all audio files found.
 */
export async function unpackMultipleZipAndAudioFiles(
  files: File[],
  onProgress?: (msg: string, currentZip: number, totalZips: number) => void
): Promise<ZipExtractionResult> {
  const audioFiles: ExtractedAudioFile[] = [];
  const archiveNames: string[] = [];
  let zipCount = 0;
  let skippedNonAudioCount = 0;

  // Deduplicate input files by filename, size, and lastModified
  const seenInputFiles = new Set<string>();
  const uniqueInputFiles: File[] = [];
  for (const f of files) {
    const sig = `${f.name.toLowerCase().trim()}_${f.size}_${f.lastModified}`;
    if (!seenInputFiles.has(sig)) {
      seenInputFiles.add(sig);
      uniqueInputFiles.push(f);
    }
  }

  // Split into zip files vs direct audio files
  const zipFiles: File[] = [];
  const directAudioFiles: File[] = [];

  for (const f of uniqueInputFiles) {
    if (isZipFile(f)) {
      zipFiles.push(f);
    } else if (f.type.startsWith('audio/') || isAudioFileName(f.name)) {
      directAudioFiles.push(f);
    } else {
      skippedNonAudioCount++;
    }
  }

  const seenAudioTrackSignatures = new Set<string>();

  // Include direct audio files first
  for (const audioFile of directAudioFiles) {
    const sig = `${audioFile.name.toLowerCase().trim()}_${audioFile.size}`;
    if (!seenAudioTrackSignatures.has(sig)) {
      seenAudioTrackSignatures.add(sig);
      audioFiles.push({
        file: audioFile,
        archiveName: '',
        originalPath: audioFile.name,
      });
    }
  }

  // Process ZIP archives
  zipCount = zipFiles.length;
  for (let i = 0; i < zipFiles.length; i++) {
    const zf = zipFiles[i];
    archiveNames.push(zf.name);
    if (onProgress) {
      onProgress(`Unpacking ${zf.name} (${i + 1} of ${zipFiles.length})...`, i + 1, zipFiles.length);
    }

    try {
      const extractedFromThisZip = await extractAudioFromZip(zf, zf.name);
      for (const extractedItem of extractedFromThisZip) {
        const sig = `${extractedItem.file.name.toLowerCase().trim()}_${extractedItem.file.size}`;
        if (!seenAudioTrackSignatures.has(sig)) {
          seenAudioTrackSignatures.add(sig);
          audioFiles.push(extractedItem);
        }
      }
    } catch (err) {
      console.error(`Error unpacking zip archive ${zf.name}:`, err);
    }
  }

  return {
    audioFiles,
    zipCount,
    totalExtracted: audioFiles.length,
    skippedNonAudioCount,
    archiveNames,
  };
}

/**
 * Creates a downloadable ZIP containing multiple cleaned audio clips
 */
export async function createAudioZipArchive(
  items: { name: string; blob: Blob }[],
  onProgress?: (percent: number) => void
): Promise<Blob> {
  const zip = new JSZip();

  // Add files to zip
  items.forEach((item, index) => {
    // Ensure unique filename if collisions exist
    const filename = item.name.trim();
    zip.file(filename, item.blob);
  });

  return await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: {
        level: 6,
      },
    },
    (metadata) => {
      if (onProgress) {
        onProgress(Math.round(metadata.percent));
      }
    }
  );
}
