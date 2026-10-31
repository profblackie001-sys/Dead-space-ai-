import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Body parser for JSON payloads (allowing audio base64 uploads)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Lazy initialization of Gemini API Client
let aiClient: GoogleGenAI | null = null;
function getAI(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

/**
 * Endpoint to transcribe a single audio clip and/or match it against a reference voiceover script.
 * Uses gemini-3.8-flash (multimodal audio + text reasoning).
 */
app.post('/api/transcribe-and-match-clip', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/mp3', script = '', fileName = 'clip.mp3' } = req.body;

    if (!audioBase64) {
      res.status(400).json({ error: 'Missing audioBase64 in request body' });
      return;
    }

    const ai = getAI();
    if (!ai) {
      res.status(200).json({
        success: false,
        fallback: true,
        message: 'No GEMINI_API_KEY available on server. Use client-side transcription/alignment.',
      });
      return;
    }

    const prompt = script
      ? `You are an expert audio alignment assistant.
Task:
1. Accurately transcribe verbatim the speech in this audio clip.
2. Compare the transcribed speech with the following full reference voiceover script:
"""
${script}
"""
3. Determine where in the reference script this audio clip belongs.

Return ONLY a JSON object formatted exactly as:
{
  "transcript": "Exact words spoken in this audio clip",
  "matchedSnippet": "The exact or closely matching excerpt from the reference script",
  "startIndex": 0, // approximate character start offset of the matched snippet in the reference script
  "endIndex": 50,  // approximate character end offset of the matched snippet in the reference script
  "confidence": 95 // confidence score between 0 and 100
}`
      : `Transcribe verbatim the speech spoken in this audio clip.
Return ONLY a JSON object formatted as:
{
  "transcript": "Exact words spoken in this audio clip"
}`;

    // Model waterfall prioritizing models with available free tier quota
    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-3.5-transcribe',
      'gemini-flash-latest',
    ];
    let response: any = null;
    let lastErr: any = null;

    for (const modelName of candidateModels) {
      try {
        const isTranscribeModel = modelName.includes('transcribe');
        const contents: any[] = [
          {
            inlineData: {
              data: audioBase64,
              mimeType: mimeType || 'audio/mp3',
            },
          },
          isTranscribeModel
            ? 'Transcribe verbatim the speech spoken in this audio clip. Return plain text only.'
            : prompt,
        ];

        const reqConfig: any = {};
        // gemini-3.5-transcribe does NOT support responseMimeType: 'application/json'
        if (!isTranscribeModel) {
          reqConfig.responseMimeType = 'application/json';
        }

        response = await ai.models.generateContent({
          model: modelName,
          contents,
          ...(Object.keys(reqConfig).length > 0 ? { config: reqConfig } : {}),
        });

        if (response && response.text) {
          // If transcribe model was used, construct the structured match JSON
          if (isTranscribeModel) {
            const rawTranscript = (response.text || '').trim();
            let matchedSnippet = rawTranscript;
            let startIndex = 0;
            let endIndex = rawTranscript.length;
            let confidence = 92;

            if (script && rawTranscript.length > 2) {
              const scriptLower = script.toLowerCase();
              const transcriptLower = rawTranscript.toLowerCase();
              // Try exact or start tokens search in script
              const tokens = transcriptLower.split(/\s+/).filter(Boolean);
              let foundIndex = -1;
              for (let len = Math.min(5, tokens.length); len >= 2; len--) {
                const phrase = tokens.slice(0, len).join(' ');
                foundIndex = scriptLower.indexOf(phrase);
                if (foundIndex !== -1) break;
              }
              if (foundIndex !== -1) {
                startIndex = foundIndex;
                endIndex = Math.min(script.length, foundIndex + rawTranscript.length + 30);
                matchedSnippet = script.substring(startIndex, endIndex).trim();
                confidence = 98;
              }
            }

            response = {
              text: JSON.stringify({
                transcript: rawTranscript,
                matchedSnippet,
                startIndex,
                endIndex,
                confidence,
              }),
            };
          }
          break;
        }
      } catch (err: any) {
        lastErr = err;
        console.warn(`Model ${modelName} failed, trying next candidate:`, err?.message || err);
      }
    }

    if (!response || !response.text) {
      throw lastErr || new Error('All Gemini models failed to process audio');
    }

    const responseText = response.text || '{}';
    let parsedData = {};
    try {
      parsedData = JSON.parse(responseText);
    } catch {
      parsedData = { transcript: responseText };
    }

    res.json({
      success: true,
      fileName,
      data: parsedData,
    });
  } catch (error: any) {
    console.error('Error in /api/transcribe-and-match-clip:', error?.message || error);
    const isOverloaded =
      error?.status === 503 ||
      String(error?.message || '').includes('503') ||
      String(error?.message || '').includes('high demand') ||
      String(error?.message || '').includes('RESOURCE_EXHAUSTED');

    res.status(200).json({
      success: false,
      fallback: true,
      isOverloaded,
      message: isOverloaded
        ? 'Gemini model is currently experiencing temporary high demand. Using high-precision script alignment.'
        : error.message || 'Failed to process audio clip with Gemini',
    });
  }
});

/**
 * Endpoint to align multiple transcripts against a full voiceover script.
 * Useful when clips are already transcribed or need global sequence sorting.
 */
app.post('/api/align-script-transcripts', async (req, res) => {
  try {
    const { script, clips } = req.body;
    if (!script || !Array.isArray(clips) || clips.length === 0) {
      res.status(400).json({ error: 'Missing script or clips array' });
      return;
    }

    const ai = getAI();
    if (!ai) {
      res.status(200).json({
        success: false,
        fallback: true,
        message: 'No GEMINI_API_KEY available on server. Using heuristic script aligner.',
      });
      return;
    }

    const clipsDescription = clips
      .map(
        (c: { id: string; name: string; transcript: string }, idx: number) =>
          `Clip ID: "${c.id}" (Filename: "${c.name}")\nTranscript: "${c.transcript || ''}"`
      )
      .join('\n\n');

    const prompt = `You are a voiceover sequencing engine.
A creator split a full voiceover script into multiple chunks and generated audio clips using a tool like Fish Audio.
However, the clips have random names or are out of order.

Here is the FULL MASTER VOICEOVER SCRIPT:
"""
${script}
"""

Here are the audio clips with their transcripts:
${clipsDescription}

TASK:
1. Determine the exact chronological order in which these clips should be played to read the full script from start to finish.
2. For each clip, provide the matched section in the master script, the character start index, end index, and confidence score.
3. Identify any portions of the master script that were missing from all clips.

Return ONLY a JSON object with this schema:
{
  "orderedClipIds": ["clip-id-1", "clip-id-2", ...],
  "alignments": [
    {
      "id": "clip-id-1",
      "matchedSnippet": "corresponding script segment",
      "startIndex": 0,
      "endIndex": 120,
      "confidence": 98
    }
  ],
  "missingScriptSections": ["Any sentences or phrases from the master script not covered by any clip"],
  "coveragePercentage": 100
}`;

    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-flash-latest',
    ];
    let response: any = null;
    let lastErr: any = null;

    for (const modelName of candidateModels) {
      try {
        response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
          },
        });
        if (response && response.text) break;
      } catch (err: any) {
        lastErr = err;
        console.warn(`Model ${modelName} failed for script alignment, trying next candidate:`, err?.message || err);
      }
    }

    if (!response || !response.text) {
      throw lastErr || new Error('All Gemini models failed to align script');
    }

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error('Error in /api/align-script-transcripts:', error?.message || error);
    const isOverloaded =
      error?.status === 503 ||
      String(error?.message || '').includes('503') ||
      String(error?.message || '').includes('high demand') ||
      String(error?.message || '').includes('RESOURCE_EXHAUSTED');

    res.status(200).json({
      success: false,
      fallback: true,
      isOverloaded,
      message: isOverloaded
        ? 'Gemini model is currently experiencing temporary high demand. Using high-precision script alignment.'
        : error.message || 'Failed to align transcripts with script',
    });
  }
});

/**
 * Endpoint to transcribe an audio file into standard SRT (SubRip) subtitle format with exact timestamps.
 * Uses gemini-3.5-transcribe or gemini-3.8-flash with fallback.
 */
app.post('/api/generate-srt', async (req, res) => {
  try {
    const { audioBase64, mimeType = 'audio/mp3', referenceScript = '' } = req.body;

    if (!audioBase64) {
      res.status(400).json({ error: 'Missing audioBase64 in request body' });
      return;
    }

    const ai = getAI();
    if (!ai) {
      res.status(200).json({
        success: false,
        fallback: true,
        message: 'No GEMINI_API_KEY available on server.',
      });
      return;
    }

    const prompt = `You are a professional video subtitle and SRT generator.
Task: Transcribe the speech from this audio file and generate standardized, accurately timestamped SRT (SubRip) subtitle cues.

Format Rules:
1. Every subtitle cue must have:
   - Sequential Index number (1, 2, 3...)
   - Exact timecode range in standard format: HH:MM:SS,mmm --> HH:MM:SS,mmm (use comma for milliseconds, e.g. 00:00:01,250 --> 00:00:04,100)
   - Caption text: Break speech naturally into readable 1-2 line chunks (about 4 to 10 words per line, max 12 words per cue).
2. Follow the spoken pace accurately so captions appear when spoken.
${referenceScript ? `3. STRICT ACCURACY: Use this reference script for 100% correct spelling, capitalization, names, and punctuation:\n"""\n${referenceScript}\n"""` : ''}

Return a valid JSON object strictly formatted as:
{
  "srtText": "1\\n00:00:00,500 --> 00:00:03,800\\nFirst subtitle line\\n\\n2\\n00:00:03,850 --> 00:00:07,100\\nSecond subtitle line\\n",
  "cues": [
    {
      "id": 1,
      "startTime": "00:00:00,500",
      "endTime": "00:00:03,800",
      "startSeconds": 0.5,
      "endSeconds": 3.8,
      "text": "First subtitle line"
    }
  ]
}`;

    // Candidate models for audio transcription
    const candidateModels = [
      'gemini-3.1-flash-lite',
      'gemini-3.5-flash-lite',
      'gemini-3.5-transcribe',
      'gemini-flash-lite-latest',
      'gemini-3.8-flash',
    ];
    let response: any = null;
    let lastErr: any = null;

    for (const modelName of candidateModels) {
      try {
        const isTranscribeModel = modelName.includes('transcribe');
        const contents: any[] = [
          {
            inlineData: {
              data: audioBase64,
              mimeType: mimeType || 'audio/mp3',
            },
          },
          isTranscribeModel
            ? 'Transcribe this audio verbatim with exact timestamps in standard SubRip SRT format:\n1\n00:00:00,000 --> 00:00:02,000\nSubtitle text'
            : prompt,
        ];

        const reqConfig: any = {};
        if (!isTranscribeModel) {
          reqConfig.responseMimeType = 'application/json';
        }

        response = await ai.models.generateContent({
          model: modelName,
          contents,
          ...(Object.keys(reqConfig).length > 0 ? { config: reqConfig } : {}),
        });
        if (response && response.text) break;
      } catch (err: any) {
        lastErr = err;
        console.warn(`Model ${modelName} failed for SRT generation, trying next:`, err?.message || err);
      }
    }

    if (!response || !response.text) {
      throw lastErr || new Error('All Gemini models failed to generate subtitles');
    }

    const parsed = JSON.parse(response.text || '{}');
    res.json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error('Error in /api/generate-srt:', error?.message || error);
    res.status(200).json({
      success: false,
      fallback: true,
      message: error.message || 'Failed to generate subtitles with AI',
    });
  }
});

// Vite middleware setup
async function start() {
  const distPath = path.join(process.cwd(), 'dist');
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.npm_lifecycle_event === 'start' ||
    (!process.env.NODE_ENV && fs.existsSync(path.join(distPath, 'index.html')));

  if (isProduction && fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    try {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (e) {
      console.warn('Vite dev middleware not available, falling back to static files:', e);
      if (fs.existsSync(distPath)) {
        app.use(express.static(distPath));
        app.get('*', (req, res) => {
          res.sendFile(path.join(distPath, 'index.html'));
        });
      }
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

start();
