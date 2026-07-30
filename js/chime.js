// Start-of-listening chime — a short synthesized tone played on the transition
// INTO microphone capture, so a communication partner (who faces the user, not
// the screen) gets an audible cue that listening has begun. This is the reliable
// partner-reachable half of the recording-indicator work (Ken, July 18 2026):
// the tablet screen faces the user, so an on-screen indicator only reaches the
// partner on a glance — sound is omnidirectional.
//
// Design constraints:
//   - Synthesized via Web Audio (no audio file) so it works offline / on
//     locked-down networks, like the rest of the app.
//   - NOT continuous — it fires once per capture start (the false→true transition
//     in ui.setListenButtonState), never on the recognizer's mid-session restarts.
//   - User-toggleable (Settings → Conversation), default on. The enabled flag is
//     pushed in from app.js (chime.setEnabled) so this module needs no storage
//     dependency.
//   - Never blocks or throws into the capture path: any audio failure is swallowed.

let enabled = true;
let ctx = null;

// Once-per-conversation mode, driven by the "resume listening automatically"
// setting (Ken, July 27 2026). With auto-resume ON the mic restarts after every
// single exchange, so chiming each time turns a disclosure into a metronome — the
// partner has already been told. Listening is effectively continuous for the whole
// conversation, so the cue belongs at the START of it and nowhere else. With
// auto-resume OFF each start is a deliberate, discrete listening episode, so every
// one still chimes.
let oncePerConversation = false;
let playedThisConversation = false;

export function setEnabled(on) { enabled = !!on; }
export function isEnabled() { return enabled; }
export function setOncePerConversation(on) { oncePerConversation = !!on; }

// Called when a conversation starts or ends, so the next one chimes again.
export function resetConversation() { playedThisConversation = false; }

// Play the "now listening" cue: two short ascending notes — friendly and
// unmistakable, distinct from the app's TTS. Called on capture start.
// Returns whether the cue was ALLOWED to sound (the policy decision), so the
// gating is testable without a speaker — the audio itself is best-effort and its
// failure is deliberately invisible.
export function playListenChime() {
    if (!enabled) return false;
    if (oncePerConversation && playedThisConversation) return false;
    playedThisConversation = true;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return true;   // policy allowed it; this device has no audio
        ctx = ctx || new AudioCtx();
        // NEVER schedule into a context that isn't running. WebKit starts a context
        // suspended unless it was created during a user gesture, and this call is
        // NOT one: it comes from the recognizer's async 'start' event, which fires
        // after the microphone permission round-trip, long past the tap. Notes
        // scheduled onto a suspended context are not dropped — they are queued and
        // sound the moment the context resumes, which on WebKit is the user's NEXT
        // gesture. That is how the listening chime came out of the "End
        // conversation" button on an iPad (Ken, July 30 2026). Ask for a resume so
        // the next chime works, but stay silent now rather than firing a tone
        // attached to an unrelated button press. unlock() below is what normally
        // makes the context running before any of this.
        if (ctx.state !== 'running') {
            ctx.resume().catch(() => { /* needs a gesture — unlock() supplies one */ });
            return true;
        }
        const t = ctx.currentTime;
        playNote(t,        660, 0.20);  // E5
        playNote(t + 0.17, 880, 0.26);  // A5
    } catch { /* audio unavailable — silent, never blocks capture */ }
    return true;
}

// Bring the audio context up while a real user gesture is in hand, so the chime
// can sound later from the recognizer's async start event (see above). Called
// from the Start button and the Listen button — both genuine taps. Safe and
// cheap to call repeatedly; a no-op once the context is running.
export function unlock() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        ctx = ctx || new AudioCtx();
        if (ctx.state !== 'running') ctx.resume().catch(() => { /* best-effort */ });
    } catch { /* audio unavailable */ }
}

// Peak level of each note (0–1 full scale). Deliberately loud: this is a
// partner-awareness cue that must be clearly audible across a room over ambient
// noise, on a small tablet speaker that isn't at full volume. The two notes
// barely overlap, so per-note peak near this stays below clipping. Bump this if
// it's still too quiet in the field.
const PEAK = 0.7;

function playNote(start, freq, dur) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Triangle carries better than a pure sine through small tablet speakers
    // (a little more harmonic content) while staying a soft, pleasant tone.
    osc.type = 'triangle';
    osc.frequency.value = freq;
    // Quick attack → short hold near peak → exponential release. The hold makes
    // the note read louder than a fast blip of the same peak (perceived loudness
    // tracks duration-at-level), without a click.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(PEAK, start + 0.02);
    gain.gain.setValueAtTime(PEAK, start + Math.max(0.03, dur - 0.07));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + dur + 0.02);
}
