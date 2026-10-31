import React, { useRef, useState } from 'react';
import { Upload, Music, FileAudio, Sparkles, CheckCircle2, AlertCircle, RefreshCw, Wand2, Archive } from 'lucide-react';
import { isZipFile } from '../utils/zipHandler';

interface UploadZoneProps {
  onFileSelected: (file: File) => void;
  onFilesOrZipSelected?: (files: File[]) => void;
  isLoading: boolean;
  loadingProgressText?: string;
  loadedFileName?: string;
  loadedFileSize?: number;
  onReset: () => void;
  onLoadSample: () => void;
}

export const UploadZone: React.FC<UploadZoneProps> = ({
  onFileSelected,
  onFilesOrZipSelected,
  isLoading,
  loadingProgressText = 'Decoding audio file...',
  loadedFileName,
  loadedFileSize,
  onReset,
  onLoadSample,
}) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTriggeringPickerRef = useRef<boolean>(false);

  const triggerFilePicker = () => {
    if (isLoading || isTriggeringPickerRef.current) return;
    isTriggeringPickerRef.current = true;
    fileInputRef.current?.click();
    setTimeout(() => {
      isTriggeringPickerRef.current = false;
    }, 400);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const rawFiles = Array.from(fileList) as File[];

    // Deduplicate selected files (prevent double-selected clips)
    const seen = new Set<string>();
    const files: File[] = [];
    for (const f of rawFiles) {
      const sig = `${f.name.toLowerCase().trim()}_${f.size}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        files.push(f);
      }
    }

    if (files.length === 0) return;

    if (files.length > 1 || files.some((f) => isZipFile(f))) {
      if (onFilesOrZipSelected) {
        onFilesOrZipSelected(files);
        e.target.value = '';
        return;
      }
    }

    validateAndPassFile(files[0]);
    e.target.value = '';
  };

  const validateAndPassFile = (file: File) => {
    setErrorMsg(null);
    if (isZipFile(file)) {
      if (onFilesOrZipSelected) {
        onFilesOrZipSelected([file]);
        return;
      }
    }

    const validExtensions = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'webm', 'mp4'];
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (!ext || (!validExtensions.includes(ext) && !file.type.startsWith('audio/'))) {
      setErrorMsg('Please select a supported audio format (MP3, WAV, M4A, AAC, FLAC, OGG) or ZIP archive.');
      return;
    }

    onFileSelected(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const rawFiles = Array.from(e.dataTransfer.files) as File[];
    if (rawFiles.length === 0) return;

    // Deduplicate dropped files
    const seen = new Set<string>();
    const files: File[] = [];
    for (const f of rawFiles) {
      const sig = `${f.name.toLowerCase().trim()}_${f.size}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        files.push(f);
      }
    }
    if (files.length === 0) return;

    if (files.length > 1 || files.some((f) => isZipFile(f))) {
      if (onFilesOrZipSelected) {
        onFilesOrZipSelected(files);
        return;
      }
    }

    validateAndPassFile(files[0]);
  };

  const formatSize = (bytes?: number) => {
    if (!bytes) return '';
    const mb = bytes / (1024 * 1024);
    if (mb < 1) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${mb.toFixed(2)} MB`;
  };

  return (
    <div id="upload-container" className="w-full">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.zip,application/zip,application/x-zip-compressed,multipart/x-zip"
        className="hidden"
        onChange={handleFileChange}
      />

      {loadedFileName ? (
        /* Loaded File Header Card */
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 sm:p-5 shadow-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-3.5 w-full sm:w-auto overflow-hidden">
            <div className="w-12 h-12 rounded-xl bg-cyan-950/80 border border-cyan-800/60 flex items-center justify-center shrink-0">
              <FileAudio className="w-6 h-6 text-cyan-400" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center space-x-2">
                <h3 className="text-sm font-semibold text-white truncate font-mono">
                  {loadedFileName}
                </h3>
                <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950/80 text-emerald-400 border border-emerald-800/60">
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Decoded</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                {formatSize(loadedFileSize)} • Ready for silence detection
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2 w-full sm:w-auto justify-end">
            <button
              id="change-audio-btn"
              onClick={triggerFilePicker}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 hover:text-white transition-all cursor-pointer"
            >
              Replace Audio
            </button>
            <button
              id="clear-audio-btn"
              onClick={onReset}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/40 transition-all cursor-pointer"
              title="Clear audio file"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
      ) : (
        /* Dropzone Card */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={triggerFilePicker}
          className={`relative border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center transition-all cursor-pointer group ${
            isDragOver
              ? 'border-cyan-400 bg-cyan-950/30 shadow-2xl shadow-cyan-500/10 scale-[1.005]'
              : 'border-slate-800 hover:border-slate-700 bg-slate-900/60 hover:bg-slate-900/80'
          }`}
        >
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              <div className="relative w-14 h-14 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-2 border-cyan-500/20 animate-ping" />
                <div className="w-12 h-12 rounded-full border-2 border-cyan-400 border-t-transparent animate-spin" />
                <Music className="w-5 h-5 text-cyan-400 absolute" />
              </div>
              <div>
                <p className="text-sm font-semibold text-white font-mono">{loadingProgressText}</p>
                <p className="text-xs text-slate-400 mt-1">Analyzing PCM audio samples in browser...</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center space-y-4">
              {/* Drop Icon */}
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-slate-900 to-slate-800 border border-slate-700/80 flex items-center justify-center group-hover:border-cyan-500/50 group-hover:shadow-lg group-hover:shadow-cyan-500/10 transition-all">
                <Upload className="w-7 h-7 text-cyan-400 group-hover:scale-110 transition-transform" />
              </div>

              {/* Title & Instructions */}
              <div>
                <h2 className="text-lg font-bold text-white tracking-tight">
                  Drag & Drop audio files or ZIP archives here
                </h2>
                <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">
                  Supports <span className="text-slate-300 font-medium">MP3, WAV, M4A, AAC, FLAC, OGG</span>, plus <span className="text-cyan-400 font-medium">multiple .ZIP archives</span> containing audio clips.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                <button
                  type="button"
                  id="select-file-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerFilePicker();
                  }}
                  className="px-5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold text-slate-950 bg-gradient-to-r from-cyan-400 to-emerald-400 hover:brightness-110 shadow-lg shadow-cyan-500/20 transition-all cursor-pointer inline-flex items-center space-x-2"
                >
                  <Upload className="w-4 h-4 text-slate-950" />
                  <span>Select Audio or ZIP Files</span>
                </button>

                <button
                  type="button"
                  id="try-demo-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onLoadSample();
                  }}
                  className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium text-slate-300 bg-slate-800/90 border border-slate-700 hover:bg-slate-700 hover:text-white transition-all cursor-pointer inline-flex items-center space-x-2"
                >
                  <Wand2 className="w-4 h-4 text-emerald-400" />
                  <span>Try Demo Sample</span>
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-4 p-3 rounded-lg bg-rose-950/60 border border-rose-800/80 text-rose-300 text-xs inline-flex items-center space-x-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
