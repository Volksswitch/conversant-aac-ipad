/* Express Panel editor (Settings → Express Panel) — June 26 2026
 *
 * Edits the single ORDERED, TYPED item list backing the Express Panel (Ken's
 * chosen model: one list, each item tagged phrase / partner / feeling; the item's
 * position = its slot in the panel grid, so reordering re-maps the layout). A
 * starting layout is provided (express-items.DEFAULT_ITEMS) and "Reset to default"
 * restores it. The list persists via the express-panel.js model (data folder +
 * cache), so customizations follow the user across devices.
 *
 * Partner items may be picked from People I Know (the relationship graph) or typed
 * free-form (Ken: partners "may be" known people but need not be). A picked person
 * carries their personId + name + nickname so the conversation can use their
 * preferred term of address.
 *
 * Inserting in place (Ken): each row has a "＋" button that opens an inline
 * Phrase / Partner / Feeling picker RIGHT THERE; choosing a type inserts the new
 * item above that row and focuses it — no scrolling up to a toolbar and back. The
 * toolbar's add buttons append to the end (and seed an empty list).
 *
 * Editing rules: structural changes (add / delete / reorder / pick a person)
 * re-render the editor; plain text edits commit WITHOUT re-rendering so the field
 * keeps focus while typing. Every change persists and calls onChange so the live
 * panel updates immediately.
 */

import * as expressPanel from './express-panel.js';
import * as relationships from './relationships.js';
import * as keyboard from './keyboard.js';
import { CATEGORIES, INFLUENCER_COLORS, FEELING_PRESETS, makeId } from './express-items.js';
import { confirmDanger } from './confirm-dialog.js';

let container = null;
let onChangeCb = null;
let current = [];
// The id of the row whose inline insert picker is open (null = none). And the id
// of a just-added row to focus + scroll into view after the next render, so the
// user can type immediately without hunting for the new row.
let pickerForId = null;
let pendingFocusId = null;

export function init(el, opts = {}) {
    container = el;
    onChangeCb = opts.onChange || null;
}

function commit(rerender) {
    expressPanel.setItems(current);
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

function newItem(type) {
    if (type === 'partner') return { id: makeId(), type: 'partner', name: '', nickname: '' };
    if (type === 'feeling') return { id: makeId(), type: 'feeling', text: '' };
    return { id: makeId(), type: 'phrase', text: '', cat: 'back' };
}

// Insert a new item of `type` at `at` (or append when `at` is null/-1), then
// focus it after the re-render.
function addAt(type, at) {
    const item = newItem(type);
    if (Number.isInteger(at) && at >= 0) current.splice(at, 0, item);
    else current.push(item);
    pickerForId = null;
    pendingFocusId = item.id;
    commit(true);
}

function buildToolbar() {
    const bar = document.createElement('div');
    bar.className = 'ee-toolbar';

    const addItem = (label, type) => {
        const b = mkBtn(label, 'ee-add');
        b.addEventListener('click', () => addAt(type, null)); // append at end + focus
        bar.appendChild(b);
    };
    addItem('+ Phrase', 'phrase');
    addItem('+ Partner', 'partner');
    addItem('+ Feeling', 'feeling');

    const reset = mkBtn('Reset to default', 'ee-reset');
    reset.addEventListener('click', async () => {
        const ok = await confirmDanger({
            title: 'Reset the Express Panel?',
            body: 'This replaces your edited list with the default starting layout. Your customizations will be lost.',
            confirmLabel: 'Reset to default',
            cancelLabel: 'Keep mine',
        });
        if (!ok) return;
        pickerForId = null;
        expressPanel.resetItems();
        if (onChangeCb) onChangeCb();
        render();
    });
    bar.appendChild(reset);
    return bar;
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

// Color control. A phrase's color is the only effect of its "category", so the
// user picks the BUTTON COLOR directly (the category names are hidden — they mean
// nothing to the user). Partner and Feeling have one fixed color per type, shown
// as a single, non-editable swatch so the available color is still visible.
function colorControl(item) {
    const wrap = document.createElement('div');
    wrap.className = 'ee-swatches';
    if (item.type === 'phrase') {
        Object.keys(CATEGORIES).forEach((key, idx) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'ee-swatch' + (item.cat === key ? ' ee-swatch-on' : '');
            b.style.background = CATEGORIES[key].color;
            b.title = 'Button color';
            b.setAttribute('aria-label', `Button color ${idx + 1}`);
            b.setAttribute('aria-pressed', String(item.cat === key));
            b.addEventListener('click', () => {
                item.cat = key;
                wrap.querySelectorAll('.ee-swatch').forEach((s) => {
                    s.classList.remove('ee-swatch-on');
                    s.setAttribute('aria-pressed', 'false');
                });
                b.classList.add('ee-swatch-on');
                b.setAttribute('aria-pressed', 'true');
                commit(false); // save + live-update the panel; no editor re-render
            });
            wrap.appendChild(b);
        });
    } else {
        const c = INFLUENCER_COLORS[item.type] || {};
        const sw = document.createElement('span');
        sw.className = 'ee-swatch ee-swatch-static';
        sw.style.background = c.color || '#888';
        sw.title = `Button color (fixed for ${item.type})`;
        sw.setAttribute('aria-label', 'Button color (fixed)');
        wrap.appendChild(sw);
    }
    return wrap;
}

// Inline insert picker shown directly above a row when its ＋ is tapped: choose a
// type and the new item is inserted right there (index `at`), then focused.
function buildInsertBar(at) {
    const bar = document.createElement('div');
    bar.className = 'ee-insertbar';
    bar.appendChild(Object.assign(document.createElement('span'), { className: 'ee-insertbar-label', textContent: 'Insert here:' }));
    [['Phrase', 'phrase'], ['Partner', 'partner'], ['Feeling', 'feeling']].forEach(([label, type]) => {
        const b = mkBtn(label, 'ee-add');
        b.addEventListener('click', () => addAt(type, at));
        bar.appendChild(b);
    });
    const cancel = mkBtn('✕', 'ee-insertbar-cancel');
    cancel.title = 'Cancel';
    cancel.addEventListener('click', () => { pickerForId = null; render(); });
    bar.appendChild(cancel);
    return bar;
}

function buildRow(item, i) {
    const row = document.createElement('div');
    row.className = `ee-row ee-${item.type}`;
    row.dataset.id = item.id;

    // Insert button: open the inline type picker above this row (tap again closes).
    const ins = mkBtn('＋', 'ee-ins');
    if (item.id === pickerForId) ins.classList.add('ee-ins-on');
    ins.title = 'Insert a new item above this row';
    ins.setAttribute('aria-label', 'Insert a new item above this row');
    ins.addEventListener('click', () => {
        pickerForId = (pickerForId === item.id) ? null : item.id;
        render();
    });
    row.appendChild(ins);

    // Type badge.
    const badge = document.createElement('span');
    badge.className = `ee-badge ee-badge-${item.type}`;
    badge.textContent = item.type;
    row.appendChild(badge);

    // Type-specific fields.
    const fields = document.createElement('div');
    fields.className = 'ee-fields';

    if (item.type === 'phrase') {
        fields.appendChild(textInput(item.text, 'Phrase to speak', (v) => { item.text = v; commit(false); }));
        // The category only sets the button color, and its names ("Affirm / deny"…)
        // mean nothing to the user (Ken) — so pick by COLOR, not by category name.
        fields.appendChild(colorControl(item));
    } else if (item.type === 'partner') {
        // Pick from People I Know. The button in the panel shows their nickname if
        // set, their name if not. Name and nickname come entirely from the selection.
        const sel = document.createElement('select');
        sel.className = 'ee-name-select';
        const customOpt = document.createElement('option');
        customOpt.value = ''; customOpt.textContent = '— Choose a person —';
        sel.appendChild(customOpt);
        relationships.listPeople().forEach((p) => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = p.name + (p.nickname ? ` (${p.nickname})` : '');
            if (p.id === item.personId) o.selected = true;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            if (sel.value) {
                const p = relationships.getPerson(sel.value);
                item.personId = p.id;
                item.name = p.name;
                item.nickname = p.nickname || '';
            } else {
                delete item.personId;
                item.name = '';
                item.nickname = '';
            }
            commit(false);
        });
        fields.appendChild(sel);
        fields.appendChild(colorControl(item)); // fixed color for this type, shown
    } else { // feeling
        const inp = textInput(item.text, 'Feeling (e.g. Happy)', (v) => { item.text = v; commit(false); });
        inp.setAttribute('list', 'ee-feeling-presets');
        fields.appendChild(inp);
        fields.appendChild(colorControl(item)); // fixed color for this type, shown
    }
    row.appendChild(fields);

    // Reorder + delete.
    const tools = document.createElement('div');
    tools.className = 'ee-tools';
    // Save this item and take the on-screen keyboard down so the panel/list is
    // visible again (Ken, July 2026). Edits already auto-commit on input; this is
    // the explicit "I'm done with this item" that dismisses the keyboard — the
    // Hide button having been removed, this is how an on-screen-keyboard user gets
    // the keyboard out of the way. No-op on the keyboard in physical mode.
    const save = mkBtn('Save', 'ee-save');
    save.title = 'Save this item and hide the on-screen keyboard';
    save.addEventListener('click', () => { commit(false); keyboard.hideKeyboard(); });
    const up = mkBtn('↑'); up.disabled = i === 0;
    up.addEventListener('click', () => { [current[i - 1], current[i]] = [current[i], current[i - 1]]; commit(true); });
    const down = mkBtn('↓'); down.disabled = i === current.length - 1;
    down.addEventListener('click', () => { [current[i + 1], current[i]] = [current[i], current[i + 1]]; commit(true); });
    const del = mkBtn('✕', 'ee-del');
    del.addEventListener('click', () => {
        if (current[i].id === pickerForId) pickerForId = null;
        current.splice(i, 1);
        commit(true);
    });
    tools.append(save, up, down, del);
    row.appendChild(tools);

    return row;
}

export function render() {
    if (!container) return;
    current = expressPanel.getItems();
    if (pickerForId && !current.some((it) => it.id === pickerForId)) pickerForId = null;
    container.innerHTML = '';
    container.appendChild(buildToolbar());

    const hint = document.createElement('p');
    hint.className = 'setting-hint ee-hint';
    hint.textContent = 'The buttons above add to the end. To insert somewhere specific, tap ＋ on a row.';
    container.appendChild(hint);

    // datalist of suggested feelings (shared by all feeling rows).
    const dl = document.createElement('datalist');
    dl.id = 'ee-feeling-presets';
    FEELING_PRESETS.forEach((f) => { const o = document.createElement('option'); o.value = f; dl.appendChild(o); });
    container.appendChild(dl);

    const list = document.createElement('div');
    list.className = 'ee-list';
    if (!current.length) {
        const p = document.createElement('p');
        p.className = 'setting-hint';
        p.textContent = 'No items yet — add a phrase, partner, or feeling above.';
        list.appendChild(p);
    } else {
        current.forEach((item, i) => {
            if (item.id === pickerForId) list.appendChild(buildInsertBar(i)); // picker above the row
            list.appendChild(buildRow(item, i));
        });
    }
    container.appendChild(list);

    // Focus + reveal a just-added row so the user can type in place.
    if (pendingFocusId) {
        const row = list.querySelector(`.ee-row[data-id="${pendingFocusId}"]`);
        pendingFocusId = null;
        if (row) {
            row.scrollIntoView({ block: 'nearest' });
            (row.querySelector('.ee-fields input') || row.querySelector('.ee-fields select'))?.focus();
        }
    }
}
