# Client-Side Speech & Deterministic Script Alignment Engine

A reliable, quota-free audio sequencing engine that transcribes clips in the browser, aligns them to your script beats sequentially, and provides a clear visual sequence preview so audio clips never merge out of order.

---

### User Review & Critical Decisions

> [!IMPORTANT]
> The following choices were confirmed in Phase 1 clarification:
> - **Primary Failure Point**: Audio clips are arranging in the wrong order when merged into the master timeline.
> - **Preferred Solution**: Client-side speech recognition and local alignment without Gemini API quota limits or 429 rate limit errors.

- **Confirmed Decision 1**: Eliminate reliance on server-side Gemini endpoints for basic clip ordering to prevent 429 "RESOURCE_EXHAUSTED" quota lockouts.
- **Confirmed Decision 2**: Introduce a multi-tier client-side alignment system featuring browser-native speech recognition, natural numeric sorting, forward-only script text matching, and an interactive visual review tray before merging.

---

### 1. Overview & Core Concept

- **What It Does**: Transcribes audio clips directly in the client (or matches their audio content against your pasted script), determines their exact chronological beat sequence, and displays an interactive, drag-and-reorder preview before generating the merged master voiceover.
- **Target Audience / Persona**: Creators producing faceless narration, video essays, and scripted reels who upload multiple separate audio takes and need them stitched together in exact script order.
- **Key Value**: 100% deterministic audio sequencing that never relies on daily API quotas, never scrambles numbered files alphabetically, and lets you verify each clip's assigned script beat with 1-click audio preview.

---

### 2. User Experience & Visual Design

#### Key User Flows

1. **Upload & Auto-Sequence**:
   - The user drops multiple audio clips (`01.mp3`, `02.mp3` or descriptive filenames) into the Batch Merge / Voiceover Arranger.
   - The engine automatically applies **Natural Numerical Ordering** (so `2.mp3` always comes before `10.mp3`).
   - If a script is pasted, the client-side recognizer listens to the audio clips and maps each clip to its corresponding script sentence in strict forward chronological order.

2. **Visual Sequence Review & Audio Preview**:
   - Each clip is displayed in a clean, high-density sequence card showing:
     - Order index badge (`#1`, `#2`, `#3`...)
     - Filename and duration with tabular numbers
     - Spoken snippet / matched script line
     - Quick "Play / Pause" preview button so you can instantly verify the soundbite
     - Drag handle + "Move Up" / "Move Down" buttons for instant manual adjustments if needed

3. **Pre-Merge Validation**:
   - When clicking **"Merge Audio Clips"**, the system performs an invariant check:
     - Confirms strict monotonic progression (Clip 1 $\rightarrow$ Clip 2 $\rightarrow$ Clip 3).
     - Warns the user if any clip appears out of sequence with the script.
   - Upon confirmation, it merges the clips with sample-accurate Web Audio concatenation and sends the master audio and beat map directly to the editor timeline.

#### Visual Styling & Theme

- **Aesthetic Direction**: Utilitarian, precision media tool inspired by pro desktop non-linear editors (DaVinci / CapCut Pro).
- **Color Palette**: Dark slate canvas (`#0b0f19` / `#111827`) with neutral hairline borders (`border-slate-800`), muted typography (`text-slate-400`), and focused amber/indigo accents for active playback and sequence numbers.
- **Typography**: Clean display sans (`Plus Jakarta Sans` / system sans) with tabular figures (`font-mono tabular-nums`) for all timecodes, clip indices, and duration readouts.
- **Anti-Slop Discipline**: No decorative badges, no pulsing green dots, no candy pill enclosures. Metadata (duration, word count) is rendered as clean unboxed text with typographic bullet separators (`·`).

---

### 3. Key Product Decisions & Trade-Offs

#### Decision 1: Browser-Side Speech Recognition vs. Server API Calls
- **Chosen Approach**: Use browser-native `webkitSpeechRecognition` / Web Audio playback stream and local fuzzy script searching as the primary engine, completely removing the fragile 6-second timeout and 429 quota exhaustion of cloud endpoints.
- **Why**: The Gemini free tier has a strict 20-request/day limit which caused total failure for users with more than 15-20 clips. Browser-side recognition has zero quota limits, zero network latency, and runs entirely on the user's machine.
- **Alternatives Considered**: Paid server proxy with Cloud Speech-to-Text (incurs ongoing cloud costs and requires external credentials).

#### Decision 2: Natural Numeric Sorting as Baseline
- **Chosen Approach**: Replace standard JavaScript `a.name.localeCompare(b.name)` with `a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })`.
- **Why**: Standard alphabetical sorting places `10.mp3`, `11.mp3`, and `12.mp3` before `2.mp3`, which directly caused the outro and middle segments to be spliced out of order in the user's previous merged audio.

#### Decision 3: Forward-Only Monotonic Script Tracking
- **Chosen Approach**: When matching clips against the pasted script, enforce that Clip $N$ must match text that appears *after* Clip $N-1$ in the script document.
- **Why**: Prevents recurring phrases (like "You turn off the light" or "Your brain") from jumping backward to earlier paragraphs.

---

### 4. Technical Architecture & Data Strategy

```
┌────────────────────────────────────────────────────────┐
│                   User Audio Files                     │
│        (e.g., 001.mp3, 002.mp3, clip_intro.wav)        │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│            Natural Numerical Collator Sort             │
│        (Guarantees 1, 2, 3... 9, 10, 11 ordering)       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│       Client-Side Speech Recognition & Audio Peek      │
│   (Web Speech API / Web Audio stream - Quota Free)     │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│      Forward-Only Monotonic Script Beat Matcher        │
│   (Clips map sequentially to Script sentences 1..N)    │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│      Interactive Sequence Review & Preview Tray        │
│     - Listen to any clip with 1-click preview          │
│     - Verify matched script beat number                │
│     - Drag or click up/down to reorder if needed       │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│        Deterministic Web Audio Buffer Merger           │
│     - Sample-accurate chronological concatenation      │
│     - Invariant master audio duration                  │
└────────────────────────────────────────────────────────┘
```

#### Core Components & Responsibilities

1. **`src/utils/clientSpeechRecognizer.ts`**:
   - Manages client-side speech-to-text using Web Speech API with audio element playback routing.
   - Generates reliable local text transcripts for audio clips without network calls or API limits.

2. **`src/utils/scriptAligner.ts`**:
   - Updates `sortItemsByFilename` to use natural numeric sorting.
   - Enforces forward-only monotonic search against the master script text.
   - Eliminates silent fallback failures when server API returns 429 quota errors.

3. **`src/components/VoiceoverScriptArranger.tsx` & `BatchMergePanel.tsx`**:
   - Enhances the arrangement table with inline audio previews (play/pause button for each clip).
   - Displays the detected script snippet and beat index prominently.
   - Provides clear manual reorder handles (drag and up/down arrows) so the user retains complete visual control before merging.

---

### 5. Verification & Testing Steps

1. **Natural Numeric Sorting**:
   - Verify that clips named `1.mp3`, `2.mp3`, `9.mp3`, `10.mp3`, `12.mp3` order in exact numeric sequence, never placing `10` before `2`.
2. **Quota-Free Speech & Script Alignment**:
   - Upload 12+ separate narration clips alongside the user's pareidolia script.
   - Verify that transcription and alignment succeed without any 429 errors or network timeouts.
   - Confirm that forward monotonic matching assigns Paragraph 1 $\rightarrow$ Clip 1, Paragraph 2 $\rightarrow$ Clip 2, and outro $\rightarrow$ final clip.
3. **Interactive Audio Playback**:
   - Click "Play" on any clip in the arrangement list to verify the audio matches its displayed script line.
4. **Merge Accuracy**:
   - Merge all clips and verify the resulting single audio file plays in 100% uninterrupted chronological order matching the script.
