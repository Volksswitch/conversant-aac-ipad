import * as tts from './tts.js';
import * as storage from './storage.js';

/* Floor-holding placeholders — role-differentiated by position (Ken, June 18
 * 2026).
 *
 * Timing model (Ken, June 28 2026): the initial-delay clock starts when the
 * partner STOPS speaking (the silence checkpoint), not when the AI's options
 * arrive. arm() is called at the checkpoint to start that clock; start() is
 * called once the classification comes back AND the partner's action warrants a
 * placeholder (a question — the gating lives in app.js). start() then plays the first
 * placeholder as soon as the armed initial delay has elapsed — which may be
 * immediately if the AI round-trip was slow, so a long generation no longer
 * leaves dead air. A quick selection cancels everything via stop(). Holding the
 * utterance until classification keeps placeholders off statements/closings.
 *
 * Why role-differentiated: a small flat pool makes two sequential placeholders sound
 * stupid — "That's interesting." right after "Hmm, interesting." even when they
 * aren't the identical string (semantic clustering). The fix is structural: the
 * first and any later placeholder do DIFFERENT jobs, so a long window progresses
 * naturally instead of echoing:
 *   - acknowledgment  ("Good question.", "Let me see.")  — "I heard you, I'm on it"
 *   - thinking        ("Still thinking it through.")     — "still working on it"
 * The first placeholder is drawn from `acknowledgment`, every later one from
 * `thinking`. Combined with a CAP (Settings "Maximum placeholders per turn",
 * default 2) you hear at most one acknowledgment + one thinking placeholder — never
 * two same-category placeholders back to back. After the cap we go quiet; silence
 * after "Good question… still thinking it through" reads fine, and the user
 * still has the manual "Hold on" button.
 *
 * Phrases must stay neutral/reflective, never imperative or directed at the
 * partner ("Let me think", "Give me a second", "Hold on") — flat built-in voices
 * make those read as curt. The pools live in data/placeholders.json (an
 * { acknowledgment:{question:[],general:[]}, thinking:[] } object) and will become
 * user-editable later. start()/stop() keep the signature app.js calls.
 */

// Inline fallback if data/placeholders.json fails to load. The acknowledgment role
// has two sub-pools: `question` (warm, for a partner question) and `general`
// (neutral, for a greeting / statement / assessment / closing) — because a
// placeholder now plays after ANY partner turn (Ken, July 8 2026), and "Good
// question." after "Hi!" would read worse than silence.
const FALLBACK_POOLS = {
    acknowledgment: {
        question: ['Good question.', "That's a good question.", "That's a fair question."],
        general: ['Let me see.', 'One moment.', 'Just a second.'],
    },
    thinking: [
        'Still thinking it through.',
        "I'm working out what I want to say.",
        'Putting my thoughts together.',
        'Still mulling that over.',
    ],
};

let pools = null;            // { acknowledgment:{question:[],general:[]}, thinking:[] }
let timer = null;
let active = false;
let count = 0;               // placeholders spoken this window (for role + cap)
let lastIndex = { question: -1, general: -1, thinking: -1 };
let armTime = 0;             // when the partner stopped (initial-delay clock origin)
let armed = false;           // arm() was called and start() hasn't consumed it
let questionFlavor = false;  // pick question- vs general-flavored acknowledgment
// A gate the app sets so a placeholder never speaks OVER the user's own statement
// (a spoken command / response / Express phrase). Pressing a speaking button must
// abort placeholders instantly (Ken, July 2026) — this is the hard backstop even
// if a stray scheduled placeholder fires while the user's TTS is playing.
let userSpeaking = () => false;
export function setUserSpeakingGate(fn) { userSpeaking = typeof fn === 'function' ? fn : () => false; }

// Normalize to { acknowledgment:{question:[],general:[]}, thinking:[] }. Tolerates
// two legacy shapes: a flat array (used for all pools), and an object whose
// `acknowledgment` is a flat array (the pre-July-2026 shape — used for both
// question and general). Empty sub-pools are filled from the others so there is
// always something to say.
function normalizePools(data) {
    if (Array.isArray(data) && data.length) {
        return { acknowledgment: { question: data.slice(), general: data.slice() }, thinking: data.slice() };
    }
    if (data && typeof data === 'object') {
        const think = Array.isArray(data.thinking) ? data.thinking.slice() : [];
        const ack = data.acknowledgment;
        let question = [];
        let general = [];
        if (Array.isArray(ack)) { question = ack.slice(); general = ack.slice(); }
        else if (ack && typeof ack === 'object') {
            question = Array.isArray(ack.question) ? ack.question.slice() : [];
            general = Array.isArray(ack.general) ? ack.general.slice() : [];
        }
        if (!question.length) question = general.length ? general.slice() : think.slice();
        if (!general.length) general = question.length ? question.slice() : think.slice();
        if (question.length || general.length || think.length) {
            return { acknowledgment: { question, general }, thinking: think.length ? think : general.slice() };
        }
    }
    return null;
}

async function loadPools() {
    if (pools) return;
    try {
        const data = await fetch('data/placeholders.json').then(r => r.json());
        pools = normalizePools(data);
    } catch { /* fall back below */ }
    if (!pools) pools = normalizePools(FALLBACK_POOLS);
}

// Pick from a list, avoiding the immediately-previous phrase for that key.
function pick(list, key) {
    if (!list || !list.length) return null;
    if (list.length === 1) { lastIndex[key] = 0; return list[0]; }
    let index;
    do {
        index = Math.floor(Math.random() * list.length);
    } while (index === lastIndex[key]);
    lastIndex[key] = index;
    return list[index];
}

// Called at the silence checkpoint (partner stopped). Starts the initial-delay
// clock and resets per-window state, but speaks nothing yet — start() decides
// whether this window warrants placeholders once the classification is known.
export function arm() {
    if (timer) { clearTimeout(timer); timer = null; }
    active = false;
    armed = true;
    armTime = Date.now();
    count = 0;
    lastIndex = { question: -1, general: -1, thinking: -1 };
    loadPools().catch(() => { /* fallback handled in loadPools */ });
}

// `opts.question` selects the QUESTION-flavored acknowledgment ("Good question.")
// vs. the neutral one ("Let me see.") for the first placeholder.
export async function start(opts = {}) {
    if (timer) { clearTimeout(timer); timer = null; }
    questionFlavor = !!opts.question;
    const { initialDelay, maxPlaceholders } = storage.loadPlaceholderSettings();
    // 0 = the user wants no placeholders at all (they read as artificial).
    if (maxPlaceholders === 0) { active = false; armed = false; return; }
    active = true;
    count = 0;
    lastIndex = { question: -1, general: -1, thinking: -1 };
    loadPools().catch(() => { /* fallback handled in loadPools */ });
    // The clock started at the partner's pause (arm()); if start() is reached
    // without an arm (defensive), measure from now. The first placeholder waits only
    // the remainder of initialDelay — so a slow AI round-trip that already ate
    // the delay plays the first placeholder immediately instead of leaving silence.
    const base = armed ? armTime : Date.now();
    armed = false;
    const firstDelay = Math.max(0, initialDelay * 1000 - (Date.now() - base));
    timer = setTimeout(speakNext, firstDelay);
}

export function stop() {
    active = false;
    armed = false;
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
    tts.cancel();
}

async function speakNext() {
    if (!active) return;
    if (!pools) {
        try { await loadPools(); } catch { /* ignore */ }
    }
    if (!active || !pools) return;
    // Never speak over the user's own statement (a spoken button). If one is
    // playing right now, try again after the normal interval rather than barging
    // in and cancelling it. No await between here and tts.speak below, so this one
    // check holds until we actually speak.
    if (userSpeaking()) { scheduleNext(); return; }
    // Role by position: first placeholder acknowledges (question- or general-flavored),
    // later ones say "still thinking".
    let phrase;
    if (count === 0) {
        const key = questionFlavor ? 'question' : 'general';
        phrase = pick(pools.acknowledgment[key], key);
    } else {
        phrase = pick(pools.thinking, 'thinking');
    }
    count++;
    if (phrase) await tts.speak(phrase);
    if (!active) return;
    // Cap: stop after maxPlaceholders placeholders. -1 = no limit (0 = none is
    // handled in start(), which never schedules a first placeholder).
    const { maxPlaceholders } = storage.loadPlaceholderSettings();
    if (maxPlaceholders >= 1 && count >= maxPlaceholders) return;
    scheduleNext();
}

function scheduleNext() {
    const { subsequentDelay } = storage.loadPlaceholderSettings();
    timer = setTimeout(speakNext, subsequentDelay * 1000);
}
