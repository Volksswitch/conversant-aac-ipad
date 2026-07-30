/* Conversation-loop decision logic — the pure predicates app.js's generateOptions
 * uses to decide what to do with an ingested engine snapshot, extracted so they can
 * be unit-tested without the DOM/async orchestration around them (this is the layer
 * where the July 2026 user-started silent stall actually surfaced). No DOM, no
 * network, no side effects — app.js keeps the effects (logging, rendering, speech).
 */
import { MODE } from './engine.js';

// Which partner actions get the QUESTION-flavored acknowledgment ("Good question.")
// vs. the neutral one ("Let me see.") — only the flavor of the FIRST placeholder
// differs; every complete turn still gets one.
export const QUESTION_ACTIONS = new Set(['QUESTION', 'INVITATION', 'REQUEST']);

// A placeholder plays on every partner turn — a social-presence signal that the user
// heard and is formulating a reply. It fires initialDelay seconds after the PAUSE and
// is aborted if the partner resumes (app.js handlePartnerResumed), so it doesn't need
// a "turn complete" judgment (Ken, July 10 2026). The ONE exception is a
// repair-initiator ("What?"/"Huh?"): that's the instant repair-of-self flow, where a
// "let me think" beat before re-speaking the same thing reads wrong.
export function shouldPlayPlaceholder(snap) {
    const c = snap.lastClassification;
    if (!c) return false;
    if (c.is_repair_initiator) return false;
    return true;
}

// Whether the first placeholder should use the question-flavored acknowledgment.
export function isQuestionFlavored(snap) {
    const c = snap.lastClassification;
    return !!(c && QUESTION_ACTIONS.has(c.partner_action));
}

// --- Fast-path closing detection (Ken, July 2026) ---------------------------
//
// When the user is winding down and the partner replies with a plain farewell,
// re-offer the goodbyes IMMEDIATELY without an AI round-trip. The AI would have
// classified the reply CLOSING and we'd have discarded its generated responses
// for the static closer list anyway, so the round-trip only adds latency — and
// here SPEED (letting the user speak another closing sooner) matters more than
// the token saving.
//
// FIELD-FEEDBACK NOTE / DECISION: this is a deliberately dumb keyword+length
// heuristic, applied ONLY while winding down (see app.js generateOptions'
// pre-closing guard). It is biased toward PRECISION, because the two error modes
// are asymmetric:
//   - A MISS (a real farewell we don't recognize, e.g. an unusual phrasing or a
//     reply longer than MAX_CLOSING_WORDS) simply falls through to the normal AI
//     path — same behavior as before, no harm, just no time saved.
//   - A FALSE POSITIVE (we treat a NON-farewell as a goodbye) would show closings
//     when the partner actually REOPENED the conversation. That's the annoying
//     case, so the patterns require a clear farewell token in a short reply, and
//     ambiguous bare words ("later", "night") are intentionally excluded.
// If the field reports either (goodbyes that still lag, or closings appearing when
// the partner kept talking), tune MAX_CLOSING_WORDS / FAREWELL_PATTERNS here — or
// remove the fast path entirely to always defer to the AI classification.
const FAREWELL_PATTERNS = [
    /\bbye\b/, /\bgoodbye\b/, /\bgood bye\b/, /\bbye bye\b/, /\bcya\b/, /\bttyl\b/,
    /\bfarewell\b/, /\bso long\b/, /\bpeace out\b/,
    /\bsee (you|ya|u)\b/, /\btake care\b/, /\btake it easy\b/,
    /\bgood ?night\b/,
    /\btalk (to you )?(soon|later)\b/, /\bcatch you later\b/,
    /\bhave a (good|great|nice) (one|day|night|evening|weekend|rest|time)\b/,
    /\b(gotta|got to|have to|need to|should|must) (get )?go(ing)?\b/,
    /\bi('m| am) off\b/,
    /\buntil next time\b/,
    /\byou too\b/,
    /\b(nice|good|great) (talking|seeing|chatting)\b/,
];

const MAX_CLOSING_WORDS = 6;

// Does this partner reply read as a plain farewell? Normalizes to lowercase
// letters/digits/apostrophes, requires it to be short, and to contain one of the
// farewell patterns above. Pure and side-effect-free (unit-tested).
export function looksLikeClosing(text) {
    if (!text) return false;
    const norm = String(text).toLowerCase().replace(/[^a-z0-9\s']/g, ' ').replace(/\s+/g, ' ').trim();
    if (!norm) return false;
    if (norm.split(' ').length > MAX_CLOSING_WORDS) return false;
    return FAREWELL_PATTERNS.some((re) => re.test(norm));
}

/**
 * Decide whether an ingested snapshot represents a silent dead-end worth logging.
 * We always show a palette now (no turn_status suppression — Ken, July 10 2026), so
 * `respond` is always true; the one remaining anomaly is an EMPTY palette when the
 * model owed responses — it returned nothing usable, leaving the user with empty
 * cards. REPAIR_OF_SELF is exempt (its rephrase/expand cards are filled by a later
 * prefetch). Logging trips the transcript red-wash + errors.log. Pure: returns the
 * decision, performs no logging/rendering itself.
 */
export function generationOutcome(snap) {
    const c = snap.lastClassification;
    const emptyOwed = !snap.palette.length && snap.mode !== MODE.REPAIR_OF_SELF;
    const anomaly = emptyOwed
        ? { context: 'generateOptions', message: `no response options generated (action=${c && c.partner_action}, mode=${snap.mode})` }
        : null;
    return { respond: true, anomaly };
}
