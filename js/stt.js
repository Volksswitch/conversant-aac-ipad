import * as platform from './platform.js';
import * as deepgram from './stt-deepgram.js';

let recognition = null;
// A non-browser capture backend (Deepgram), or null when using the built-in
// recognizer. Only one is ever active.
let externalSource = null;
// Per-platform recognition tuning (see platform.js). Defaults are the desktop
// values; init() replaces them with the platform's.
let speechCfg = { continuous: true, restartDelayMs: 0, guardVisibility: false };
// Set when recognition was stopped because the page went into the background,
// NOT because the user stopped listening. Distinguishing the two matters:
// listeningIntent must stay true so we resume on return, but onend must not
// restart while we are deliberately suspended, or it fights the guard.
let suspendedForHidden = false;
let onTranscript = null;
let onSilencePeriod = null;
let onStatusChange = null;
let onPartnerActivity = null;   // fired when genuine (non-echo) partner speech arrives
let accumulatedText = '';
let segments = [];          // each finalized statement, in order (accumulatedText = joinParts(segments))
let currentInterim = '';
let silenceTimer = null;
let silenceThreshold = 2000;
let listeningIntent = false;
// Echo filtering. While the app speaks (placeholder ladder, prompts), the mic would
// otherwise capture our own TTS, treat it as partner speech, append it to
// accumulatedText and renew the silence timer — restarting the placeholder ladder
// and abandoning the in-flight response generation. We do NOT mute the mic
// (that would also drop a partner who talks over us). Instead we keep a list of
// phrases the app is currently speaking and discard any captured segment that
// matches one — only genuinely new partner content renews the turn. Each phrase
// stays active for a tail window past the end of speech to cover recognition
// lag and the trailing audio.
const activePhrases = [];      // [{ text: <normalized>, tokens: <string[]>, expires: <ms epoch|Infinity> }]
// Two separate windows after the app stops speaking (Ken, July 13 2026):
//  - ECHO_TAIL_MS: the checkpoint gate (speechActive) — kept short so a genuine
//    partner reply right after we speak isn't delayed.
//  - ECHO_MATCH_MS: how long a spoken phrase stays MATCHABLE for excision — kept
//    longer because the cloud recognizer often returns our echo a couple seconds
//    late (after the tail), and if the phrase has already expired the late echo
//    slips through and pollutes the partner turn.
const ECHO_TAIL_MS = 1500;
const ECHO_MATCH_MS = 4000;

// Trigger-level guard against the TTS feedback loop (Ken, June 18 2026). The
// content filter (isEcho) drops captured segments that MATCH what we're saying,
// but the recognizer often mis-hears our own playback (drops/adds a word) so the
// echo slips past, renews the silence timer and re-fires generation — the
// runaway loop (stack grows, options flicker). Content matching can't be made
// robust against mis-transcription, so we also gate at the trigger: while the
// app itself is speaking (and for the echo tail after), captured audio does NOT
// reset the silence timer and the checkpoint does NOT fire. The mic stays on and
// non-echo content still accumulates into the transcript; it just can't drive a
// generation checkpoint while WE are the ones making noise. A genuine partner
// turn fires normally once the app falls quiet.
let appSpeaking = false;       // true between noteSpokenStart and noteSpokenEnd
let speechSettleUntil = 0;     // ms epoch the tail window after speech ends

function speechActive() {
    return appSpeaking || Date.now() < speechSettleUntil;
}

// Join finalized segments (and/or the in-progress interim) with single spaces. The
// recognizer returns each segment WITHOUT a separating space, so "Good morning."
// + "How are you?" would otherwise concatenate into "Good morning.How are you?"
// (Ken, July 13 2026). Trims each part and drops empties so there are no doubles.
function joinParts(parts) {
    return parts.map((s) => (s || '').trim()).filter(Boolean).join(' ');
}

export function isSupported() {
    return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

export function setSilenceThreshold(seconds) {
    silenceThreshold = seconds * 1000;
}

// Normalize for echo comparison: lowercase, strip punctuation, collapse runs of
// whitespace. So "Give me a second." and a recognizer's "give me a second"
// match.
function normalizeForEcho(text) {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Wired to tts speaking-state in app.js. noteSpokenStart(text) registers a
// phrase the app is now speaking; noteSpokenEnd() lets the active phrases
// expire after a tail window (they stay matchable until then).
export function noteSpokenStart(text) {
    appSpeaking = true;
    const norm = normalizeForEcho(text || '');
    if (!norm) return;
    // While speaking, the phrase never expires; noteSpokenEnd sets the deadline.
    // Pre-tokenize for the fuzzy slice matcher (isEcho).
    activePhrases.push({ text: norm, tokens: norm.split(' '), expires: Infinity });
}

export function noteSpokenEnd() {
    appSpeaking = false;
    speechSettleUntil = Date.now() + ECHO_TAIL_MS;      // checkpoint gate — short
    const deadline = Date.now() + ECHO_MATCH_MS;        // matchable window — longer
    for (const p of activePhrases) {
        if (p.expires === Infinity) p.expires = deadline;
    }
}

// Levenshtein distance, only meaningful for the small threshold we compare against
// (early-out when the lengths differ by more than 2 — too far for a mis-hearing).
function editDistance(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 3;
    const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
    for (let j = 1; j <= b.length; j++) {
        let prev = dp[0];
        dp[0] = j;
        for (let i = 1; i <= a.length; i++) {
            const tmp = dp[i];
            dp[i] = Math.min(dp[i] + 1, dp[i - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
            prev = tmp;
        }
    }
    return dp[a.length];
}

// Two tokens are "similar" if equal or a short mis-hearing apart — the recognizer
// swaps a vowel/consonant on our own playback ("still" → "steel"). Allow up to 2
// edits for words of length >= 4, 1 for length 3; short words must match exactly
// (too easy to collide otherwise).
function tokensSimilar(a, b) {
    if (a === b) return true;
    const minLen = Math.min(a.length, b.length);
    if (minLen < 3) return false;
    return editDistance(a, b) <= (minLen >= 4 ? 2 : 1);
}

// Is `needle` (tokens) a fuzzy CONTIGUOUS slice of `haystack` (tokens)? Slides the
// needle across the haystack; a window matches if at most ~1 token per 3 differs
// (a mis-heard word). This is what catches a partial echo — a suffix or middle
// slice of what we said, e.g. the recognizer returns only "had some time to relax"
// out of a longer response — which exact/prefix matching missed entirely.
function fuzzySlice(haystack, needle) {
    const nn = needle.length, hn = haystack.length;
    if (nn === 0 || nn > hn) return false;
    const maxMiss = Math.floor(nn / 3);
    for (let start = 0; start + nn <= hn; start++) {
        let miss = 0, ok = true;
        for (let k = 0; k < nn; k++) {
            if (!tokensSimilar(haystack[start + k], needle[k]) && ++miss > maxMiss) { ok = false; break; }
        }
        if (ok) return true;
    }
    return false;
}

// A captured segment is echo if, after normalizing, it matches an active spoken
// phrase. Empty-after-normalize segments (pure punctuation/noise) are treated
// as echo too. Expired phrases are pruned here.
//
// Matching, in increasing risk:
//   - exact:  the segment IS the phrase.
//   - prefix: the segment is a leading (sub-word) slice of the phrase — the
//             recognizer's interim results build up as a growing prefix ("give",
//             "give me", "give me a", …) of what we're saying.
//   - slice:  the segment fuzzily matches a CONTIGUOUS run of tokens ANYWHERE in
//             the phrase — a suffix or middle slice of our playback, tolerant of a
//             mis-heard word ("still"→"steel"). This catches the partial/lagged
//             echoes exact/prefix missed (Ken, July 13 2026). Multi-word only.
//   - embed:  our phrase fuzzily appears inside a longer captured segment — the
//             recognizer merged our playback with adjacent noise. Multi-word only,
//             so a short common token can't swallow real partner speech.
function isEcho(transcript) {
    const now = Date.now();
    for (let i = activePhrases.length - 1; i >= 0; i--) {
        if (activePhrases[i].expires < now) activePhrases.splice(i, 1);
    }
    if (activePhrases.length === 0) return false;
    const t = normalizeForEcho(transcript);
    if (!t) return true;
    const segTokens = t.split(' ');
    const multiWord = segTokens.length >= 2;
    return activePhrases.some(({ text: p, tokens: pTokens }) => {
        if (p === t) return true;                                       // exact
        if (p.startsWith(t)) return true;                              // interim prefix
        if (multiWord && fuzzySlice(pTokens, segTokens)) return true;  // echo is a slice of our phrase
        if (pTokens.length >= 2 && fuzzySlice(segTokens, pTokens)) return true; // our phrase inside a longer segment
        return false;
    });
}

/*
 * THE SHARED CORE — every backend feeds transcript text through these two, and
 * everything the conversation loop depends on lives here rather than in a backend:
 * accumulation into segments, the TTS-echo filter, the silence checkpoint that
 * fires generation, and the partner-resumed signal that cancels a placeholder.
 *
 * That placement is deliberate. The user's silence period is a setting, "Ask them
 * to repeat" drops the last segment, and interrupting a partner captures whatever
 * has been heard so far — none of which may behave differently because the audio
 * arrived from Deepgram rather than from the browser. A backend supplies text and
 * nothing else.
 *
 * `ingest` returns whether genuine (non-echo) partner content was heard.
 */
function ingest(transcript, isFinal) {
    // Drop our own TTS echo (a placeholder/response/prompt) — it must not
    // accumulate or renew the partner's turn. Only unique partner content gets through.
    if (isEcho(transcript)) return false;
    if (isFinal) {
        segments.push(transcript);              // boundaries, so Pardon drops just the last one
        accumulatedText = joinParts(segments);  // single spaces between segments
        currentInterim = '';
    } else {
        currentInterim = transcript;
    }
    return true;
}

function afterIngest(heardPartner) {
    // Only renew the partner's turn (reset the silence checkpoint) when genuine
    // partner content was heard AND the app isn't currently speaking. Pure echo
    // leaves the checkpoint alone (content filter), and any audio captured while we
    // speak — including mis-transcribed echo the filter missed — must not renew the
    // turn either (trigger-level loop guard).
    if (heardPartner && !speechActive()) {
        // Genuine partner speech: restart the silence checkpoint AND tell the app
        // the partner is talking again. If the partner resumes after a pause that
        // already fired a checkpoint, the app cancels the pending placeholder so it
        // doesn't speak over the partner (Ken, July 2026).
        resetSilenceTimer();
        if (onPartnerActivity) onPartnerActivity();
    }
    if (onTranscript) onTranscript(joinParts([accumulatedText, currentInterim]));
}

/*
 * `opts.source` selects the backend:
 *   omitted / 'builtin' — the browser's own recognizer (free; the Windows path,
 *                         and the only one that costs nothing).
 *   'deepgram'          — a paid streaming service via the user's own key, for the
 *                         platforms where the built-in one silently delivers
 *                         nothing. `opts.getDeepgramKey` reads the key at start
 *                         time so pasting one into Settings takes effect without a
 *                         reload.
 *
 * Falls back to the built-in recognizer if a paid backend is asked for but cannot
 * be constructed — an app that can hear is better than one that refuses to try.
 */
export function init({ onResult, onSilence, onStatus, onPartnerSpeech, source, getDeepgramKey, onBilled }) {
    onTranscript = onResult;
    onSilencePeriod = onSilence;
    onStatusChange = onStatus;
    onPartnerActivity = onPartnerSpeech;

    if (source === 'deepgram') {
        externalSource = deepgram.createSource({
            getKey: getDeepgramKey || (() => ''),
            onText: (text, isFinal) => { afterIngest(ingest(text, isFinal)); },
            onStatus: (status, detail) => {
                if (status === 'error') handleSourceError(detail);
                else if (onStatusChange) onStatusChange(status);
            },
            onBilled,
        });
        return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    // Per-platform tuning (platform.js). On iPadOS continuous mode measured 2.4s
    // slower to a first result than non-continuous, and this app exists to beat the
    // ~4s awkward-silence threshold — so there it runs non-continuous and leans on
    // the restart-on-end loop below, which was already the shape of this code.
    speechCfg = platform.speechConfig();
    recognition.continuous = speechCfg.continuous;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
        let heardPartner = false;   // any non-echo content this event?
        for (let i = event.resultIndex; i < event.results.length; i++) {
            if (ingest(event.results[i][0].transcript, event.results[i].isFinal)) heardPartner = true;
        }
        afterIngest(heardPartner);
    };

    recognition.onend = () => {
        // A silence period no longer ends recording. While the user still
        // intends to listen, the browser may stop continuous recognition on
        // its own (e.g. after a pause) — restart it so the partner's floor
        // stays open across silences. accumulatedText persists across restarts.
        // While suspended for backgrounding, do NOT restart: the visibility guard
        // owns the restart and will do it when the page comes back.
        if (listeningIntent && !suspendedForHidden) {
            // currentInterim holds words the recognizer has NOT finalized yet.
            // Ending the session discards them and the restarted session does not
            // re-hear audio already spoken — so an interim shown live but not yet
            // final vanishes on restart. If the user then interrupts right after,
            // those words are lost from the captured turn (Ken, July 12 2026:
            // partner said ~10 words, all shown live, but only the one finalized
            // segment "I was" was recorded on interrupt). Flush the pending interim
            // into accumulatedText before restarting so it's retained. No
            // duplication: the fresh session only transcribes audio from now on.
            if (currentInterim.trim()) {
                segments.push(currentInterim);
                accumulatedText = joinParts(segments);
            }
            currentInterim = '';
            // A short beat before restarting where the platform needs it: with
            // continuous off, sessions end constantly by design, and restarting
            // synchronously into an immediately-ending session spins a tight loop.
            if (speechCfg.restartDelayMs > 0) {
                setTimeout(() => {
                    if (!listeningIntent) return;      // stopped while we waited
                    try { recognition.start(); } catch { /* already starting */ }
                }, speechCfg.restartDelayMs);
            } else {
                try { recognition.start(); } catch { /* already starting */ }
            }
            return;
        }
        clearSilenceTimer();
        if (onStatusChange) onStatusChange('stopped');
    };

    // iOS stops recognition when the page is backgrounded WITHOUT telling the app,
    // which would otherwise leave it showing a live microphone and silently
    // hearing nothing. Suspend deliberately on hide and resume on return, keeping
    // listeningIntent intact across the gap so the user's intent is not lost.
    // (If more benign per-restart errors turn up during device testing, the
    // onerror allow-list below is where they belong — 'no-speech' and 'aborted'
    // are already ignored, which covers normal session teardown.)
    if (speechCfg.guardVisibility && typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
            if (!recognition) return;
            if (document.hidden) {
                if (listeningIntent && !suspendedForHidden) {
                    suspendedForHidden = true;
                    try { recognition.stop(); } catch { /* not running */ }
                }
            } else if (suspendedForHidden) {
                suspendedForHidden = false;
                if (listeningIntent) {
                    try { recognition.start(); } catch { /* already started */ }
                }
            }
        });
    }

    recognition.onerror = (event) => {
        if (event.error === 'no-speech' || event.error === 'aborted') return;
        // A surfaced error (network / not-allowed / service-not-allowed /
        // audio-capture) is fatal for this session — see handleSourceError. Without
        // clearing the intent, onend would restart straight into the same error.
        handleSourceError(event.error);
    };
}

function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(fireSilenceCheckpoint, silenceThreshold);
}

function fireSilenceCheckpoint() {
    // The partner has gone quiet for the silence period. Hand the speech
    // collected so far to the app for response generation, but keep recording —
    // if the partner resumes, the next silence period will fire again with the
    // combined speech. Never fire while the app is speaking (or within the echo
    // tail): our own playback could otherwise drive a checkpoint. Re-check soon.
    if (speechActive()) {
        silenceTimer = setTimeout(fireSilenceCheckpoint, 200);
        return;
    }
    const text = joinParts([accumulatedText, currentInterim]);
    if (text && onSilencePeriod) onSilencePeriod(text);
}

function clearSilenceTimer() {
    if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
    }
}

// A surfaced error is fatal for this listening session whichever backend produced
// it: clear the intent so nothing restarts into the same failure (a tight loop when
// offline, since both backends are network services). The user re-taps to try again.
function handleSourceError(detail) {
    listeningIntent = false;
    if (onStatusChange) onStatusChange('error', detail);
}

export function startListening() {
    if (!recognition && !externalSource) return;
    accumulatedText = '';
    segments = [];
    currentInterim = '';
    listeningIntent = true;
    suspendedForHidden = false;   // a fresh start clears any backgrounded state
    if (externalSource) {
        // Async: the paid backend needs microphone permission and a socket. Its own
        // status callback reports 'listening' once it is actually up, so the button
        // does not claim to be listening before anything can be heard.
        externalSource.start();
        return;
    }
    try { recognition.start(); } catch { /* already started */ }
    if (onStatusChange) onStatusChange('listening');
}

export function stopListening() {
    if (!recognition && !externalSource) return;
    listeningIntent = false;
    suspendedForHidden = false;   // a deliberate stop outranks a backgrounded suspend
    clearSilenceTimer();
    if (externalSource) return externalSource.stop();
    recognition.stop();
}

// The partner's speech heard so far this listening session — the finalized
// segments plus the in-progress interim. Lets the app capture what the partner
// had said the instant the user interrupts them (before a silence checkpoint has
// pushed it to the app), so an interruption doesn't lose their partial speech (Ken).
export function getCurrentTranscript() {
    return joinParts([accumulatedText, currentInterim]);
}

// Discard the speech collected so far without stopping recording. Used when the
// user asks the partner to repeat — the current exchange's text is thrown away
// and the system keeps listening for the partner's restated utterance.
export function resetTranscript() {
    accumulatedText = '';
    segments = [];
    currentInterim = '';
    clearSilenceTimer();
}

// Discard only the partner's most recent statement (the last finalized segment
// plus any in-progress interim), keeping earlier statements in the same turn.
// Used by Pardon? when only the last thing the partner said was garbled — the
// good earlier sentences shouldn't be thrown away. A "statement" is one final
// recognition result (≈ one utterance separated by a pause); if the recognizer
// split one sentence across results this drops only the last piece. Returns the
// remaining accumulated text. The silence timer is cleared so the dropped
// fragment can't fire a checkpoint; recording continues.
export function dropLastStatement() {
    currentInterim = '';
    if (segments.length) segments.pop();
    accumulatedText = joinParts(segments);
    clearSilenceTimer();
    return accumulatedText;
}
