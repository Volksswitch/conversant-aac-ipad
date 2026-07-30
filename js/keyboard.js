/* AAC Conversation Assistant — app virtual keyboard (June 2026)
 *
 * The on-screen keyboard the user types with when they choose
 * Settings → "Keyboard for typing" → "On-screen keyboard (app's own)".
 *
 * Why this exists (CLAUDE.md "In My Own Words" / keyboard-selection spec):
 * on a Surface, Windows shows no keyboard with the type cover in laptop
 * position but auto-pops its own when the cover is folded back/detached.
 * The browser exposes no reliable signal for that posture, so a user-set
 * Settings parameter decides. When the mode is 'onscreen' we (a) set
 * inputmode="none" on the in-scope fields so the Windows keyboard never
 * pops, and (b) show this keyboard, which inserts into the focused field.
 *
 * Scope: the "In your own words" composer (#composerInput) and the
 * "About Me" questionnaire inputs (.wv-text). Settings' own fields stay on
 * the OS/physical keyboard (Setup-tier, rare, often supporter-entered).
 *
 * Access-method note: this is just the direct-select renderer of text
 * entry. It keeps focus on the target field (keys act on pointerdown +
 * preventDefault) so the caret never moves and no field blurs mid-type.
 */

import { LAYOUTS, buildSymbolsPage } from './keyboard-layouts.js';
import * as prediction from './prediction.js';

// Fields the app keyboard handles. Includes the Settings API-key field so the
// Windows keyboard is suppressed there too and the app's own (side-docked)
// keyboard is used instead (Ken, June 14 2026 — resolves the OS-vs-app keyboard
// question for Settings in favor of the app keyboard).
const IN_SCOPE = '#composerInput, .wv-text, #apiKeyInput, #controlEditor input, #expressEditor input, #settingsProfileNameInput';

// Controls that must NOT dismiss the keyboard when tapped, even though tapping
// them blurs the composer textarea. The composer (unlike About Me / Settings)
// has no serving panel, so without this its Speak/Clear buttons trip the
// focusout → hide() path, which reflows the layout out from under the finger and
// steals the first click — so Speak only worked on the second press (Ken, June
// 19 2026). Keeping the keyboard up keeps the layout stable so the tap lands.
const KEEP_OPEN_CONTROLS = '#speakBtn, #reframeBtn, #cancelComposerBtn';

// The element under the most recent pointerdown. On touch a tapped <button> is
// frequently NOT reported as focusout.relatedTarget, so relatedTarget alone
// can't tell us the blur was caused by tapping a keep-open control — this can.
let lastPointerDownEl = null;

let mode = 'physical';          // 'physical' | 'onscreen'
let rootEl = null;              // the keyboard panel
let activeField = null;         // the input/textarea currently being typed into
let predWrap = null;            // the word-prediction button container (display dropped)
const PRED_COUNT = 3;           // number of prediction slots

// --- Inline word-prediction ghost (Ken, June 29 2026) -----------------------
// A non-interactive overlay mirrors the active field's text so the single best
// completion appears INLINE, right after what the user has typed (Smart-Compose
// style). It's purely visual. **Acceptance is an explicit TAP anywhere in the
// field** (Ken, July 2026) — the field is one big fixed acceptance target, so
// there's no moving inline tap target (keyguard-safe) and no contenteditable.
// Separators (space / comma / period / Enter) DO NOT accept: a separator must
// never silently swap the typed word for a prediction ("Yes" + space stays
// "Yes", not "Yesterday"), especially since the user may not be looking at the
// box. Shown only when the caret is at the END of the value (true "appending"),
// so the mirror never has to place text after the ghost.
let ghostEl = null;             // the overlay box (mirrors the field)
let ghostInner = null;          // inner wrapper (carries the scroll transform)
let ghostWord = null;           // the full predicted word currently shown (canonical case)
let ghostField = null;          // the field the scroll listener is bound to
const GHOST_STYLE_PROPS = [
    'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontVariant', 'letterSpacing',
    'wordSpacing', 'lineHeight', 'textAlign', 'textIndent', 'textTransform', 'tabSize',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing',
];

// Selected layouts per dock + which side the side dock sits on (user Settings).
let sideLayoutId = 'S1';
let bottomLayoutId = 'B1';
let sideDockPosition = 'right'; // 'left' | 'right'
let keyboardDock = 'bottom';    // 'side' | 'bottom' — the user's single choice
let currentDock = 'bottom';     // the dock currently applied
// Settings "layout preview": the keyboard is shown for previewing a layout
// without a focused field (so it doesn't vanish when you leave a text field to
// change layouts on the Speech & Input tab).
let previewing = false;

// Shift state machine (CLAUDE.md keyboard spec, June 2026):
//   'off'   — lowercase
//   'shift' — one-shot: next letter is uppercase, then auto-reverts to 'off'
//   'lock'  — caps lock: stays uppercase until shift is tapped again
// A single tap toggles off↔shift; a double tap (within SHIFT_DOUBLE_TAP_MS)
// engages 'lock'. A non-touch-typing user gets a Caps-Lock-style sticky shift
// without having to hold a key.
let shiftState = 'off';
let lastShiftTap = 0;
const SHIFT_DOUBLE_TAP_MS = 300;

// Which page is showing: 'letters' or 'symbols'. Numbers and special
// characters live on the symbols page (toggled with the 123 / ABC key) so
// the letters page stays uncluttered. Comma, period, space and backspace stay
// on the letters page per Ken's spec; space, backspace and enter are repeated
// on the symbols page because editing is impossible without them.
let page = 'letters';

// Layout is ALPHABETICAL (QWERTY dropped). The specific arrangement is a user
// Setting — twenty layouts live in keyboard-layouts.js (S1–S10 side, B1–B10
// bottom), one chosen per dock. The active letters page = the selected layout
// for the current dock; the 123 key flips to a dock-appropriate symbols page.

// Returns the rows to render right now (active layout's letters, or the symbols
// page GENERATED from that same layout so its geometry matches — one keyguard
// fits both pages, per Spatial Stability).
function currentRows() {
    const id = currentDock === 'side' ? sideLayoutId : bottomLayoutId;
    const rows = (LAYOUTS[id] || LAYOUTS[currentDock === 'side' ? 'S1' : 'B1']).rows;
    return page === 'symbols' ? buildSymbolsPage(rows) : rows;
}

// --- field helpers ----------------------------------------------------------

function isScoped(node) {
    return node instanceof Element && node.matches(IN_SCOPE);
}

function applyInputMode(node) {
    // inputmode="none" is the reliable Edge/Chrome switch that stops the
    // Windows touch keyboard from appearing on focus.
    node.inputMode = mode === 'onscreen' ? 'none' : '';
}

function applyInputModeAll() {
    document.querySelectorAll(IN_SCOPE).forEach(applyInputMode);
}

// --- typing into the active field ------------------------------------------

function insert(text) {
    const f = activeField;
    if (!f) return;
    const start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    f.value = f.value.slice(0, start) + text + f.value.slice(end);
    const pos = start + text.length;
    f.setSelectionRange(pos, pos);
    f.dispatchEvent(new Event('input', { bubbles: true }));
    // Keep the cursor visible as text grows past the field width (the keyboard
    // narrows inputs compared to the full-width OS layout).
    requestAnimationFrame(() => { if (f.isConnected && f.tagName === 'INPUT') f.scrollLeft = f.scrollWidth; });
}

function backspace() {
    const f = activeField;
    if (!f) return;
    let start = f.selectionStart ?? f.value.length;
    const end = f.selectionEnd ?? f.value.length;
    if (start === end) {
        if (start === 0) return;
        start -= 1;
    }
    f.value = f.value.slice(0, start) + f.value.slice(end);
    f.setSelectionRange(start, start);
    f.dispatchEvent(new Event('input', { bubbles: true }));
}

function enter() {
    // TODO (Ken, June 2026 — to discuss/revisit): Enter may need to behave
    // differently per context (newline vs. save vs. speak), and the keyboard
    // likely needs a formal "close/done" key rather than relying on Enter or a
    // focus-out to dismiss it. Current behavior: newline in a textarea, save in
    // a single-line field. See CLAUDE.md "App virtual keyboard" notes.
    const f = activeField;
    if (!f) return;
    if (f.tagName === 'TEXTAREA') {
        insert('\n');
    } else {
        // Single-line fields (composer is a textarea; worldview inputs are
        // text) save on Enter — fire the keydown their handlers listen for.
        f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
}

function applyShiftVisual() {
    if (!rootEl) return;
    rootEl.classList.toggle('kbd-shift-on', shiftState === 'shift');
    rootEl.classList.toggle('kbd-caps', shiftState === 'lock');
    const upper = shiftState !== 'off';
    rootEl.querySelectorAll('.kbd-key[data-char]').forEach((k) => {
        const ch = k.dataset.char;
        if (/[a-z]/i.test(ch)) k.textContent = upper ? ch.toUpperCase() : ch.toLowerCase();
    });
}

function onShift() {
    const now = Date.now();
    if (now - lastShiftTap < SHIFT_DOUBLE_TAP_MS) {
        shiftState = 'lock';                                  // double tap → caps lock
    } else {
        shiftState = shiftState === 'off' ? 'shift' : 'off';  // single tap toggles
    }
    lastShiftTap = now;
    applyShiftVisual();
}

// One-shot shift reverts to lowercase after a single character; caps lock stays.
function consumeShift() {
    if (shiftState === 'shift') { shiftState = 'off'; applyShiftVisual(); }
}

// --- clipboard (cut / copy / paste toolbar) --------------------------------
// A fixed Cut/Copy/Paste strip above the keys, the same for every layout. The
// app keyboard suppresses the OS keyboard, so these give back the clipboard
// affordances the OS keyboard would have provided (notably paste for the API
// key). Buttons act on pointerdown + preventDefault so the field keeps focus
// and its selection. localhost and https are secure contexts, so the async
// Clipboard API is available.

function selectedText() {
    const f = activeField;
    if (!f) return '';
    return f.value.slice(f.selectionStart ?? 0, f.selectionEnd ?? 0);
}

function deleteSelection() {
    const f = activeField;
    if (!f) return;
    const s = f.selectionStart ?? 0;
    const e = f.selectionEnd ?? 0;
    if (s === e) return;
    f.value = f.value.slice(0, s) + f.value.slice(e);
    f.setSelectionRange(s, s);
    f.dispatchEvent(new Event('input', { bubbles: true }));
}

// Explicitly dismiss the keyboard (the toolbar's Hide button) while leaving any
// open panel (e.g. Settings) in place. Blurs the field so a later tap re-opens
// it; ends preview mode so it stays down until re-triggered.
function dismiss() {
    previewing = false;
    const f = activeField;
    hide();                       // clears activeField + hides
    if (f) { try { f.blur(); } catch { /* ignore */ } }
    // Hide runs on pointerdown; the tap's trailing CLICK fires afterwards.
    // Hiding frees the keyboard's reserved space, so the page reflows and
    // another control (e.g. About Me's "Done" button) can slide under the
    // pointer — the ghost click would then hit it (closing About Me). Swallow
    // that one click.
    suppressNextClick();
}

function suppressNextClick() {
    const onClick = (e) => { e.stopPropagation(); e.preventDefault(); cleanup(); };
    const cleanup = () => { document.removeEventListener('click', onClick, true); clearTimeout(timer); };
    const timer = setTimeout(cleanup, 400);   // in case no click follows (e.g. keyboard nav)
    document.addEventListener('click', onClick, true);   // capture: intercept before it reaches the moved control
}

async function handleTool(tool) {
    if (tool === 'hide') { dismiss(); return; }
    if (!activeField) return;
    if (tool === 'copy' || tool === 'cut') {
        const text = selectedText();
        if (!text) return;
        try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
        if (tool === 'cut') deleteSelection();
    } else if (tool === 'paste') {
        try {
            const text = await navigator.clipboard.readText();
            if (text) insert(text);   // insert() replaces any selection at the caret
        } catch { /* clipboard read blocked/denied */ }
    }
}

// --- key handling -----------------------------------------------------------

function handleKey(keyEl) {
    const action = keyEl.dataset.action;
    if (action === 'shift') { onShift(); return; }
    if (action === 'page') { page = page === 'symbols' ? 'letters' : 'symbols'; renderRows(); return; }
    // Backspace deletes; it must NOT re-show an inline ghost. Re-completing a word
    // the user is actively deleting reads as the suffix being "selected" (the
    // tinted bold ghost looks like a highlight), so clear it and don't predict
    // again until the user types forward (Ken, June 29 2026).
    if (action === 'backspace') { backspace(); clearGhost(); return; }
    // Space / Enter close a word. They do NOT accept the inline ghost — a
    // separator must never silently swap the typed word for a prediction ("Yes"
    // + space stays "Yes", not "Yesterday"), and the user may not even be looking
    // at the box. Acceptance is an explicit tap in the field (see the pointerdown
    // handler in init). So just learn the typed word, dismiss the ghost, and
    // insert the separator. (Ken, July 2026.)
    if (action === 'space') {
        learnCurrentWord(); clearGhost();
        insert(' '); consumeShift(); updatePredictions(); return;
    }
    if (action === 'enter') {
        learnCurrentWord(); clearGhost();
        enter(); updatePredictions(); return;
    }

    const ch = keyEl.dataset.char;
    if (ch == null) return;
    // A non-word character (comma, period, etc.) is a word separator too — it
    // likewise does NOT accept the ghost; learn the typed word and dismiss it.
    const isSeparator = !/[A-Za-z']/.test(ch);
    if (isSeparator) { learnCurrentWord(); clearGhost(); }
    const upper = shiftState !== 'off';
    insert(upper && /[a-z]/i.test(ch) ? ch.toUpperCase() : ch);
    consumeShift();
    updatePredictions();
}

// --- word prediction (local; see prediction.js) ----------------------------

// The partial word immediately before the caret (letters/apostrophe). Empty for
// the API-key field (a key is not natural-language) and when not on a word.
function currentWordPrefix() {
    const f = activeField;
    if (!f || f.id === 'apiKeyInput') return '';
    const caret = f.selectionStart ?? f.value.length;
    const m = f.value.slice(0, caret).match(/[A-Za-z']+$/);
    return m ? m[0] : '';
}

function learnCurrentWord() {
    const w = currentWordPrefix();
    if (w) prediction.learn(w);
}

// Fill the toolbar's prediction buttons from the current prefix; hide the spare
// slots. Called after every text change.
function updatePredictions() {
    if (!predWrap) return;
    const prefix = currentWordPrefix();
    const preds = prefix ? prediction.predict(prefix, PRED_COUNT) : [];
    let any = false;
    predWrap.querySelectorAll('.kbd-pred-btn').forEach((b, i) => {
        const w = preds[i];
        if (w) { b.textContent = w; b.dataset.word = w; b.hidden = false; any = true; }
        else { b.textContent = ''; delete b.dataset.word; b.hidden = true; }
    });
    // Show the prediction overlay only when there's something to predict; when
    // empty it's display:none so taps fall through to Cut/Copy/Paste/Hide.
    predWrap.classList.toggle('kbd-preds-active', any);
    // Drive the inline ghost too (the surfaced form of prediction).
    updateGhost();
}

// Replace the partial word at the caret with the chosen prediction + a space,
// matching the typed prefix's capitalization, then learn it.
function applyPrediction(word) {
    const f = activeField;
    if (!f) return;
    const caret = f.selectionStart ?? f.value.length;
    const before = f.value.slice(0, caret);
    const m = before.match(/[A-Za-z']+$/);
    const start = m ? caret - m[0].length : caret;
    let out = word;
    if (m && m[0][0] === m[0][0].toUpperCase()) out = word.charAt(0).toUpperCase() + word.slice(1);
    f.value = f.value.slice(0, start) + out + ' ' + f.value.slice(caret);
    const pos = start + out.length + 1;
    f.setSelectionRange(pos, pos);
    f.dispatchEvent(new Event('input', { bubbles: true }));
    prediction.learn(word);
    updatePredictions();
    if (f.tagName === 'INPUT') requestAnimationFrame(() => { if (f.isConnected) f.scrollLeft = f.scrollWidth; });
}

// --- inline ghost prediction ------------------------------------------------

function ensureGhostEl() {
    if (ghostEl) return;
    ghostEl = document.createElement('div');
    ghostEl.id = 'predGhost';
    ghostEl.setAttribute('aria-hidden', 'true');
    ghostInner = document.createElement('div');
    ghostInner.className = 'pred-ghost-inner';
    ghostEl.appendChild(ghostInner);
    document.body.appendChild(ghostEl);
}

function clearGhost() {
    ghostWord = null;
    if (ghostEl) ghostEl.style.display = 'none';
}

// Match the predicted word's case to what the user actually typed (so a
// capitalized prefix yields a capitalized completion).
function caseMatch(word, typed) {
    return typed && typed[0] === typed[0].toUpperCase()
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word;
}

// Recompute + show the inline completion for the active field. Only when the
// caret is at the END of the value (appending) and there's a real completion
// longer than the typed prefix; otherwise hide.
function updateGhost() {
    const f = activeField;
    if (!f || f.id === 'apiKeyInput') { clearGhost(); return; }
    const caret = f.selectionStart ?? f.value.length;
    if (caret !== f.value.length) { clearGhost(); return; }   // only when appending
    const prefix = currentWordPrefix();
    if (!prefix) { clearGhost(); return; }
    const pred = prediction.predict(prefix, 1)[0];
    if (!pred || pred.toLowerCase() === prefix.toLowerCase()) { clearGhost(); return; }
    ghostWord = pred;
    renderGhost();
}

// Position the mirror overlay exactly over the field and draw: the typed text
// (transparent — it only reserves the right width) + the completion SUFFIX
// (styled). Caret is at the end, so nothing follows the ghost.
function renderGhost() {
    const f = activeField;
    if (!f || !ghostWord) return;
    ensureGhostEl();
    // Host in the same top-layer as the field when it's inside an open modal
    // dialog (Settings), so the overlay isn't hidden behind the dialog.
    const host = f.closest('dialog[open]') || document.body;
    if (ghostEl.parentNode !== host) host.appendChild(ghostEl);

    const cs = getComputedStyle(f);
    const rect = f.getBoundingClientRect();
    const s = ghostEl.style;
    s.display = 'block';
    s.top = `${rect.top}px`;
    s.left = `${rect.left}px`;
    s.width = `${rect.width}px`;
    s.height = `${rect.height}px`;
    for (const p of GHOST_STYLE_PROPS) s[p] = cs[p];
    s.whiteSpace = f.tagName === 'TEXTAREA' ? 'pre-wrap' : 'pre';
    s.overflowWrap = cs.overflowWrap;

    const typed = f.value;
    const m = typed.match(/[A-Za-z']+$/);
    const out = caseMatch(ghostWord, m ? m[0] : '');
    const suffix = out.slice(m ? m[0].length : 0);
    ghostInner.textContent = '';
    ghostInner.appendChild(document.createTextNode(typed));   // transparent, reserves width
    const span = document.createElement('span');
    span.className = 'pred-ghost-word';
    span.textContent = suffix;
    ghostInner.appendChild(span);
    // Mirror the field's scroll so the ghost lines up with the visible text.
    ghostInner.style.transform = `translate(${-f.scrollLeft}px, ${-f.scrollTop}px)`;
}

function repositionGhost() {
    if (ghostWord && activeField) renderGhost();
}

// Accept the showing ghost: replace the typed prefix with the full predicted
// word (NO trailing space — the separator the user just typed is inserted next
// by the caller). Returns true if a ghost was accepted.
function acceptGhost() {
    if (!ghostWord) return false;
    const f = activeField;
    if (!f) return false;
    const caret = f.selectionStart ?? f.value.length;
    const before = f.value.slice(0, caret);
    const m = before.match(/[A-Za-z']+$/);
    if (!m) { clearGhost(); return false; }
    const start = caret - m[0].length;
    const out = caseMatch(ghostWord, m[0]);
    f.value = f.value.slice(0, start) + out + f.value.slice(caret);
    const pos = start + out.length;
    f.setSelectionRange(pos, pos);
    f.dispatchEvent(new Event('input', { bubbles: true }));
    prediction.learn(ghostWord);
    clearGhost();
    if (f.tagName === 'INPUT') requestAnimationFrame(() => { if (f.isConnected) f.scrollLeft = f.scrollWidth; });
    return true;
}

// --- DOM build --------------------------------------------------------------

function build() {
    rootEl = document.createElement('div');
    rootEl.id = 'appKeyboard';
    rootEl.className = 'hidden';
    rootEl.setAttribute('role', 'group');
    rootEl.setAttribute('aria-label', 'On-screen keyboard');

    // Act on pointerdown and preventDefault so the target field keeps focus
    // and the caret never moves (the standard on-screen-keyboard trick).
    rootEl.addEventListener('pointerdown', (e) => {
        const tool = e.target.closest('.kbd-tool');
        if (tool) { e.preventDefault(); handleTool(tool.dataset.tool); return; }
        const pred = e.target.closest('.kbd-pred-btn');
        if (pred) { e.preventDefault(); if (pred.dataset.word) applyPrediction(pred.dataset.word); return; }
        const keyEl = e.target.closest('.kbd-key');
        if (!keyEl) return;
        e.preventDefault();
        handleKey(keyEl);
    });

    // Cut / Copy / Paste toolbar REMOVED (Ken, June 29 2026): the keyboard's key
    // rows now start at the top of the dock, matching the Express Panel which no
    // longer has its #epControls override row — so a single keyguard still
    // overlays both. (Paste of a long `sk-ant-…` key is handled by the Paste
    // button beside the API-key field in Settings.)
    //
    // Word-prediction buttons (local, no AI — see prediction.js). DISPLAY is
    // dropped for now (Ken, June 28 2026): we still BUILD the overlay and keep
    // updatePredictions/learning running (infrastructure intact), but CSS hides
    // it (.kbd-preds { display:none }) while button-size questions that will
    // shape how prediction re-enters the UI are resolved. It now sits directly on
    // the keyboard root (the old toolbar that hosted it is gone).
    predWrap = document.createElement('div');
    predWrap.className = 'kbd-preds';
    for (let i = 0; i < PRED_COUNT; i++) {
        const pb = document.createElement('button');
        pb.type = 'button';
        pb.className = 'kbd-pred-btn';
        pb.tabIndex = -1;   // pointer target only (see the key buttons above)
        pb.hidden = true;
        predWrap.appendChild(pb);
    }
    rootEl.appendChild(predWrap);

    renderRows();
    document.body.appendChild(rootEl);
}

// (Re)builds the key buttons for the current page. The pointerdown handler is
// delegated on rootEl, so swapping the inner rows on a page/layout change is
// safe. Each cell's `span` becomes its flex weight, so a row of any width fills
// the keyboard and wide keys (space, etc.) keep their proportions.
function renderRows() {
    if (!rootEl) return;
    // Clear only the key rows — the Cut/Copy/Paste toolbar persists.
    rootEl.querySelectorAll('.kbd-row').forEach((el) => el.remove());
    for (const row of currentRows()) {
        const rowEl = document.createElement('div');
        rowEl.className = 'kbd-row';
        for (const cell of row) {
            const span = cell.span || 1;
            if (cell.kind === 'blank' || cell.kind === 'pred') {
                // Inert filler / future prediction slot — no key, just holds space.
                const filler = document.createElement('div');
                filler.className = 'kbd-key kbd-' + cell.kind;
                filler.style.flex = `${span} 1 0`;
                rowEl.appendChild(filler);
                continue;
            }
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'kbd-key';
            // Keys are pointer/touch targets, never Tab targets — a physical-
            // keyboard user tabbing through Settings must not walk through ~40
            // keys, and an on-screen-keyboard user reaches keys by tapping, not
            // Tab. So keep them out of the tab order in both modes (Ken, July 2026).
            btn.tabIndex = -1;
            btn.style.flex = `${span} 1 0`;
            if (cell.kind === 'char') {
                btn.dataset.char = cell.char;
                btn.textContent = cell.char;
                if (/[a-z]/i.test(cell.char)) btn.classList.add('kbd-letter');
                else btn.classList.add('kbd-char');
            } else {
                btn.dataset.action = cell.action;
                btn.textContent = cell.label;
                btn.classList.add('kbd-' + cell.action);
            }
            rowEl.appendChild(btn);
        }
        rootEl.appendChild(rowEl);
    }
    applyShiftVisual();
}

// --- show / hide ------------------------------------------------------------

// Docking is now a single USER CHOICE applied to every typing context (Ken,
// June 21 2026 — replaces the old context-based rule where About Me/Settings
// were side and the conversation composer was bottom). Whichever dock the user
// picked in Settings is used wherever the keyboard appears.
function dockFor(/* field */) {
    return keyboardDock;
}

let lastDockKey = '';

function setDock(dock) {
    currentDock = dock;
    const side = dock === 'side';
    const left = side && sideDockPosition === 'left';
    const right = side && sideDockPosition === 'right';
    for (const el of [rootEl, document.body]) {
        el.classList.toggle('kbd-dock-side', side);
        el.classList.toggle('kbd-dock-bottom', !side);
        el.classList.toggle('kbd-side-left', left);
        el.classList.toggle('kbd-side-right', right);
    }
    // Notify listeners (the Settings panel re-snaps clear of the keyboard) only
    // when the effective dock/side actually changes — not on every re-show.
    const key = side ? (left ? 'side-left' : 'side-right') : 'bottom';
    if (key !== lastDockKey) {
        lastDockKey = key;
        document.dispatchEvent(new CustomEvent('kbd-dock-change', { detail: { dock: key } }));
    }
}

function visible() {
    return rootEl && !rootEl.classList.contains('hidden');
}

// Is a surface the keyboard serves (About Me / Settings / the "In my own words"
// composer) currently open? Used to keep the keyboard up when a blur that isn't a
// real dismissal fires — an in-panel button (Save, etc.), or, on the device, a
// stray focusout from a reflow / the auto-resumed mic re-rendering just after the
// composer opens (Ken, July 2026 — the "keyboard doesn't display" bug: the field
// gains focus but a following focusout hides the keyboard before the user can
// type). Robust where `relatedTarget` isn't the tapped element. The surfaces'
// explicit close paths (worldview close(), Settings Close/Escape, the composer's
// Speak/Reframe/Cancel) still take the keyboard down.
function servingPanelOpen() {
    // About Me now lives inside the Settings dialog (a normal tab), so `dlg.open`
    // already covers it — no separate #worldviewScreen check needed.
    const dlg = document.getElementById('settingsDialog');
    const composer = document.getElementById('composerOverlay');
    return !!((dlg && dlg.open) ||
        (composer && !composer.hidden));
}

function show(field) {
    activeField = field;
    // Start each field in one-shot Shift so the first letter is capitalized
    // (proper nouns in About Me — Carl, Chicago, Mom — and sentence starts in
    // the composer). One-shot reverts to lowercase after that first character.
    // The API key is case-sensitive and lowercase ("sk-ant-…"), so leave it off.
    shiftState = field.id === 'apiKeyInput' ? 'off' : 'shift';
    // Suppress the toolbar Hide button during the "In my own words" modal
    // (#composerInput): there, Speak/Reframe/Cancel are the only exits and they
    // dismiss the keyboard, so Hide is redundant. Keep it for About Me/Settings.
    rootEl.classList.toggle('kbd-no-hide', field.id === 'composerInput');
    setDock(dockFor(field));
    // A modal <dialog> (Settings) lives in the top layer and renders above —
    // and makes inert — anything in normal flow. So when the focused field is
    // inside an open modal dialog, host the keyboard inside that dialog so it's
    // in the same top layer and stays interactive. The keyboard is
    // position:fixed (viewport-relative) and the dialog sets no containing
    // block (no transform), so it still docks to the screen edge and isn't
    // clipped by the dialog's overflow.
    const host = field.closest('dialog[open]') || document.body;
    if (rootEl.parentNode !== host) host.appendChild(rootEl);
    renderRows();
    rootEl.classList.remove('hidden');
    document.body.classList.add('kbd-open');
    // Re-sync the inline ghost when the field scrolls its own text.
    if (ghostField && ghostField !== field) ghostField.removeEventListener('scroll', repositionGhost);
    field.addEventListener('scroll', repositionGhost);
    ghostField = field;
    updatePredictions(); // seed predictions for any text already in the field
    // Keep the focused field clear of the keyboard. The content area reserves
    // viewport-relative padding (CSS) so the field can scroll above a
    // bottom dock; centring it lands it in the visible band above the keys.
    requestAnimationFrame(() => {
        try { field.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* ignore */ }
        // Scroll the input so the end of any existing text stays visible after
        // the keyboard opens and potentially narrows the field.
        if (field.tagName === 'INPUT') field.scrollLeft = field.scrollWidth;
        repositionGhost();   // the field just moved — re-place the ghost over it
    });
}

function hide() {
    if (ghostField) { ghostField.removeEventListener('scroll', repositionGhost); ghostField = null; }
    activeField = null;
    clearGhost();
    // Reset to a clean slate for the next field: lowercase, letters page.
    shiftState = 'off';
    page = 'letters';
    renderRows();
    updatePredictions(); // clears the prediction buttons (no active field)
    if (rootEl) rootEl.classList.add('hidden');
    document.body.classList.remove('kbd-open', 'kbd-dock-side', 'kbd-dock-bottom', 'kbd-side-left', 'kbd-side-right');
}

// --- public API -------------------------------------------------------------

export function init() {
    build();
    prediction.load(); // bundled word list + personalized frequencies (async)

    // Keep the inline ghost aligned if the page scrolls or the window resizes.
    window.addEventListener('resize', repositionGhost);
    window.addEventListener('scroll', repositionGhost, true);

    // Track the last pointerdown target so focusout can tell whether the blur
    // was caused by tapping a keep-open control (Speak/Clear), even on touch
    // where the button isn't reported as relatedTarget. Capture phase so we see
    // it before the keyboard's own handlers / the focusout fire.
    document.addEventListener('pointerdown', (e) => {
        lastPointerDownEl = e.target instanceof Element ? e.target : null;
    }, true);

    // Tapping anywhere in the active field ACCEPTS the showing inline ghost
    // (Ken, July 2026): the field is one big fixed acceptance target — no moving
    // inline tap target to chase (keyguard-safe), and acceptance is deliberate
    // and visible rather than a silent side effect of a separator. Trade-off
    // (accepted): while a ghost is showing, a tap no longer positions the caret.
    // The ghost overlay is pointer-events:none, so the tap lands on the field.
    document.addEventListener('pointerdown', (e) => {
        if (mode !== 'onscreen' || !ghostWord) return;
        const field = e.target instanceof Element ? e.target.closest(IN_SCOPE) : null;
        if (field && field === activeField) {
            e.preventDefault();   // keep focus + don't move the caret to the tap
            acceptGhost();
            updatePredictions();
        }
    });

    document.addEventListener('focusin', (e) => {
        if (mode !== 'onscreen') return;
        if (isScoped(e.target)) {
            applyInputMode(e.target);   // just-in-time guard for fresh fields
            show(e.target);
        }
    });

    document.addEventListener('focusout', (e) => {
        // Hide unless focus is moving to another in-scope field (handled by the
        // next focusin) — keys preventDefault, so typing never fires this.
        const next = e.relatedTarget;
        if (next && (isScoped(next) || (rootEl && rootEl.contains(next)))) return;
        // Keep the keyboard up while a panel it serves (About Me / Settings) is
        // still open. Tapping an in-panel button (Save, etc.) blurs the field,
        // but on many browsers — especially touch — the button does NOT become
        // `relatedTarget`, so we can't rely on it. Keeping the keyboard whenever
        // the serving panel is open is robust and matches the desired behavior:
        // - it must not hide on Save (Ken's bug 2), and
        // - it must not reflow the layout out from under the tap, which steals
        //   the first click and forces a second Save press (Ken's bug 3).
        // The panels' explicit close paths (worldview close(), Settings
        // Close/Escape, renderHome) and the Hide button take it down.
        if (servingPanelOpen()) return;
        if (previewing) return;   // keep the Settings layout-preview keyboard up
        // Keep up when the blur was caused by tapping a composer control (Speak /
        // Clear) so the reflow doesn't steal the tap. relatedTarget covers
        // desktop; lastPointerDownEl covers touch where the button isn't reported.
        const tapTarget = next || lastPointerDownEl;
        if (tapTarget && tapTarget.closest && tapTarget.closest(KEEP_OPEN_CONTROLS)) return;
        hide();
    });

    // Worldview cards are (re)built dynamically; tag any new in-scope field so
    // the Windows keyboard is suppressed before its first focus.
    const dynamicRoot = document.getElementById('worldviewContent');
    if (dynamicRoot) {
        new MutationObserver((records) => {
            if (mode !== 'onscreen') return;
            for (const rec of records) {
                for (const node of rec.addedNodes) {
                    if (!(node instanceof Element)) continue;
                    if (node.matches?.(IN_SCOPE)) applyInputMode(node);
                    node.querySelectorAll?.(IN_SCOPE).forEach(applyInputMode);
                }
            }
        }).observe(dynamicRoot, { childList: true, subtree: true });
    }
}

export function setMode(next) {
    mode = next === 'onscreen' ? 'onscreen' : 'physical';
    applyInputModeAll();
    if (mode === 'physical') { previewing = false; hide(); }
}

// --- Settings layout preview ------------------------------------------------
// Show the keyboard as a non-typing preview in the given dock (no focused
// field) so layouts can be tried on the Speech & Input tab without the keyboard
// vanishing. Hosted in the open Settings dialog so it shares the modal's top
// layer. previewHide() takes it down again (unless a real field is focused).

export function previewShow(dock) {
    if (!rootEl || mode !== 'onscreen') return;
    previewing = true;
    activeField = null;
    // No focused field in a preview → no inline completion ghost. Drop any ghost
    // left over from a field we were just typing in (e.g. leaving a worldview
    // card for the topic list) so it doesn't linger over the dock.
    if (ghostField) { ghostField.removeEventListener('scroll', repositionGhost); ghostField = null; }
    clearGhost();
    page = 'letters';
    shiftState = 'off';
    rootEl.classList.remove('kbd-no-hide'); // Settings preview keeps Hide
    setDock(dock);
    const dlg = document.getElementById('settingsDialog');
    const host = (dlg && dlg.open) ? dlg : document.body;
    if (rootEl.parentNode !== host) host.appendChild(rootEl);
    renderRows();
    rootEl.classList.remove('hidden');
    document.body.classList.add('kbd-open');
}

export function previewHide() {
    if (!previewing) return;
    previewing = false;
    if (!activeField) hide();
}

// Programmatically dismiss the keyboard (used by a panel's close path, where we
// keep the keyboard up when focus moves to in-panel buttons but must take it
// down once the panel itself closes). Unlike the toolbar Hide button this does
// not suppress the next click — the caller is already closing the panel.
export function hideKeyboard() {
    previewing = false;
    hide();
}

// Explicitly summon the keyboard for a field, without relying on a `focusin`
// event. Normally the keyboard appears as a side effect of the field gaining
// focus (the document `focusin` listener → show()), but that event is not
// guaranteed to fire: `.focus()` is a no-op (dispatches nothing) when the field
// is already the active element, and a focus race after an auto-resume can
// swallow it — leaving the field focused with no keyboard. Callers that open a
// keyboard-backed surface (the "In my own words" composer) call this so the
// keyboard shows deterministically. No-op in physical mode. show() is idempotent,
// so a real focusin firing too just re-renders harmlessly. (Ken, July 2026.)
export function showFor(field) {
    if (mode !== 'onscreen' || !field) return;
    show(field);
}

export function getMode() {
    return mode;
}

// Accept whatever inline ghost completion is currently showing, committing it
// into the active field (no trailing space). Used by the composer's Speak /
// Reframe so a pending prediction is included rather than dropped (Ken, June 29
// 2026 — "What is your n" + ghost "name" → Speak should say "What is your name").
// No-op (returns false) when nothing is pending.
export function acceptPendingGhost() {
    return acceptGhost();
}

// --- layout / dock-position settings (live-applied from Settings) -----------

export function setSideLayout(id) {
    if (!LAYOUTS[id]) return;
    sideLayoutId = id;
    if (visible() && currentDock === 'side' && page === 'letters') renderRows();
}

export function setBottomLayout(id) {
    if (!LAYOUTS[id]) return;
    bottomLayoutId = id;
    if (visible() && currentDock === 'bottom' && page === 'letters') renderRows();
}

export function setSideDockPosition(pos) {
    sideDockPosition = pos === 'left' ? 'left' : 'right';
    if (visible() && currentDock === 'side') setDock('side');
}

// The user's single dock choice ('side' | 'bottom'), applied to every typing
// context. If the keyboard is showing a real field, re-dock it live.
export function setKeyboardDock(dock) {
    keyboardDock = dock === 'side' ? 'side' : 'bottom';
    if (visible() && activeField) { setDock(keyboardDock); renderRows(); }
}
