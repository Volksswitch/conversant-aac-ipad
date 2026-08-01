import * as aura from './tts-deepgram.js';

const synth = window.speechSynthesis;
let selectedVoiceURI = null;

// --- Voice provider (Ken, July 31 2026) ---
//
// Two backends behind ONE seam, on the same reasoning as stt.js: the browser's own
// speechSynthesis (free, works everywhere, the default), and Deepgram Aura (the
// user's own key) for platforms whose built-in voices are unusable — measured on
// iPadOS, where the only ordinary en-US voice is Samantha and everything else is a
// novelty voice or a one-per-language minimum-quality voice.
//
// EVERYTHING THAT MATTERS STAYS IN THIS FILE, not in the backend: the speaking-state
// broadcast that the STT echo filter depends on, the token that stops a superseded
// utterance reporting a spurious end, and the fallback. A backend only produces
// sound.
let provider = 'builtin';
let auraModel = aura.DEFAULT_VOICE;
let auraVoice = null;
// Reported when the paid voice fails and the browser voice speaks instead. The app
// wires this to the error log, so a silent downgrade is still visible afterwards.
let onFallback = null;

// Held at module scope rather than captured when the voice is built: the backend is
// created ONCE and reused, so wiring these in at creation time would silently pin
// the first key source forever and a later setProvider() call would appear to do
// nothing. The voice reads through these on every utterance instead.
let auraGetKey = () => '';
let auraOnBilled = () => {};

export function setProvider(name, opts = {}) {
    provider = name === 'deepgram' ? 'deepgram' : 'builtin';
    if (opts.model) auraModel = opts.model;
    if (opts.getKey) auraGetKey = opts.getKey;
    if (opts.onBilled) auraOnBilled = opts.onBilled;
    if (provider === 'deepgram' && !auraVoice) {
        auraVoice = aura.createVoice({
            getKey: () => auraGetKey(),
            onBilled: (n) => auraOnBilled(n),
        });
    }
}

export function getProvider() {
    return provider;
}

export function setAuraModel(model) {
    if (model) auraModel = model;
}

export function getAuraModel() {
    return auraModel;
}

export function onFallbackToBrowser(cb) {
    onFallback = cb;
}

// iOS will not start audio outside a user gesture, and placeholders fire on timers,
// so the audio path has to be unlocked during some earlier tap or the app goes
// silent exactly when it is trying to hold the floor. Safe to call on any tap.
export function unlockAudio() {
    if (auraVoice) auraVoice.unlock();
}

export function testAuraVoice(key, model, phrase = 'This is how I will sound during our conversation.') {
    if (!auraVoice) {
        auraVoice = aura.createVoice({ getKey: () => key });
    }
    return auraVoice.test(key, model, phrase);
}

// Speaking-state broadcast. Anything that needs to know when the app is
// producing audio subscribes here — notably the STT layer, which uses the
// spoken text to recognize and discard its own TTS echo (placeholder tokens, the
// spoken response, prompts) so our own speech isn't mistaken for the partner
// and doesn't renew the partner's turn. Listeners get (speaking, text): text
// is the phrase on a start, null on an end. A monotonic token guards against a
// superseded utterance's late onend/onerror reporting a spurious end while a
// newer utterance is still going.
let speaking = false;
let speakToken = 0;
const speakingListeners = [];

function notifySpeaking(text) {
    speakingListeners.forEach(cb => cb(speaking, text));
}

export function isSpeaking() {
    return speaking;
}

export function onSpeakingChange(callback) {
    speakingListeners.push(callback);
}

export function setVoice(voiceURI) {
    selectedVoiceURI = voiceURI;
}

export function getSelectedVoiceURI() {
    return selectedVoiceURI;
}

function findVoice(voiceURI) {
    const uri = voiceURI || selectedVoiceURI;
    if (!uri) return null;
    return synth.getVoices().find(v => v.voiceURI === uri) || null;
}

// The browser's own voice. Kept as its own function because it is BOTH one of the
// two providers and the fallback for the other one.
function speakBuiltin(text, opts, myToken) {
    return new Promise((resolve) => {
        if (synth.speaking) synth.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = findVoice(opts.voiceURI);
        if (voice) utterance.voice = voice;
        const finish = () => {
            // Only report the end if no newer speak()/cancel() superseded this
            // utterance — otherwise we'd report "not speaking" mid-utterance.
            if (myToken === speakToken && speaking) {
                speaking = false;
                notifySpeaking(null);
            }
            resolve();
        };
        utterance.onend = finish;
        utterance.onerror = finish;
        synth.speak(utterance);
    });
}

/*
 * speak(text, opts). opts.voiceURI overrides the user's selected browser voice for
 * this utterance; opts.auraModel does the same for the paid voice. Practice Mode
 * passes both, so the AI partner sounds distinct from the user whichever provider
 * is in use.
 *
 * The speaking-state broadcast happens HERE, once, around whichever backend runs —
 * including a fallback. The STT echo filter uses that text to recognize and discard
 * the app's own speech, so a path that spoke without announcing itself would make
 * the app transcribe itself as the partner.
 */
export function speak(text, opts = {}) {
    const myToken = ++speakToken;
    // Announce the phrase on every start (even back-to-back placeholders) so the
    // STT echo filter always knows the current spoken text.
    speaking = true;
    notifySpeaking(text);

    if (provider !== 'deepgram' || !auraVoice) {
        return speakBuiltin(text, opts, myToken);
    }

    return auraVoice.speak(text, { model: opts.auraModel || auraModel })
        .then(() => {
            if (myToken === speakToken && speaking) {
                speaking = false;
                notifySpeaking(null);
            }
        })
        .catch((err) => {
            // Superseded or deliberately cancelled: cancel() has already reported
            // the end, and falling back would speak something the user stopped.
            if (myToken !== speakToken) return;
            // The paid voice failed. Say it anyway with the browser's own voice —
            // the one outcome that is never acceptable is that the user pressed a
            // button and nothing was said.
            if (onFallback) onFallback(err && err.message ? err.message : String(err));
            return speakBuiltin(text, opts, myToken);
        });
}

export function cancel() {
    speakToken++; // invalidate any pending utterance's finish handler
    synth.cancel();
    if (auraVoice) auraVoice.cancel();
    if (speaking) {
        speaking = false;
        notifySpeaking(null);
    }
}

export function getVoices() {
    return synth.getVoices();
}

// --- Voice quality tier (Ken, July 31 2026) ---
//
// WHY: Apple's higher-quality downloadable voices carry the SAME `name` as their
// compact sibling — an Enhanced "Ava" and a compact "Ava" are distinguishable only
// by voiceURI (com.apple.voice.enhanced.en-US.Ava vs ...compact...). So a picker
// showing "name (lang)" lists two identical-looking entries and gives the user no
// way to tell which is which, or whether downloading a better voice changed
// anything at all. With 68 voices on an iPad that is a list you cannot navigate.
//
// This also answers a question we cannot answer from the desktop: the published
// record disagrees with itself about whether iOS exposes Enhanced/Premium voices
// to the Web Speech API at all. Labelling the tier makes it a thing you can SEE on
// the device rather than a claim to trust.
//
// The tier is parsed from the voiceURI (falling back to the name) because that is
// where every engine puts it:
//   Apple    com.apple.voice.{compact,enhanced,premium}.en-US.Ava
//   Edge     "Microsoft Ava Online (Natural) - English (United States)"
//   Google   "Google US English"  — no tier, correctly labelled with none
//
// Matching is word-boundaried so a name that merely contains a tier word as a
// substring cannot be mislabelled. A voice with no recognizable tier gets no
// label at all rather than a guess — on Windows that means the labels are exactly
// what they were before this existed.
const QUALITY_TIERS = [
    [/(^|[^a-z])premium([^a-z]|$)/i, 'Premium'],
    [/(^|[^a-z])enhanced([^a-z]|$)/i, 'Enhanced'],
    [/(^|[^a-z])natural([^a-z]|$)/i, 'Natural'],
    [/(^|[^a-z])neural([^a-z]|$)/i, 'Neural'],
    [/(^|[^a-z])compact([^a-z]|$)/i, 'Compact'],
];

export function voiceQuality(voice) {
    if (!voice) return '';
    const hay = `${voice.voiceURI || ''} ${voice.name || ''}`;
    for (const [pattern, label] of QUALITY_TIERS) {
        if (pattern.test(hay)) return label;
    }
    return '';
}

// The one label both voice pickers use, so they can never drift apart. The tier
// sits directly after the name because that is what disambiguates two otherwise
// identical entries, and the eye scans the name first.
//
// A tier already spelled out in the name is not repeated: Edge names its cloud
// voices "Microsoft Ava Online (Natural) - English (United States)", which would
// otherwise render as "…(Natural) — Natural". Apple's names never carry the tier,
// which is the whole problem, so they always get the suffix.
export function voiceLabel(voice) {
    const quality = voiceQuality(voice);
    const nameCarriesIt = quality &&
        new RegExp(`(^|[^a-z])${quality}([^a-z]|$)`, 'i').test(voice.name || '');
    return quality && !nameCarriesIt
        ? `${voice.name} — ${quality} (${voice.lang})`
        : `${voice.name} (${voice.lang})`;
}

export function onVoicesReady(callback) {
    const voices = synth.getVoices();
    if (voices.length > 0) {
        callback(voices);
    }
    synth.onvoiceschanged = () => callback(synth.getVoices());
}
