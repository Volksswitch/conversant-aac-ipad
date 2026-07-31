const synth = window.speechSynthesis;
let selectedVoiceURI = null;

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

// speak(text, opts). opts.voiceURI overrides the user's selected voice for this
// utterance — used by Practice Mode so the AI partner speaks in a DISTINCT voice
// from the user, making partner-vs-self clear aurally.
export function speak(text, opts = {}) {
    return new Promise((resolve) => {
        if (synth.speaking) synth.cancel();
        const myToken = ++speakToken;
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
        // Announce the phrase on every start (even back-to-back placeholders) so the
        // STT echo filter always knows the current spoken text.
        speaking = true;
        notifySpeaking(text);
        synth.speak(utterance);
    });
}

export function cancel() {
    speakToken++; // invalidate any pending utterance's finish handler
    synth.cancel();
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
