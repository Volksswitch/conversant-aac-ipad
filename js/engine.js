/* Conversation Engine — the CA (Conversation Analysis) core.
 *
 * Implements Conversation-Engine-Design.docx: a sequence stack (what is
 * currently "owed"), five conversational modes, and a typed, prioritized response
 * palette. This module knows CA structure ONLY — never the UI, the access
 * method, or how anything is drawn (design §2, strict one-way knowledge). It
 * ingests the LLM's combined classify+generate result, updates state, and emits
 * a palette descriptor + an inspectable snapshot. The Presentation Layer (for
 * now the degenerate diagnostic renderer) consumes the snapshot.
 *
 * Phasing (design §10, "Phase 1 refinements"): RESPONDING four-slot palette,
 * REPAIR-OF-SELF, INITIATING, PRE-CLOSING/CLOSING, the sequence stack, and the
 * persistent overrides all ship here. CONTINUING is reserved in the classifier
 * schema (design §8) but treated as INCOMPLETE for now — no continuer palette.
 */

// --- Modes (design §5) ---
export const MODE = {
    LISTENING: 'LISTENING',           // partner speaking; no TRP yet
    RESPONDING: 'RESPONDING',         // TRP detected; partner action is an FPP
    REPAIR_OF_SELF: 'REPAIR_OF_SELF', // partner repaired the USER's turn ("What?")
    INITIATING: 'INITIATING',         // user opens, or conversation idle
    PRE_CLOSING_CLOSING: 'PRE_CLOSING_CLOSING',
};

// --- Floor (who currently holds the turn). A separate dimension from `mode`:
// `mode` is what the SYSTEM is doing, `floor` is whose turn it is. LISTENING is
// the system's receptive posture, which spans both floor=PARTNER (partner
// mid-utterance) and floor=OPEN (at rest, nobody producing a turn) — so floor
// can't be read off the mode. The user can always seize the floor via the
// persistent overrides, so PARTNER is a default expectation, not an exclusive
// lock. See the mode-vs-floor note in CLAUDE.md. ---
export const FLOOR = {
    OPEN: 'open',       // at rest / between turns — floor up for grabs
    PARTNER: 'partner', // partner is producing (or owed the next) turn
    SELF: 'self',       // it is the user's turn to act
};

// --- Response slots (design §4). Ordinal position is stable across modes so the
// user gets motor automaticity (preferred always first, repair always last). ---
export const SLOT = {
    PREFERRED: 'PREFERRED',
    DISPREFERRED: 'DISPREFERRED',
    INITIATIVE: 'INITIATIVE',
    REPAIR: 'REPAIR',
    // Closed-set (alternative-question) turns: the partner offered an explicit menu
    // ("mild, moderate, or severe?"), so the meaningful axis is WHICH OPTION, not the
    // four structural moves — four takes on one alternative silently strips away the
    // choices the partner offered (Ken, July 2026). CHOICE = one offered alternative;
    // CHOICE_OTHER = the escape hatch for an answer that isn't in the set. These are
    // their own slot family so the renderer lays them out one-per-cell rather than
    // grouping by the four categories.
    CHOICE: 'CHOICE',
    // Fillers for the cells a short offered set leaves free — a two-way question
    // leaves two, and an empty cell is something the user can't say. In usefulness
    // order: an answer outside the set, a question back, ask them to repeat the
    // choices. Same family as CHOICE (never the structural slots) so the renderer
    // keeps laying the whole palette out one-per-cell.
    CHOICE_OTHER: 'CHOICE_OTHER',
    CHOICE_ASK: 'CHOICE_ASK',
    CHOICE_REPAIR: 'CHOICE_REPAIR',
    // Repair-of-self operations on the user's own last utterance (design §7.2).
    REPAIR_RESPEAK: 'REPAIR_RESPEAK',
    REPAIR_REPHRASE: 'REPAIR_REPHRASE',
    REPAIR_EXPAND: 'REPAIR_EXPAND',
    // Conversation-level openers / wind-downs / closings (static for Phase 1;
    // configurable later). WIND_DOWN = "I'm ready to wrap up" (no goodbye yet);
    // CLOSING = the actual goodbye, offered after a wind-down.
    OPENER: 'OPENER',
    WIND_DOWN: 'WIND_DOWN',
    CLOSING: 'CLOSING',
    // Declining the partner's closing — "Actually, before you go —". A pre-closing
    // is an OFFER to end, and CA makes declining it relevant at exactly that
    // moment; without this the user can only say goodbye. Offered only when the
    // PARTNER initiated the closing, never when the user is winding down.
    CLOSING_DECLINE: 'CLOSING_DECLINE',
};

const SLOT_PRIORITY = {
    PREFERRED: 1, DISPREFERRED: 2, INITIATIVE: 3, REPAIR: 4,
    REPAIR_RESPEAK: 1, REPAIR_REPHRASE: 2, REPAIR_EXPAND: 3,
    OPENER: 1, WIND_DOWN: 1, CLOSING: 1, CLOSING_DECLINE: 2,
    // Every CHOICE shares one priority so the stable sort preserves the order the
    // partner offered them in; the fillers follow in usefulness order. Two
    // CHOICE_OTHERs may appear (e.g. "about the same" AND "it comes and goes"),
    // and the stable sort keeps them in the order the model ranked them.
    CHOICE: 1, CHOICE_OTHER: 5, CHOICE_ASK: 6, CHOICE_REPAIR: 7,
};

// Static Phase-1 palettes for the modes that don't need an LLM round-trip. These
// are user-owned lists now (control-phrases.js); app.js injects the edited set via
// setConversationPhrases(). The inline defaults below mirror control-phrases.js
// DEFAULTS so the engine still works standalone (tests) before any injection.
// Openers are templates: {name} is replaced with the active Partner's name and
// dropped (with tidy punctuation) when no Partner is active — see applyName.
const DEFAULT_OPENERS = [
    'Hi {name}, got a minute?',
    'Can I ask you something, {name}?',
    'Guess what, {name}.',
    'Hey {name}, how are you doing?',
    'Good to see you, {name}.',
    'How have you been, {name}?',
    "What's new with you, {name}?",
    'I was just thinking about you, {name}.',
    'Got a story for you, {name}.',
];
const DEFAULT_WIND_DOWNS = [
    'I should get going.',
    'I need to head out.',
    'This was really nice, thanks.',
    'Great catching up with you.',
    'Anyway, I should let you go.',
    "It's been good seeing you.",
    'I should probably wrap up.',
    "I've got to run soon.",
];
const DEFAULT_CLOSINGS = [
    'Bye!',
    'Take care!',
    'See you later!',
    "Let's talk again soon.",
    'Have a good day!',
    'Talk soon!',
    'Goodbye!',
    'Catch you later.',
];
let openers = DEFAULT_OPENERS.slice();
let windDowns = DEFAULT_WIND_DOWNS.slice();
let closings = DEFAULT_CLOSINGS.slice();

// Replace {name} with the active Partner's name; when there is no name, drop the
// token AND an adjacent comma, repairing spacing/punctuation so the opener still
// reads cleanly ("Hi {name}, got a minute?" → "Hi, got a minute?").
function applyName(template, name) {
    const n = (name || '').trim();
    if (n) return template.replace(/\{name\}/g, n).replace(/\s+/g, ' ').trim();
    return template
        .replace(/\s*,?\s*\{name\}\s*,?\s*/g, (m, offset, str) => {
            const before = str.slice(0, offset).trimEnd();
            const after = str.slice(offset + m.length).trimStart();
            // Name sat between two words → keep a comma; otherwise just close the gap.
            if (before && after && /[A-Za-z0-9]$/.test(before) && /^[A-Za-z0-9]/.test(after)) return ', ';
            return after && !/^[?.!,;:]/.test(after) ? ' ' : '';
        })
        .replace(/\s+([?.!,;:])/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();
}

// Inject the user's edited openers / wind-downs / closings (control-phrases.js).
// Empty/missing lists are ignored so the engine never ends up with no cards. A
// legacy caller may still pass `closers`; treat it as the wind-downs (the list the
// "Wind down" button historically showed) so nothing breaks mid-migration.
export function setConversationPhrases(p = {}) {
    if (Array.isArray(p.openers) && p.openers.length) openers = p.openers.slice();
    if (Array.isArray(p.windDowns) && p.windDowns.length) windDowns = p.windDowns.slice();
    else if (Array.isArray(p.closers) && p.closers.length) windDowns = p.closers.slice();
    if (Array.isArray(p.closings) && p.closings.length) closings = p.closings.slice();
}

// --- ConversationState (design §3) ---
const state = {
    sequenceStack: [],            // [{action, openedBy, utterance, sttConfidence}], innermost last
    register: 'ORDINARY',         // or INSTITUTIONAL(role)
    phase: 'BODY',                // OPENING | BODY | PRE_CLOSING | CLOSING
    lastUserUtterance: '',        // for repair of our own turn
    lastPartnerUtterance: { text: '', confidence: null },
    mode: MODE.LISTENING,
    floor: FLOOR.OPEN,            // whose turn it is — see FLOOR
    lastClassification: null,     // {partner_action, turn_status, is_repair_initiator} — inspectable
    palette: [],                  // current response descriptors
};

export function reset() {
    state.sequenceStack = [];
    state.register = 'ORDINARY';
    state.phase = 'BODY';
    state.lastUserUtterance = '';
    state.lastPartnerUtterance = { text: '', confidence: null };
    state.mode = MODE.LISTENING;
    state.floor = FLOOR.OPEN;
    state.lastClassification = null;
    state.palette = [];
}

// Snapshot for the renderer / diagnostics. Everything the degenerate UI shows.
export function getSnapshot() {
    return {
        mode: state.mode,
        floor: state.floor,
        phase: state.phase,
        register: state.register,
        sequenceStack: state.sequenceStack.map(s => ({ ...s })),
        lastClassification: state.lastClassification,
        lastUserUtterance: state.lastUserUtterance,
        lastPartnerUtterance: { ...state.lastPartnerUtterance },
        palette: state.palette.map(m => ({ ...m })),
    };
}

export function getMode() { return state.mode; }
export function getLastUserUtterance() { return state.lastUserUtterance; }

// Context block the engine hands the LLM (design §9.1). The app merges this
// with the worldview/relationship blocks before generating.
export function buildRequestContext() {
    // When the innermost open sequence was opened by the USER (an opener /
    // pre-question like "Can I ask you something?") and isn't a repair, the
    // partner's reply is an SPP to the user — so the user now holds the floor to
    // LEAD, and generation must produce "continue/lead" responses rather than
    // "answer the partner" responses. Surfaced explicitly so the model doesn't read
    // the partner's go-ahead as if the partner had asked the opener.
    const top = state.sequenceStack[state.sequenceStack.length - 1];
    const userHoldsFloorToLead = !!(top && top.openedBy === 'USER' && top.action !== 'REPAIR');
    return {
        stt_confidence: state.lastPartnerUtterance.confidence,
        sequence_stack: state.sequenceStack.map(s => ({ action: s.action, opened_by: s.openedBy, utterance: s.utterance })),
        register: state.register,
        phase: state.phase,
        last_user_utterance: state.lastUserUtterance,
        user_holds_floor_to_lead: userHoldsFloorToLead,
    };
}

// Record that the partner is mid-capture (used at each silence checkpoint).
export function partnerSpeaking(text, confidence = null) {
    state.lastPartnerUtterance = { text, confidence };
    state.floor = FLOOR.PARTNER;
    if (state.mode === MODE.LISTENING) state.palette = [];
}

// Ingest the combined classify+generate result (design §9.2) and update state.
// `result` = { classification:{partner_action,turn_status,is_repair_initiator}, responses:[...] }.
//
// We DO NOT gate on turn_status (Ken, July 10 2026 — deliberately reverses design §8's
// false-TRP guard): trying to detect when the partner is "done" from possibly-garbled
// STT is fragile and it's a hard problem even for humans, and it caused repeated
// silent stalls. Instead: every silence checkpoint produces AND shows a palette; the
// partner's turn is "complete" only when the USER responds or ends the conversation.
// turn_status is now informational only. `partner_action` and `is_repair_initiator`
// are still used ("what kind of action", far more robust than "are they done").
export function ingestClassification(result, partnerText) {
    const c = result.classification || {};
    state.lastClassification = {
        partner_action: c.partner_action || 'OTHER',
        turn_status: c.turn_status || 'COMPLETE',   // informational only
        is_repair_initiator: !!c.is_repair_initiator,
        // The closed set of alternatives the partner offered, [] for an ordinary
        // turn. The palette already carries them as CHOICE responses; keeping the
        // raw list on the state lets other surfaces offer them too.
        offered_options: Array.isArray(c.offered_options) ? c.offered_options : [],
    };
    state.lastPartnerUtterance = {
        text: partnerText,
        confidence: state.lastPartnerUtterance.confidence,
    };

    // Partner is asking the USER to repeat/clarify — do NOT generate fresh SPPs.
    // Switch to REPAIR-OF-SELF and offer operations on lastUserUtterance (§7.2).
    if (state.lastClassification.is_repair_initiator) {
        state.mode = MODE.REPAIR_OF_SELF;
        state.floor = FLOOR.SELF; // it's the user's turn to repeat their own utterance
        state.palette = repairSelfPalette();
        return getSnapshot();
    }

    // Resolve any open user REPAIR (Pardon?) sequences: the partner's re-speak pops
    // them, then re-activates the FPP beneath against the now-clarified utterance
    // (§3, §7.1). pardon() dedups, but clear any that arrived another way.
    let top = state.sequenceStack[state.sequenceStack.length - 1];
    while (top && top.action === 'REPAIR' && top.openedBy === 'USER') {
        state.sequenceStack.pop();
        top = state.sequenceStack[state.sequenceStack.length - 1];
    }

    if (top && top.openedBy === 'PARTNER') {
        // The partner still owns this FPP — either they re-spoke after a Pardon, or
        // (with turn_status no longer gating) this is a LATER pause refining the SAME
        // ongoing partner turn. Continuous capture re-ingests on every pause, and the
        // partner holds the floor until the user produces an SPP, so UPDATE the FPP in
        // place — never stack a duplicate per pause.
        top.action = state.lastClassification.partner_action;
        top.utterance = partnerText;
        top.sttConfidence = state.lastPartnerUtterance.confidence;
    } else if (top && top.openedBy === 'USER' && top.action !== 'REPAIR') {
        // The partner is RESPONDING to something the USER initiated — an opener or
        // pre-question ("Can I ask you something?" → "sure"). That reply is an SPP from
        // the partner, NOT a new FPP: it closes the user's opened sequence and hands
        // the floor back to the user to LEAD. Pop the user's FPP; push no partner FPP.
        state.sequenceStack.pop();
    } else {
        // A new partner turn (empty stack, or after the user's SPP popped the last
        // one) — push the partner's FPP as a newly-owed sequence.
        state.sequenceStack.push({
            action: state.lastClassification.partner_action,
            openedBy: 'PARTNER',
            utterance: partnerText,
            sttConfidence: state.lastPartnerUtterance.confidence,
        });
    }

    // The floor is now the user's to respond (they judge when to actually take it).
    state.floor = FLOOR.SELF;
    if (state.lastClassification.partner_action === 'CLOSING') {
        state.phase = 'PRE_CLOSING';
        state.mode = MODE.PRE_CLOSING_CLOSING;
        state.palette = closingPalette();
    } else {
        state.mode = MODE.RESPONDING;
        state.palette = paletteFromResponses(result.responses);
    }
    return getSnapshot();
}

// Convert the LLM's typed responses into prioritized palette descriptors. All
// pre-generated responses are instant to select (the text already exists); only
// REPAIR-OF-SELF rephrase/expand carry a round-trip (latency class, §2).
function paletteFromResponses(responses) {
    if (!Array.isArray(responses)) return [];
    return responses
        .filter(m => m && m.slot && typeof m.text === 'string' && m.text.trim())
        .map(m => ({
            slot: m.slot,
            text: m.text.trim(),
            hint: (m.hint || '').trim() || m.text.trim(),
            priority: SLOT_PRIORITY[m.slot] ?? 99,
            latency: 'instant',
            format: m.format || null,
            trigger: m.trigger || null,
        }))
        .sort((a, b) => a.priority - b.priority);
}

// Replace the current response palette WITHOUT touching the sequence stack, mode,
// or floor — used by "Show me different options" (regenerate). The partner's
// turn and the open obligation are unchanged; only the offered responses are
// refreshed, so we must NOT re-ingest the classification (that would push a
// duplicate FPP). Guards against being called when there's nothing to refresh.
export function refreshPalette(responses) {
    state.palette = paletteFromResponses(responses);
    return getSnapshot();
}

// Fill the pre-generated rephrase/expand wording into the current repair-of-self
// palette (Ken, July 8 2026), so those cards show real, immediately-speakable text
// instead of a hint. Only touches the REPAIR_REPHRASE/REPAIR_EXPAND entries; once
// their text is set they become instant (no post-tap round-trip). No-op for any
// other palette, or for a wording that came back empty.
export function setRepairOptions({ rephrase = '', expand = '' } = {}) {
    for (const entry of state.palette) {
        if (entry.op === 'rephrase' && rephrase) { entry.text = rephrase; entry.latency = 'instant'; }
        if (entry.op === 'expand' && expand) { entry.text = expand; entry.latency = 'instant'; }
    }
    return getSnapshot();
}

function repairSelfPalette() {
    return [
        { slot: SLOT.REPAIR_RESPEAK, op: 'respeak', text: state.lastUserUtterance || '',
          hint: 'Say it again', priority: 1, latency: 'instant' },
        { slot: SLOT.REPAIR_REPHRASE, op: 'rephrase', text: '', hint: 'Say it differently',
          priority: 2, latency: 'roundtrip' },
        { slot: SLOT.REPAIR_EXPAND, op: 'expand', text: '', hint: 'Explain it more',
          priority: 3, latency: 'roundtrip' },
    ];
}

function openerPalette(partnerName = '') {
    return openers.map((tpl, i) => {
        const text = applyName(tpl, partnerName);
        return { slot: SLOT.OPENER, text, hint: text, priority: i + 1, latency: 'instant' };
    });
}

function windDownPalette() {
    return windDowns.map((text, i) => ({
        slot: SLOT.WIND_DOWN, text, hint: text, priority: i + 1, latency: 'instant',
    }));
}

function closingPalette() {
    return closings.map((text, i) => ({
        slot: SLOT.CLOSING, text, hint: text, priority: i + 1, latency: 'instant',
    }));
}

// --- User actions on the palette ---

// A normal RESPONDING (or opener/closer) response was selected. Its SPP closes the
// open partner FPP — pop it. Record lastUserUtterance for later self-repair.
export function selectResponse(response) {
    state.lastUserUtterance = response.text;
    // The user is OPENING the conversation (selected an opener). They produced an
    // FPP (a greeting / pre-question) the partner is now expected to respond to,
    // so push it as a USER-opened sequence. The partner's reply is then read as
    // an SPP to the user (ingestClassification pops it and lets the user lead),
    // NOT as a fresh partner FPP. Floor goes to the partner — we await their reply.
    if (response.slot === SLOT.OPENER) {
        state.sequenceStack.push({
            action: 'OPENER', openedBy: 'USER', utterance: response.text, sttConfidence: null,
        });
        state.mode = MODE.LISTENING;
        state.floor = FLOOR.PARTNER;
        state.palette = [];
        return getSnapshot();
    }
    // An SPP closes the innermost partner-opened sequence.
    for (let i = state.sequenceStack.length - 1; i >= 0; i--) {
        if (state.sequenceStack[i].openedBy === 'PARTNER') {
            state.sequenceStack.splice(i, 1);
            break;
        }
    }
    if (state.mode !== MODE.PRE_CLOSING_CLOSING) state.mode = MODE.LISTENING;
    // The user produced their turn — the floor is open again (the partner may
    // take it, or it lapses until someone does).
    state.floor = FLOOR.OPEN;
    state.palette = [];
    return getSnapshot();
}

// The user DECLINED the partner's closing ("Actually, before you go —"). A
// pre-closing is an offer to end, and declining it puts the conversation back in
// its body — so undo the pre-closing phase/mode that the partner's CLOSING set,
// which selectResponse deliberately leaves alone (it assumes a closing in progress
// stays in progress). Without this the conversation stays stuck in PRE_CLOSING and
// the next partner turn is still read through the closing fast-path.
export function reopenFromClosing() {
    state.phase = 'BODY';
    state.mode = MODE.LISTENING;
    state.floor = FLOOR.OPEN;
    state.palette = [];
    return getSnapshot();
}

// A REPAIR-OF-SELF operation completed (re-speak / rephrase / expand). The
// spokenText is what was actually said; it becomes the new lastUserUtterance.
// No partner FPP is involved, so the stack is untouched.
export function completeRepairOfSelf(spokenText) {
    if (spokenText) state.lastUserUtterance = spokenText;
    state.mode = MODE.LISTENING;
    state.floor = FLOOR.OPEN;
    state.palette = [];
    return getSnapshot();
}

// --- Persistent override controls (design §5.1) ---

// Pardon? — user initiates repair on the partner's turn. Push a nested repair
// sequence; on the partner's re-speak (next COMPLETE), it resolves (see ingest).
export function pardon() {
    // Only one open user-repair makes sense at a time: tapping Pardon? again
    // before the partner has re-spoken is the same unresolved "I didn't catch
    // that" obligation, not a new one. Don't stack a second REPAIR* on top of an
    // existing one (Ken, Pass 6, June 19 2026) — the partner's single re-speak
    // resolves the repair, so duplicates would never get popped.
    const top = state.sequenceStack[state.sequenceStack.length - 1];
    const alreadyRepairing = top && top.action === 'REPAIR' && top.openedBy === 'USER';
    if (!alreadyRepairing) {
        state.sequenceStack.push({
            action: 'REPAIR', openedBy: 'USER', utterance: '(asked partner to clarify)',
            sttConfidence: null,
        });
    }
    state.mode = MODE.LISTENING;
    // We've handed back to the partner to re-do their turn.
    state.floor = FLOOR.PARTNER;
    state.palette = [];
    return getSnapshot();
}

// Wind down — enter PRE-CLOSING and offer the WIND-DOWN statements ("I should get
// going.") — an intent to end, not a goodbye. Selecting one leads to showClosings.
// The "Wind down" button always lands here (Ken, July 2026); re-pressing it after
// the partner didn't reciprocate re-offers the wind-downs (the app pages to a
// different set when more are defined than fit).
export function windDown() {
    state.phase = 'PRE_CLOSING';
    state.mode = MODE.PRE_CLOSING_CLOSING;
    state.floor = FLOOR.SELF; // the user is taking the floor to wind things down
    state.palette = windDownPalette();
    return getSnapshot();
}

// Offer the CLOSING statements (the actual goodbyes). Reached automatically once
// the user has selected a wind-down statement, and when the partner themselves
// closes. Stays in the pre-closing phase.
export function showClosings() {
    state.phase = 'PRE_CLOSING';
    state.mode = MODE.PRE_CLOSING_CLOSING;
    state.floor = FLOOR.SELF;
    state.palette = closingPalette();
    return getSnapshot();
}

// Initiate — user opens the conversation; surface pre-sequences / openers (§5.2).
// `opts.partnerName` (from an active Partner toggle) personalizes the openers.
export function initiate(opts = {}) {
    state.phase = 'OPENING';
    state.mode = MODE.INITIATING;
    state.floor = FLOOR.SELF; // the user is taking the floor to open
    state.palette = openerPalette(opts.partnerName || '');
    return getSnapshot();
}
