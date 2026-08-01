import { setIconButton } from './icons.js';
import * as chime from './chime.js';

const responseOptions = document.getElementById('responseOptions');
const statusBar = document.getElementById('statusBar');
const listenBtn = document.getElementById('listenBtn');
const transcriptBox = document.getElementById('transcript');     // fixed-height scroller
const transcriptLog = document.getElementById('transcriptLog');  // committed turns
const liveTurn = document.getElementById('liveTurn');            // in-progress partner turn
const modeChip = document.getElementById('modeChip');
const nowPlaying = document.getElementById('nowPlaying');
const nowPlayingText = document.getElementById('nowPlayingText');

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// --- Conversation transcript (scrolling, FIXED height — the layout never grows,
// for the static keyguard). Committed turns are rendered from history (partner
// vs user styled differently); the in-progress partner turn is a separate live
// entry; the now-playing placeholder is a transient entry. All scroll INSIDE the box. ---

// Keep the newest content in view. Scrolls TWICE: once now, and once on the next
// frame (Ken, July 2026 — the partner's in-progress line was often left hidden
// behind the command bar while they spoke). Anything that restyles the live turn
// AFTER we scroll can rewrap it taller — `state-uncleaned` adds italics, which
// changes text metrics — and the box was then one line short of the bottom. A
// synchronous scroll can't see a reflow that hasn't happened yet, so we follow up
// once the frame has settled. Cheap, and idempotent when nothing moved.
let pendingScroll = 0;
function scrollLogToBottom() {
    if (!transcriptBox) return;
    transcriptBox.scrollTop = transcriptBox.scrollHeight;
    if (pendingScroll) return;              // one follow-up per frame is enough
    pendingScroll = requestAnimationFrame(() => {
        pendingScroll = 0;
        if (transcriptBox) transcriptBox.scrollTop = transcriptBox.scrollHeight;
    });
}

// Render the committed conversation (array of {role:'partner'|'user', text}).
export function renderConversation(history) {
    if (!transcriptLog) return;
    transcriptLog.innerHTML = '';
    (history || []).forEach((t) => {
        const div = document.createElement('div');
        div.className = `turn turn-${t.role === 'partner' ? 'partner' : 'user'}`;
        // A partner turn recorded without the AI cleanup pass (AI unreachable, or an
        // interruption fragment) is marked raw — blue/italic.
        if (t.uncleaned) div.classList.add('turn-uncleaned');
        div.textContent = t.text;
        transcriptLog.appendChild(div);
    });
    scrollLogToBottom();
}

// The in-progress partner turn (live STT, provisional) — shown below the
// committed turns. Empty text hides it.
export function setLiveTranscript(text) {
    if (!liveTurn) return;
    if (text) { liveTurn.textContent = text; liveTurn.hidden = false; }
    else { liveTurn.textContent = ''; liveTurn.hidden = true; }
    scrollLogToBottom();
}

// --- Region A: mode chip + three-state transcript display (UI-Design.docx
// §3.1, §6). The chip names the engine's inferred mode; the transcript panel's
// state (UNCONFIRMED → GENERATING → OPTIONS READY) is informational — it no
// longer GATES generation (generation fires on the silence period, Ken's
// decision), so the states reassure rather than block. ---

// Friendly, user-facing mode labels (the engine's enum is internal). The
// dominant slot color of each mode drives the chip color (token table §10).
const MODE_CHIP = {
    STANDBY:             { label: 'Standby',             cls: 'chip-standby' },
    LISTENING:           { label: 'Listening',           cls: 'chip-listening' },
    RESPONDING:          { label: 'Choose a response',   cls: 'chip-responding' },
    REPAIR_OF_SELF:      { label: 'They need that again', cls: 'chip-repair' },
    INITIATING:          { label: 'Start the conversation', cls: 'chip-initiating' },
    PRE_CLOSING_CLOSING: { label: 'Wrapping up',         cls: 'chip-closing' },
};

function renderModeChip() {
    if (!modeChip || !lastSnap) return;
    const s = lastSnap;
    // STANDBY relabel when genuinely at rest (mirrors the diagnostic Mode cell):
    // the engine's resting mode is LISTENING, but with the mic off and nothing
    // owed it reads wrong — show Standby instead.
    const atRest = !capturing
        && s.mode === 'LISTENING'
        && (s.floor || 'open') === 'open'
        && (!s.sequenceStack || s.sequenceStack.length === 0)
        && (!s.palette || s.palette.length === 0);
    const key = atRest ? 'STANDBY' : s.mode;
    const meta = MODE_CHIP[key] || MODE_CHIP.LISTENING;
    modeChip.textContent = meta.label;
    modeChip.className = `mode-chip ${meta.cls}`;
}

// Three-state cue (UNCONFIRMED → GENERATING → READY) applied subtly to the live
// partner turn (a colored left accent) — informational, doesn't gate anything.
export function setTranscriptState(state) {
    if (!liveTurn) return;
    liveTurn.classList.remove('state-unconfirmed', 'state-generating', 'state-ready', 'state-uncleaned');
    if (state && state !== 'idle') liveTurn.classList.add(`state-${state}`);
    // These classes change how the live line renders (state-uncleaned italicises
    // it), which can rewrap it taller — so re-assert the bottom rather than leaving
    // the partner's in-progress words pushed below the fold.
    scrollLogToBottom();
}

// Faint-red wash on the whole transcript box, signalling that the app hit an
// error during this conversation (any error routed through storage.logError —
// a thrown API/parse failure OR a silent no-usable-responses path). It is a
// non-verbal heads-up to the user/partner ("expect a hiccup; pass it to
// support") — no worded message on screen; the details go to the error log.
// STICKY until the next working cycle: cleared the moment a real response
// palette renders (see showResponses) or the conversation resets.
export function setTranscriptError(on) {
    if (!transcriptBox) return;
    transcriptBox.classList.toggle('has-error', !!on);
}

// The currently-playing automatic utterance (placeholder) or spoken response, shown
// as text so the system never speaks on the user's behalf invisibly (§7).
export function setNowPlaying(text) {
    if (!nowPlaying || !nowPlayingText) return;
    if (text) {
        nowPlayingText.textContent = text;
        nowPlaying.hidden = false;
    } else {
        nowPlayingText.textContent = '';
        nowPlaying.hidden = true;
    }
    // This line sits BELOW the live partner turn in the same scroll box, so showing
    // it adds height at the bottom and would push the partner's in-progress words
    // out of view if we didn't follow.
    scrollLogToBottom();
}

// --- Region B: the response palette as triple-coded cards (UI-Design.docx §4).
// Each card carries: slot badge (text), slot color (border + badge), the
// glanceable hint (primary reading target), the full utterance (smaller), an
// optional format tag, and a latency dot (filled = instant, hollow = a
// generation round-trip on selection). Position + color + badge = triple coding,
// so meaning never rests on color alone. ---

// slot enum → { badge label, css class, friendly aria name }. Covers the four
// RESPONDING slots plus the repair-of-self ops and the opener/closer palettes
// the engine also emits, so every response the engine can produce renders.
const SLOT_META = {
    PREFERRED:       { badge: 'PREFERRED',    cls: 'slot-preferred' },
    DISPREFERRED:    { badge: 'DISPREFERRED', cls: 'slot-dispreferred' },
    INITIATIVE:      { badge: 'INITIATIVE',   cls: 'slot-initiative' },
    REPAIR:          { badge: 'REPAIR',       cls: 'slot-repair' },
    REPAIR_RESPEAK:  { badge: 'SAY AGAIN',    cls: 'slot-repair' },
    REPAIR_REPHRASE: { badge: 'REPHRASE',     cls: 'slot-repair' },
    REPAIR_EXPAND:   { badge: 'EXPLAIN MORE', cls: 'slot-repair' },
    OPENER:          { badge: 'OPENER',       cls: 'slot-initiative' },
    // Wind-down and closing never appear together, so they share the slate
    // "persistent" hue (the wrapping-up family); position + timing distinguish them.
    WIND_DOWN:       { badge: 'WIND DOWN',    cls: 'slot-persistent' },
    CLOSING:         { badge: 'CLOSING',      cls: 'slot-persistent' },
    // Declining the partner's closing is an INITIATIVE move — the user is seizing
    // the floor rather than winding up — so it takes the initiative blue and reads
    // apart from the slate goodbyes it sits beside.
    CLOSING_DECLINE: { badge: 'ONE MORE THING', cls: 'slot-initiative' },
    // Lead statements from Reframe-to-steer (the user holds the floor and wants to
    // take the conversation somewhere) — initiative-colored, one per cell.
    STATEMENT:       { badge: 'STATEMENT',    cls: 'slot-initiative' },
    // Closed-set turns: one card per alternative the partner offered, plus an
    // escape hatch. The choices are all straightforward answers, so they take the
    // preferred hue; the "none of these / in between" card takes the dispreferred
    // amber, which is what it is. Being outside CATEGORY_SLOTS, they lay out one
    // per cell like the openers rather than grouping into the four categories.
    CHOICE:          { badge: 'CHOICE',       cls: 'slot-preferred' },
    // The free-cell fillers keep the hue of the structural move they stand in for,
    // so the colors mean the same thing on a closed-set turn as on any other.
    CHOICE_OTHER:    { badge: 'SOMETHING ELSE', cls: 'slot-dispreferred' },
    CHOICE_ASK:      { badge: 'ASK THEM',     cls: 'slot-initiative' },
    CHOICE_REPAIR:   { badge: 'SAY AGAIN',    cls: 'slot-repair' },
};

// The response footprint is a fixed RESERVED grid of 4 CELLS (Rule 1) — 2×2 with
// a side dock, 1×4 with a bottom dock. Each cell is one category; it holds 1 or 2
// stacked option buttons (the "responses per category" setting). Empty cells are
// real estate held open even at rest (the "In my own words" box overlays here).
const RESERVED_SLOTS = 4;
const SLOT_ORDER = ['slot-preferred', 'slot-dispreferred', 'slot-initiative', 'slot-repair'];
const CATEGORY_SLOTS = ['PREFERRED', 'DISPREFERRED', 'INITIATIVE', 'REPAIR'];

// How many option cards each of the four fixed cells holds (the "responses per
// category" setting): 1 or 2. In 2-mode the four cells are split (8 slots total),
// so the reserved/empty footprint must ALSO show split cells — otherwise the app
// launches (and rests between turns) showing 4 slots but fills 8 (Ken). app.js
// keeps this in sync via setCardsPerCategory.
let cardsPerCategory = 1;
export function setCardsPerCategory(n) { cardsPerCategory = Number(n) === 2 ? 2 : 1; }

// A card shows ONLY the RESPONSE TEXT, large and easy to read (Ken): the slot
// color + fixed position carry the category, so the category pill is gone, and
// every card is spoken instantly, so the latency dot is gone too. `half` shrinks
// the text for a 2-up (stacked) category cell.
function buildResponseCard(response, index, onSelect, half) {
    const meta = SLOT_META[response.slot] || { badge: response.slot, cls: 'slot-persistent' };
    const roundtrip = response.latency === 'roundtrip';
    // Round-trip responses (rephrase/expand) have no text yet → show their hint label.
    const text = (response.text && response.text.trim()) ? response.text : (response.hint || '');

    const card = document.createElement('button');
    card.type = 'button';
    card.className = `response-card ${meta.cls}${half ? ' response-card-half' : ''}`;
    // Category isn't shown visually, so name it in the accessible label only.
    card.setAttribute('aria-label', `${meta.badge}: ${text}`);
    card.innerHTML = `<span class="response-text">${escapeHtml(text)}</span>`;
    card.addEventListener('click', () => {
        if (roundtrip) card.classList.add('working');
        onSelect(response, index);
    });
    return card;
}

// `split` (2-per-category mode) renders the cell as two stacked empty slots so an
// empty/reserved cell matches the height and slot count of a filled 8-card cell.
function buildEmptyCell(slotCls, split = false) {
    const cell = document.createElement('div');
    cell.className = `response-cell ${slotCls}${split ? ' response-cell-split' : ''}`;
    const n = split ? 2 : 1;
    for (let i = 0; i < n; i++) {
        const empty = document.createElement('div');
        empty.className = `response-card response-card-empty ${slotCls}${split ? ' response-card-half' : ''}`;
        empty.setAttribute('aria-hidden', 'true');
        cell.appendChild(empty);
    }
    return cell;
}

export function showResponses(palette, onSelect) {
    // A real palette rendering means a working cycle completed — clear any
    // sticky error wash on the transcript (sticky-until-next-success).
    setTranscriptError(false);
    responseOptions.classList.remove('is-empty');
    responseOptions.innerHTML = '';
    // Brief crossfade of contents on each render (geometry never moves, §5).
    responseOptions.classList.remove('palette-enter');
    void responseOptions.offsetWidth; // restart the animation
    responseOptions.classList.add('palette-enter');

    if (!palette || palette.length === 0) { clearResponseOptions(); return; }

    // RESPONDING palettes group into the 4 fixed category cells (each may hold
    // 1–2 stacked options); other palettes (openers / closers / repair-of-self)
    // place one response per cell.
    const isResponding = palette.some((m) => CATEGORY_SLOTS.includes(m.slot));
    let cells;
    if (isResponding) {
        cells = CATEGORY_SLOTS.map((slot, i) => ({
            responses: palette.filter((m) => m.slot === slot),
            slotCls: SLOT_ORDER[i],
        }));
    } else {
        // Openers / closers / repair-of-self distribute across the fixed 4-cell
        // footprint. A palette of four or fewer (repair-of-self = 3, a short
        // opener list) always shows one per cell. When it exceeds four (openers /
        // closers can be up to eight) the user's "responses per category" setting
        // decides: 1-card mode caps to four (one per cell); 8-card mode stacks TWO
        // per cell (up to eight) — matching the responding footprint so a single
        // keyguard lines up either way (Ken). A partner's reply to a wind-down
        // comes back as the FULL closer list, so without the cap it showed eight
        // closers even in 1-card mode.
        const perCell = (palette.length > RESERVED_SLOTS && cardsPerCategory === 2) ? 2 : 1;
        const capped = palette.slice(0, RESERVED_SLOTS * perCell);
        cells = [];
        for (let i = 0; i < capped.length; i += perCell) {
            const group = capped.slice(i, i + perCell);
            cells.push({ responses: group, slotCls: (SLOT_META[group[0].slot] || {}).cls || 'slot-persistent' });
        }
        // Never exceed the four fixed cells (the caller caps too, but be safe).
        if (cells.length > RESERVED_SLOTS) cells.length = RESERVED_SLOTS;
    }

    const count = Math.max(RESERVED_SLOTS, cells.length);
    for (let i = 0; i < count; i++) {
        const cell = cells[i];
        if (!cell || !cell.responses.length) {
            responseOptions.appendChild(buildEmptyCell(cell ? cell.slotCls : (SLOT_ORDER[i] || 'slot-persistent'), cardsPerCategory === 2));
            continue;
        }
        const el = document.createElement('div');
        el.className = `response-cell ${cell.slotCls}${cell.responses.length > 1 ? ' response-cell-split' : ''}`;
        const half = cell.responses.length > 1;
        cell.responses.forEach((response) => el.appendChild(buildResponseCard(response, palette.indexOf(response), onSelect, half)));
        responseOptions.appendChild(el);
    }
}

export function clearResponseOptions() {
    // Keep the reserved footprint: 4 empty slot-colored cells (not a placeholder
    // line), so the region's size is held even with no options / no conversation.
    responseOptions.classList.remove('is-empty', 'palette-enter', 'has-error');
    responseOptions.innerHTML = '';
    const split = cardsPerCategory === 2;
    for (let i = 0; i < RESERVED_SLOTS; i++) responseOptions.appendChild(buildEmptyCell(SLOT_ORDER[i], split));
}

// Show a VISIBLE error in the response region (Ken, July 2026): when a generation
// call fails the region would otherwise just sit empty (the status bar is hidden),
// which reads as "no response options for no reason". This surfaces the reason and
// a Try again action right where the options would have been.
export function showResponseError(message, onRetry) {
    responseOptions.classList.remove('is-empty', 'palette-enter');
    responseOptions.classList.add('has-error');
    responseOptions.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'response-error';
    const msg = document.createElement('p');
    msg.className = 'response-error-msg';
    msg.textContent = message;
    box.appendChild(msg);
    if (onRetry) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'response-error-retry';
        btn.textContent = 'Try again';
        btn.addEventListener('click', onRetry);
        box.appendChild(btn);
    }
    responseOptions.appendChild(box);
}

// --- Express Panel (base UI quick-speak, Rules 9/10). The grid mirrors the
// SELECTED KEYBOARD LAYOUT cell-for-cell (so one static keyguard overlays both):
// each key cell becomes a category-colored phrase button (phrases drawn in order
// from the pool); the keyboard's SPACE cell becomes the "In my own words" button
// (distinct color, same span); blank/pred cells and any leftover cells stay
// blank. (The persistent overrides that used to sit above the grid have moved to
// the Command Bar — Ken, June 29 2026 — so the panel is just the phrase grid.)
// Activation: single-tap, or a confirming double-tap (first tap arms, second
// within doubleTapMs confirms).
// Speaking / opening the modal is the caller's job, so this stays presentational.
const epGrid = document.getElementById('epGrid');

// Render the editable, ordered typed-item list (phrase / partner / feeling) into
// the grid cells of the paired keyboard layout, in order. The space cell becomes
// "In my own words". Phrase buttons speak (single/double tap); partner and
// feeling buttons are TOGGLES with distinct colors and an active (selected)
// state. `items` are the typed items; opts carries the lookups + callbacks.
export function renderExpressPanel(layoutRows, items, opts = {}) {
    if (!epGrid) return;
    const {
        categories = {}, influencerColors = {},
        activePartnerId = null, activeFeelingId = null,
        tapMode = 'single', doubleTapMs = 400,
        onSpeak, onTogglePartner, onToggleFeeling, onInMyOwnWords,
        // Choice chips take the leading cells for exactly as long as the partner has
        // a closed set on the table, and only as many cells as there are choices
        // (Ken, July 2026 — no standing reservation). With none on offer the panel
        // is byte-for-byte the phrase grid it was before the feature existed; with
        // N on offer the phrases shift N cells along and the last N drop off the end.
        choiceChips = [], choiceColor = {}, onChoiceChip,
    } = opts;
    epGrid.innerHTML = '';

    let armedBtn = null;
    let armTimer = null;
    const disarm = () => {
        if (armedBtn) armedBtn.classList.remove('ep-armed');
        armedBtn = null;
        if (armTimer) { clearTimeout(armTimer); armTimer = null; }
    };
    const blank = (span) => {
        const f = document.createElement('div');
        f.className = 'ep-cell-blank';
        f.style.flex = `${span} 1 0`;
        return f;
    };
    const setColor = (b, color, tint) => {
        b.style.setProperty('--ep-color', color || '#546E7A');
        b.style.setProperty('--ep-tint', tint || '#eceff1');
    };

    const buildItemBtn = (item, span) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ep-btn';
        b.style.flex = `${span} 1 0`;

        if (item.type === 'partner') {
            const label = item.nickname || item.name || 'Partner';
            const ic = influencerColors.partner || {};
            setColor(b, ic.color, ic.tint);
            b.classList.add('ep-partner');
            if (item.id && item.id === activePartnerId) b.classList.add('ep-on');
            b.title = `Talking with ${label}`;
            b.setAttribute('aria-label', `Talking with ${label}${item.id === activePartnerId ? ' (on)' : ''}`);
            b.setAttribute('aria-pressed', String(item.id === activePartnerId));
            b.innerHTML = `<span class="ep-text">${escapeHtml(label)}</span>`;
            b.addEventListener('click', () => onTogglePartner && onTogglePartner(item));
            return b;
        }
        if (item.type === 'feeling') {
            const ic = influencerColors.feeling || {};
            setColor(b, ic.color, ic.tint);
            b.classList.add('ep-feeling');
            if (item.id && item.id === activeFeelingId) b.classList.add('ep-on');
            b.title = `Feeling ${item.text}`;
            b.setAttribute('aria-label', `Feeling ${item.text}${item.id === activeFeelingId ? ' (on)' : ''}`);
            b.setAttribute('aria-pressed', String(item.id === activeFeelingId));
            b.innerHTML = `<span class="ep-text">${escapeHtml(item.text)}</span>`;
            b.addEventListener('click', () => onToggleFeeling && onToggleFeeling(item));
            return b;
        }
        // phrase
        const cat = categories[item.cat] || {};
        setColor(b, cat.color, cat.tint);
        b.title = item.text;
        b.setAttribute('aria-label', item.text);
        b.innerHTML = `<span class="ep-text">${escapeHtml(item.text)}</span>`;
        b.addEventListener('click', () => {
            if (tapMode === 'double') {
                if (armedBtn === b) { disarm(); onSpeak && onSpeak(item); }
                else { disarm(); armedBtn = b; b.classList.add('ep-armed'); armTimer = setTimeout(disarm, doubleTapMs); }
            } else { onSpeak && onSpeak(item); }
        });
        return b;
    };

    // A choice chip: one of the alternatives the partner just offered.
    const buildChoiceCell = (chip, span) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ep-btn ep-choice';
        b.style.flex = `${span} 1 0`;
        setColor(b, choiceColor.color, choiceColor.tint);
        b.title = `Answer with "${chip.label}" — rebuilds the response cards around it`;
        b.setAttribute('aria-label', `Answer with ${chip.label}`);
        b.innerHTML = `<span class="ep-text">${escapeHtml(chip.label)}</span>`;
        // Always single-tap: this doesn't speak, it asks the AI for responses built
        // around the chosen alternative, so a mis-tap costs a round-trip, not a
        // wrong thing said aloud. The double-tap safeguard guards SPEAKING.
        b.addEventListener('click', () => onChoiceChip && onChoiceChip(chip));
        return b;
    };

    let pi = 0;              // index into the ordered item list
    let ci = 0;              // index into the offered chips (they take the lead cells)
    (layoutRows || []).forEach((row) => {
        const rowEl = document.createElement('div');
        rowEl.className = 'ep-row';
        (row || []).forEach((cell) => {
            const span = cell.span || 1;
            if (cell.kind === 'space') {
                // The space counterpart: "In my own words" (distinct color, single
                // tap). It is a CONSTANT control (not a user-editable phrase), so per
                // the icon-only rule it shows a compose (pencil) icon + tooltip, not
                // its text label (Ken).
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'ep-btn ep-imow';
                b.style.flex = `${span} 1 0`;
                setIconButton(b, 'compose', 'In my own words');
                b.addEventListener('click', () => onInMyOwnWords && onInMyOwnWords());
                rowEl.appendChild(b);
                return;
            }
            if (cell.kind === 'blank' || cell.kind === 'pred') {
                rowEl.appendChild(blank(span));
                return;
            }
            // Chips claim the leading cells while a choice is on offer, pushing the
            // phrases along; the ones that fall off the end are simply not rendered.
            if (ci < choiceChips.length) {
                rowEl.appendChild(buildChoiceCell(choiceChips[ci++], span));
                return;
            }
            // char or non-space action cell → next item, or blank if exhausted.
            const item = items[pi++];
            if (!item) { rowEl.appendChild(blank(span)); return; }
            rowEl.appendChild(buildItemBtn(item, span));
        });
        epGrid.appendChild(rowEl);
    });
}

// --- Diagnostic engine-state panel (temporary, replaced by the real UI later) ---

const engineEls = {
    mode: document.getElementById('engineMode'),
    floor: document.getElementById('engineFloor'),
    phase: document.getElementById('enginePhase'),
    action: document.getElementById('engineAction'),
    turnStatus: document.getElementById('engineTurnStatus'),
    repair: document.getElementById('engineRepair'),
    stack: document.getElementById('engineStack'),
    lastUser: document.getElementById('engineLastUser'),
};

// The Mode cell depends on BOTH the engine snapshot and the mic-capture state:
// when the engine is genuinely at rest we show "STANDBY" instead of the engine's
// resting "LISTENING" (which otherwise reads as if the mic were live). This is a
// presentation-only relabel — the engine's internal mode stays LISTENING. Kept
// as a separate helper because either input (snapshot or capture) can change
// independently and must re-render the cell.
let lastSnap = null;
let capturing = false;

function renderModeCell() {
    if (!engineEls.mode || !lastSnap) return;
    const s = lastSnap;
    const atRest = !capturing
        && s.mode === 'LISTENING'
        && (s.floor || 'open') === 'open'
        && (!s.sequenceStack || s.sequenceStack.length === 0)
        && (!s.palette || s.palette.length === 0);
    engineEls.mode.textContent = atRest ? 'STANDBY' : s.mode;
}

export function showEngineState(snap) {
    if (!snap) return;
    lastSnap = snap;
    renderModeCell();
    renderModeChip();
    if (!engineEls.phase) return; // diagnostics panel collapsed/absent
    engineEls.phase.textContent = snap.phase;
    if (engineEls.floor) {
        const floor = snap.floor || 'open';
        engineEls.floor.textContent = floor;
        engineEls.floor.className = `engine-val floor-${floor}`;
    }
    const c = snap.lastClassification;
    engineEls.action.textContent = c ? c.partner_action : '—';
    engineEls.turnStatus.textContent = c ? c.turn_status : '—';
    engineEls.repair.textContent = c ? (c.is_repair_initiator ? 'yes' : 'no') : '—';
    engineEls.stack.textContent = snap.sequenceStack.length
        ? snap.sequenceStack.map(s => `${s.action}${s.openedBy === 'USER' ? '*' : ''}`).join(' › ')
        : '(empty)';
    engineEls.lastUser.textContent = snap.lastUserUtterance || '—';
}

export function onInitiateClick(handler) {
    document.getElementById('initiateBtn').addEventListener('click', handler);
}
export function onSayAgainClick(handler) {
    document.getElementById('sayAgainBtn').addEventListener('click', handler);
}
export function onHoldOnClick(handler) {
    document.getElementById('holdOnBtn').addEventListener('click', handler);
}
export function onPardonClick(handler) {
    document.getElementById('pardonBtn').addEventListener('click', handler);
}
export function onWindDownClick(handler) {
    document.getElementById('windDownBtn').addEventListener('click', handler);
}
export function onEndConversationClick(handler) {
    document.getElementById('endConversationBtn').addEventListener('click', handler);
}
export function onPrivacyToggleClick(handler) {
    document.getElementById('privacyBtn').addEventListener('click', handler);
}

// Reflect the "don't save this conversation" state on the Command Bar button —
// a sticky toggle shown as a selected button (Rule 6). `private` true = saving OFF.
export function setPrivacyState(isPrivate) {
    const btn = document.getElementById('privacyBtn');
    if (!btn) return;
    btn.classList.toggle('private-on', isPrivate);
    btn.setAttribute('aria-pressed', String(isPrivate));
    const label = isPrivate
        ? 'This conversation is NOT being saved — tap to save'
        : "Don't save this conversation";
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

export function setStatus(message) {
    statusBar.textContent = message;
}

export function setListenButtonState(listening) {
    // Recording indicator (Ken, July 18 2026). The transition INTO capture is the
    // single choke point for the start-of-listening chime — audible, so it reaches a
    // partner not looking at the screen. Only on the false→true edge: the recognizer's
    // mid-session restarts don't re-emit 'listening', so this fires once per genuine
    // listen start, not on every restart. `capturing` still holds the PREVIOUS state
    // here (reassigned below). The on-screen half is the pulsing red Listen button
    // (.listening) set below — no screen-wide frame.
    if (listening && !capturing) chime.playListenChime();

    // Icon-only (Rule 4); the .listening (selected/red) state signals capture is
    // on (Rule 6 — a sticky action shown as a selected button).
    setIconButton(listenBtn, 'mic', listening ? 'Stop listening' : 'Start listening');
    listenBtn.classList.toggle('listening', listening);
    // Mic capture is an I/O state, separate from the engine's CA mode — surface
    // it on its own row so "Mode: LISTENING" (the engine's resting mode) isn't
    // misread as "the microphone is on".
    const cap = document.getElementById('engineCapture');
    if (cap) {
        cap.textContent = listening ? 'on' : 'off';
        cap.classList.toggle('capture-on', listening);
        cap.classList.toggle('capture-off', !listening);
    }
    // Mic state feeds the STANDBY-vs-LISTENING relabel — re-render the Mode cell
    // so it flips the instant capture toggles, not only on the next snapshot.
    capturing = listening;
    renderModeCell();
    renderModeChip();
}

// Convert the control buttons to icon-only (Rule 4), keeping each one's
// accessible name (aria-label + title). Content buttons — response cards
// and Express Panel buttons — are intentionally NOT touched (they show text).
// Called once at startup.
export function applyControlIcons() {
    // Two distinct repeat controls, named speaker-specifically (Ken): one
    // re-speaks the USER's last words, one asks the PARTNER to repeat.
    setIconButton(document.getElementById('sayAgainBtn'), 'replay', 'Repeat what I said');
    setIconButton(document.getElementById('holdOnBtn'), 'pause', 'Hold on');
    setIconButton(document.getElementById('pardonBtn'), 'pardon', 'Ask them to repeat');
    setIconButton(document.getElementById('windDownBtn'), 'windDown', 'Wind down');
    setIconButton(document.getElementById('initiateBtn'), 'startChat', 'Start conversation');
    setIconButton(document.getElementById('endConversationBtn'), 'endChat', 'End conversation');
    setIconButton(document.getElementById('privacyBtn'), 'noSave', "Don't save this conversation");
    setIconButton(document.getElementById('settingsBtn'), 'settings', 'Settings');
    setIconButton(document.getElementById('closeSettingsBtn'), 'close', 'Close settings');
    setIconButton(document.getElementById('regenerateBtn'), 'shuffle', 'New 4 — different options');
    setIconButton(document.getElementById('speakBtn'), 'speak', 'Speak');
    setIconButton(document.getElementById('reframeBtn'), 'reframe', 'Reframe — new options from this');
    setIconButton(document.getElementById('cancelComposerBtn'), 'clear', 'Cancel');
    setListenButtonState(false); // initialize the Listen button's mic icon
}

// --- "In my own words" modal overlay (Rule 8). Shows the input box over the
// reserved response footprint without blurring the base UI; focusing the textarea
// brings up the keyboard in the dock region. ---

// The composer is a "soft" modal — the base UI is deliberately left interactive
// (Rule 8), NOT inert — so a physical-keyboard Tab would leak focus straight into
// the base controls behind/under it (Command Bar, Express Panel) and appear to do
// nothing useful (Ken). Trap Tab / Shift+Tab so it cycles the composer's own
// controls (textarea → Speak → Reframe → Cancel → back), the way a real modal
// dialog does.
function composerTabTrap(e) {
    if (e.key !== 'Tab') return;
    const ov = document.getElementById('composerOverlay');
    if (!ov || ov.hidden) return;
    const items = [...ov.querySelectorAll('textarea, button')]
        .filter((el) => !el.disabled && el.getClientRects().length > 0);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey) {
        if (active === first || !ov.contains(active)) { e.preventDefault(); last.focus(); }
    } else if (active === last || !ov.contains(active)) {
        e.preventDefault();
        first.focus();
    }
}

export function showComposerOverlay() {
    const ov = document.getElementById('composerOverlay');
    if (ov) ov.hidden = false;
    document.addEventListener('keydown', composerTabTrap, true);
    const ta = document.getElementById('composerInput');
    if (ta) ta.focus(); // triggers the on-screen keyboard (if onscreen mode)
}

export function hideComposerOverlay() {
    document.removeEventListener('keydown', composerTabTrap, true);
    const ta = document.getElementById('composerInput');
    if (ta) ta.blur(); // dismisses the on-screen keyboard
    const ov = document.getElementById('composerOverlay');
    if (ov) ov.hidden = true;
}

export function onListenClick(handler) {
    listenBtn.addEventListener('click', handler);
}

export function onRegenerateClick(handler) {
    document.getElementById('regenerateBtn').addEventListener('click', handler);
}

// Update the regenerate button's accessible name / tooltip to match how many
// cards are actually shown — "New 4" with 1 per category, "New 8" with 2 (Ken).
export function setRegenerateLabel(count) {
    const btn = document.getElementById('regenerateBtn');
    if (!btn) return;
    const label = `New ${count} — different options`;
    btn.setAttribute('aria-label', label);
    btn.title = label;
}

export function onSettingsClick(handler) {
    document.getElementById('settingsBtn').addEventListener('click', handler);
}
// (onAboutMeClick removed — About Me is now launched from the Settings panel's
// "About Me" tab, not a title-bar button.)

// --- "In your own words" composer ---

export function onSpeakClick(handler) {
    document.getElementById('speakBtn').addEventListener('click', handler);
}

export function onReframeClick(handler) {
    document.getElementById('reframeBtn').addEventListener('click', handler);
}

export function onCancelComposerClick(handler) {
    document.getElementById('cancelComposerBtn').addEventListener('click', handler);
}

export function getComposerText() {
    return document.getElementById('composerInput').value.trim();
}

export function clearComposer() {
    document.getElementById('composerInput').value = '';
}
