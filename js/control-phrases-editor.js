/* Control phrases editor (Settings → Controls) — Ken, June 28 2026
 *
 * Edits the spoken text behind the persistent override controls and the
 * opener / wind-down / closing cards (control-phrases.js): the "Hold on" and
 * "Pardon?" phrases (single strings) and the "Start conversation" openers, the
 * "Wind down" statements, and the closings/goodbyes (ordered lists). "Say again"
 * has no editable phrase — it re-speaks the user's own last words — so it's shown
 * as a read-only note.
 *
 * Reuses the Express-editor (.ee-*) styles for rows/buttons. Plain text edits
 * commit WITHOUT re-rendering so the field keeps focus while typing; structural
 * changes (add / delete / reorder / reset) re-render. Every change persists via
 * the model and calls onChange so the engine re-reads the openers/closers.
 */

import * as model from './control-phrases.js';
import { confirmDanger } from './confirm-dialog.js';

let container = null;
let onChangeCb = null;
let data = null;            // working copy { holdOn, pardon, openers, windDowns, closings }
let pendingFocus = null;    // { key, index } of a just-added list row to focus

export function init(el, opts = {}) {
    container = el;
    onChangeCb = opts.onChange || null;
}

function commit(rerender) {
    model.setPhrases(data);
    if (onChangeCb) onChangeCb();
    if (rerender) render();
}

function mkBtn(label, cls) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    if (cls) b.className = cls;
    return b;
}

function textInput(value, placeholder, oninput) {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value || '';
    inp.placeholder = placeholder || '';
    inp.autocomplete = 'off';
    inp.addEventListener('input', () => oninput(inp.value));
    return inp;
}

// A single-phrase control (Hold on / Pardon?): label + one text field.
function singleSection(title, desc, key) {
    const sec = document.createElement('div');
    sec.className = 'setting-group cpe-section';
    sec.appendChild(Object.assign(document.createElement('label'), { textContent: title }));
    const row = document.createElement('div');
    row.className = 'ee-row ee-phrase';
    row.appendChild(textInput(data[key], 'What to say', (v) => { data[key] = v; commit(false); }));
    sec.appendChild(row);
    sec.appendChild(Object.assign(document.createElement('p'), { className: 'setting-hint', textContent: desc }));
    return sec;
}

// An ordered list of cards (openers / closers): rows with text + ↑ ↓ ✕, plus Add.
function listSection(title, desc, key) {
    const sec = document.createElement('div');
    sec.className = 'setting-group cpe-section';
    sec.appendChild(Object.assign(document.createElement('label'), { textContent: title }));
    sec.appendChild(Object.assign(document.createElement('p'), { className: 'setting-hint', textContent: desc }));

    const list = document.createElement('div');
    list.className = 'ee-list';
    const arr = data[key];
    arr.forEach((text, i) => {
        const row = document.createElement('div');
        row.className = 'ee-row ee-phrase';
        row.appendChild(textInput(text, 'Card text', (v) => { arr[i] = v; commit(false); }));

        const tools = document.createElement('div');
        tools.className = 'ee-tools';
        const up = mkBtn('↑'); up.disabled = i === 0;
        up.addEventListener('click', () => { [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]]; commit(true); });
        const down = mkBtn('↓'); down.disabled = i === arr.length - 1;
        down.addEventListener('click', () => { [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]]; commit(true); });
        const del = mkBtn('✕', 'ee-del');
        del.disabled = arr.length <= 1; // never leave the list empty (no cards to show)
        del.addEventListener('click', () => { arr.splice(i, 1); commit(true); });
        tools.append(up, down, del);
        row.appendChild(tools);
        list.appendChild(row);
    });
    sec.appendChild(list);

    const add = mkBtn('+ Add', 'ee-add');
    add.addEventListener('click', () => { arr.push(''); pendingFocus = { key, index: arr.length - 1 }; commit(true); });
    sec.appendChild(add);
    return sec;
}

export function render() {
    if (!container) return;
    data = model.getPhrases();
    container.innerHTML = '';

    container.append(
        singleSection('“Hold on” phrase', 'Spoken when you tap Hold on — a brief beat to hold the floor while you choose.', 'holdOn'),
        singleSection('“Ask them to repeat” phrase', 'Spoken when you tap Ask them to repeat — asks the partner to say again what they said.', 'pardon'),
        listSection('Openers (Start conversation)',
            'The cards shown when you tap Start conversation. Use {name} where the person’s name should go — it fills in when a Partner is selected and is left out otherwise.', 'openers'),
        listSection('Wind-down statements (Wind down)',
            'The cards shown when you tap Wind down — they signal you’d like to end the conversation without saying goodbye yet (“I should get going.”). Selecting one brings up the closings below.', 'windDowns'),
        listSection('Closings (goodbyes)',
            'The goodbyes (“Bye!”, “Take care!”) that appear after you pick a wind-down statement.', 'closings'),
        singleSection('“One more thing” phrase',
            'Shown beside the goodbyes when the OTHER person starts wrapping up, so you can hold them a moment instead of only being able to say goodbye. Selecting it speaks the phrase and keeps the conversation open.',
            'declineClosing'),
    );

    // "Say again" — read-only note (no editable phrase).
    const note = document.createElement('p');
    note.className = 'setting-hint cpe-note';
    note.textContent = '“Say again” isn’t listed here — it re-speaks your own last words exactly, so there’s nothing to edit.';
    container.appendChild(note);

    const reset = mkBtn('Reset to default', 'ee-reset');
    reset.addEventListener('click', async () => {
        const ok = await confirmDanger({
            title: 'Reset control phrases?',
            body: 'This restores the default wording for Hold on, Pardon?, the openers, the wind-down statements and the closings. Your edits will be lost.',
            confirmLabel: 'Reset to default',
            cancelLabel: 'Keep mine',
        });
        if (!ok) return;
        model.resetPhrases();
        if (onChangeCb) onChangeCb();
        render();
    });
    container.appendChild(reset);

    // Focus a just-added list row so the user can type immediately.
    if (pendingFocus) {
        const sel = `.ee-list`;
        const lists = container.querySelectorAll(sel);
        // The .ee-list order matches the listSection order: openers, windDowns, closings.
        const order = { openers: 0, windDowns: 1, closings: 2 };
        const idx = order[pendingFocus.key] ?? 0;
        const rows = lists[idx]?.querySelectorAll('.ee-row input');
        const inp = rows && rows[pendingFocus.index];
        pendingFocus = null;
        if (inp) { inp.scrollIntoView({ block: 'nearest' }); inp.focus(); }
    }
}
