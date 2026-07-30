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

export function onVoicesReady(callback) {
    const voices = synth.getVoices();
    if (voices.length > 0) {
        callback(voices);
    }
    synth.onvoiceschanged = () => callback(synth.getVoices());
}
