/*
 * vad.js — decides when captured audio is worth sending to a paid transcription
 * service. Pure logic, no Web Audio: it takes a loudness level and a timestamp and
 * answers "should the upstream be open right now?".
 *
 * WHY THIS EXISTS — it is the difference between an affordable feature and an
 * unaffordable one. Deepgram bills per second of audio submitted, and this app
 * holds the microphone open for the whole conversation (auto-resume restarts it
 * after every exchange). Streaming that continuously means paying for every silent
 * minute of a visit: an hour of conversation costs the full hourly rate even if the
 * partner spoke for twelve minutes of it. Sending only the speech brings the bill
 * down to roughly what was actually said.
 *
 * The built-in browser recognizer needs none of this — it is free, so there is
 * nothing to save and no reason to risk clipping. This runs only for a paid
 * backend.
 *
 * THREE PROPERTIES THAT MATTER, and why each is here:
 *
 *   Hysteresis. One threshold would chatter: a voice hovering at the boundary
 *     would open and close the upstream many times a second, and every close/open
 *     risks losing a word at the seam. Speech must be LOUDER than `openLevel` to
 *     open the gate and QUIETER than `closeLevel` to shut it, with a gap between.
 *
 *   Hang time. Natural speech has gaps inside it — between words, and the beat
 *     before "…um". Closing on the first quiet frame would chop an utterance into
 *     fragments and hand the transcriber less context than it needs. The gate stays
 *     open for `hangMs` after the level drops.
 *
 *   Pre-roll. The gate can only open AFTER speech has already started, so the
 *     first syllable is always in the past. The caller keeps a short rolling buffer
 *     of recent audio and flushes it when the gate opens; `preRollMs` says how much
 *     to keep. Without it every utterance loses its opening consonant, which is
 *     exactly the part a transcriber needs to get the first word right.
 */

// Defaults are a starting point to be tuned on the device against a real room —
// the right numbers depend on the microphone and the ambient noise, and no amount
// of reasoning substitutes for listening to what gets clipped.
export const DEFAULTS = {
    openLevel: 0.020,    // RMS (0–1) above which we call it speech
    closeLevel: 0.012,   // …and below which we call it silence (hysteresis gap)
    hangMs: 900,         // keep sending this long after the level drops
    preRollMs: 400,      // audio kept before the gate opened, flushed on open
};

export function createGate(opts = {}) {
    const cfg = { ...DEFAULTS, ...opts };
    let open = false;
    let quietSince = null;      // when the level first dropped below closeLevel
    let openedAt = null;

    return {
        /*
         * Feed one measurement. `level` is RMS amplitude 0–1, `now` a millisecond
         * timestamp. Returns the transition so the caller can act on edges:
         *   'open'   — start sending (and flush the pre-roll buffer first)
         *   'close'  — stop sending
         *   null     — no change
         */
        push(level, now) {
            if (!open) {
                if (level >= cfg.openLevel) {
                    open = true;
                    openedAt = now;
                    quietSince = null;
                    return 'open';
                }
                return null;
            }
            // Open: only the quieter threshold can start the closing clock, and it
            // is reset by any frame back above it, so a gap between words does not
            // accumulate toward a close.
            if (level > cfg.closeLevel) {
                quietSince = null;
                return null;
            }
            if (quietSince === null) quietSince = now;
            if (now - quietSince >= cfg.hangMs) {
                open = false;
                quietSince = null;
                openedAt = null;
                return 'close';
            }
            return null;
        },

        isOpen() { return open; },
        openedAt() { return openedAt; },
        preRollMs() { return cfg.preRollMs; },
        config() { return { ...cfg }; },

        // Force shut — used when listening stops, so a gate left open cannot keep
        // an upstream alive (and billing) after the user has finished.
        reset() {
            const was = open;
            open = false;
            quietSince = null;
            openedAt = null;
            return was ? 'close' : null;
        },
    };
}

/*
 * RMS of one frame of PCM samples, 0–1. Separated from the gate so the gate can be
 * tested without generating audio, and so an AnalyserNode's byte-domain data can be
 * converted by the caller if that is what it has.
 */
export function rms(samples) {
    if (!samples || samples.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
}

/*
 * How much audio was actually sent, in seconds — what the bill is based on. The
 * caller accumulates open→close spans; this turns them into the figure a user
 * would recognize, so the cost of a conversation can be shown rather than guessed.
 */
export function billableSeconds(spans) {
    return (spans || []).reduce((total, s) => total + Math.max(0, (s.end - s.start) / 1000), 0);
}
