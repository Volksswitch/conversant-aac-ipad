/* AAC Conversation Assistant — worldview questionnaire UI (Build Step 2)
 *
 * Renders the "About Me" questionnaire over the conversation screen. Reads and
 * writes through worldview.js (the Step 1 model). No LLM wiring here — that is
 * Build Step 3.
 *
 * Flow (Implementation-Plan §7):
 *   Home    — intro, "suggested next" (gaps-driven), module list with progress,
 *             and Restart.
 *   Module  — a chunk: every field in one module as an answerable card
 *             (answer / in my own words / prefer not to say / skip / edit).
 *
 * Per the resolved decisions: nothing is required, no fixed chunk size, every
 * answer optional and revisable. Each card carries an in-flow "Speak" control
 * (CLAUDE.md Build Step 2 design intent) — opt-in, never automatic.
 */

import * as wv from './worldview.js';
import * as rel from './relationships.js';
import { speak } from './tts.js';
import * as storage from './storage.js';
import * as keyboard from './keyboard.js';
import { confirmDanger } from './confirm-dialog.js';

let contentEl;

// Scroll position of the People list captured when "Edit" is pressed, so that
// returning from the edit form (Save/Cancel) restores exactly where the list
// was rather than jumping to the top (Ken, June 19 2026). Consumed (and cleared)
// by the next non-editing renderPeople(); null means a fresh entry → top.
let peopleReturnScroll = null;

// Move keyboard focus to the first answerable control within `scope`
// (a chip or a text input — whichever comes first in the card).
function focusFirstField(scope) {
    const first = (scope || contentEl).querySelector('.wv-card .wv-chip, .wv-card .wv-text');
    if (first) first.focus();
}

// --- tiny DOM helper --------------------------------------------------------

function el(tag, props = {}, children = []) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
        if (v == null) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        // NOTE: no raw-HTML branch. Everything rendered through el() is set as
        // textContent, so user- and AI-derived strings can't inject markup (SEC-8).
        // If a static HTML fragment is ever genuinely needed, build it from real
        // elements rather than reintroducing an innerHTML sink here.
        else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
        else n.setAttribute(k, v);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
        if (c == null || c === false) continue;
        n.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
    return n;
}

// --- value formatting (display + speak) -------------------------------------

function formatValue(value) {
    if (value == null || value === '') return '';
    if (Array.isArray(value)) {
        return value.map((v) => (v && typeof v === 'object'
            ? Object.values(v).filter(Boolean).join(' — ')
            : v)).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') return Object.values(value).filter(Boolean).join(' — ');
    return String(value);
}

// --- lifecycle --------------------------------------------------------------

export function init() {
    // About Me is now an ordinary Settings tab (Ken, July 2026) — it renders into
    // its tab-panel like every other tab, with no title bar and no "Done" button.
    // The Settings panel's shared "Close" button closes it and returns to the
    // conversation. So there's no separate overlay to show/hide/inert here.
    contentEl = document.getElementById('worldviewContent');
}

// Show the on-screen keyboard in the user's configured dock and keep it up for
// the whole About Me session (Ken, June 30 2026). A non-typing preview when no
// field is focused (the home/topic list); focusing a card's field upgrades it to
// a typing keyboard via the global focusin handler. No-op in physical-keyboard
// mode (previewShow guards on mode), so nothing shows there.
function showDockKeyboard() {
    if (storage.loadKeyboardMode() === 'onscreen') {
        keyboard.previewShow(storage.loadKeyboardDock());
    }
}

// Load the user-owned data + render the questionnaire into the About Me tab
// panel. Called by the Settings tab handler when the About Me tab is activated;
// safe to call again (re-renders home).
export async function open() {
    // Best-effort: make sure the user-owned data folder is restored so answers
    // persist to worldview.json (falls back to the localStorage cache if not).
    try { await storage.restoreDataFolder(); } catch { /* no stored handle yet */ }
    try {
        await wv.loadRegistry();
    } catch {
        contentEl.innerHTML = '<p class="wv-intro">Could not load the question set.</p>';
        return;
    }
    await wv.load();
    // If the folder was just restored and answers were cache-only, promote
    // them to the on-disk worldview.json.
    try { await wv.syncToFolder(); } catch { /* best-effort */ }
    // Relationship graph: load + reconcile so the People section is ready.
    try { await rel.load(); } catch { /* cache/empty graph */ }
    try { await rel.syncToFolder(); } catch { /* best-effort */ }
    renderHome();
}

// --- Home -------------------------------------------------------------------

// Shown on the About Me home when no data folder is assigned. Without a folder,
// answers live only in this browser's cache — they don't travel with the user
// and are lost if browser data is cleared. The button is a fresh user gesture
// (required by the File System Access picker), so we prompt here rather than
// auto-popping the picker from open() where the gesture would be consumed by
// the awaits before render.
function renderFolderPrompt() {
    const card = el('div', { class: 'wv-folder-prompt' }, [
        el('p', { class: 'wv-folder-prompt-text', text:
            'Your answers are being saved only in this browser. Choose a data folder '
            + 'to save them to a file you can back up and move between devices.' }),
        el('button', {
            class: 'wv-folder-prompt-btn',
            text: 'Choose data folder',
            onclick: async (e) => {
                e.currentTarget.disabled = true;
                try {
                    await storage.pickDataFolder();
                    // File-in-folder wins (v0.2.25): adopt an existing
                    // worldview.json, or promote cache-only answers to a new one.
                    try { await wv.syncToFolder(); } catch { /* best-effort */ }
                    renderHome();   // banner clears; progress reflects adopted data
                } catch (err) {
                    e.currentTarget.disabled = false;   // AbortError = user cancelled
                }
            }
        })
    ]);
    contentEl.append(card);
}

// Gaps-driven "Questions worth answering" (Ken, June 28 2026 — restores a
// surface for the progressive-profiling gaps log, which had no UI after v0.2.31
// removed the old "Suggested next" section). Distinct from the Topics list: it
// shows ONLY facts the AI actually needed but didn't have during real
// conversations (worldview.recordGaps from missing_facts), most-asked first, so
// answering these has the biggest payoff. Renders nothing when there are no
// open gaps (e.g. before any live-API conversations), so it never duplicates the
// topic pages.
function renderGaps() {
    const items = [];
    const seen = new Set();
    for (const g of wv.listGaps()) {
        if (wv.getState(g.key) !== 'unanswered') continue;   // answered since it was logged
        if (seen.has(g.key)) continue;
        const meta = wv.fieldMeta(g.key);
        if (!meta) continue;                                  // gap key not in the registry
        seen.add(g.key);
        items.push({ meta, count: g.count });
    }
    if (!items.length) return;

    contentEl.append(el('h3', { class: 'wv-section-title', text: 'Questions worth answering' }));
    contentEl.append(el('p', { class: 'wv-intro', text:
        'These came up in real conversations but I didn’t have the answer. Filling them in gives the biggest payoff.' }));
    for (const { meta, count } of items) {
        const note = count > 1 ? `Came up ${count} times` : 'Came up once';
        contentEl.append(el('button', { class: 'wv-module-row',
            onclick: () => renderModule(meta.moduleId, meta.key) }, [
            el('div', { class: 'wv-module-main' }, [
                el('div', { class: 'wv-module-title', text: meta.q }),
                el('div', { class: 'wv-module-meta', text: `${note} · ${meta.moduleTitle}` })
            ]),
            el('div', { class: 'wv-chevron', text: '›' })
        ]));
    }
}

function renderHome() {
    // Keep the on-screen keyboard up the entire time the About Me tab is open (Ken,
    // June 30 2026), including on this home/topic list which has no text field, so
    // the user can enter/modify entries without it appearing and disappearing. The
    // Settings dialog reserves the dock region, so the keyboard just fills that
    // reserved band — it never covers the topic list. Leaving the tab / closing
    // Settings takes it down (handleSettingsTab / the Close button).
    showDockKeyboard();
    contentEl.scrollTop = 0;
    contentEl.innerHTML = '';

    contentEl.append(el('p', { class: 'wv-intro', text:
        'Answer as many or as few as you like, whenever you like. Nothing here is required, and you can change or remove any answer later.' }));

    if (!storage.hasDataFolder()) renderFolderPrompt();

    renderGaps();

    contentEl.append(el('h3', { class: 'wv-section-title', text: 'Topics' }));
    const registry = wv.getRegistry();
    for (const mod of wv.getModules()) {
        const pct = mod.total ? Math.round((mod.answered / mod.total) * 100) : 0;
        const meta = `${mod.answered} of ${mod.total} answered`
            + (mod.declined ? ` · ${mod.declined} skipped` : '');
        // Show a lock on modules where every field is private by default
        const fullMod = registry.modules.find((m) => m.id === mod.id);
        const allPrivate = fullMod && fullMod.fields.every((f) => f.defaultPrivacy === 'private');
        const titleText = mod.title + (allPrivate ? ' 🔒' : '');
        contentEl.append(el('button', { class: 'wv-module-row', onclick: () => renderModule(mod.id) }, [
            el('div', { class: 'wv-module-main' }, [
                el('div', { class: 'wv-module-title', text: titleText }),
                el('div', { class: 'wv-module-meta', text: meta }),
                el('div', { class: 'wv-progress' }, [
                    el('div', { class: 'wv-progress-fill', style: `width:${pct}%` })
                ])
            ]),
            el('div', { class: 'wv-chevron', text: '›' })
        ]));
    }

    // People & relationships — a graph, not Q&A, so it has its own editor
    // (relationships.js) rather than a questionnaire module.
    contentEl.append(el('h3', { class: 'wv-section-title', text: 'People & relationships' }));
    const n = rel.count();
    const peopleMeta = n
        ? `${n} ${n === 1 ? 'person' : 'people'} added`
        : 'Add family, friends, and pets';
    contentEl.append(el('button', { class: 'wv-module-row', onclick: renderPeople }, [
        el('div', { class: 'wv-module-main' }, [
            el('div', { class: 'wv-module-title', text: 'People in Your Life' }),
            el('div', { class: 'wv-module-meta', text: peopleMeta })
        ]),
        el('div', { class: 'wv-chevron', text: '›' })
    ]));

    contentEl.append(el('div', { class: 'wv-home-footer' }, [
        el('button', { class: 'wv-btn wv-btn-danger', text: 'Restart — clear all answers', onclick: onRestart })
    ]));
}

async function onRestart() {
    const ok = await confirmDanger({
        title: 'Clear everything?',
        body: 'This permanently deletes every answer and all the people you have added. This cannot be undone.',
        confirmLabel: 'Yes, clear it all',
        cancelLabel: 'Keep my answers'
    });
    if (!ok) return;
    await wv.resetAll();
    await rel.resetAll();
    renderHome();
}

// --- People (relationship graph) --------------------------------------------

// People are nodes + edges (relationships.js), not questionnaire answers, so
// they get a dedicated editor. The UI edits me->person relationships; the data
// model also supports person<->person edges for later.
function renderPeople(editingId = null) {
    contentEl.innerHTML = '';

    contentEl.append(el('button', { class: 'wv-back', text: '‹ All topics', onclick: renderHome }));
    contentEl.append(el('h3', { class: 'wv-page-title', text: 'People in Your Life' }));
    contentEl.append(el('p', { class: 'wv-intro', text:
        'Add the people (and pets) who matter to you — name, how they relate to you, '
        + 'and anything worth knowing. Mark someone private and the assistant will know about them '
        + 'but won\'t bring them up unless you choose a response that does.' }));

    const people = rel.listPeople();
    for (const p of people) {
        contentEl.append(editingId === p.id ? buildPersonForm(p) : buildPersonCard(p));
    }

    contentEl.append(el('h3', { class: 'wv-section-title', text: 'Add someone' }));
    contentEl.append(buildPersonForm(null));

    // No bottom "back to topics" button — the "‹ All topics" link at the top of
    // the page is the single, unambiguous way back (Ken, July 3 2026).

    // Restore scroll after the rebuild:
    //  - editing: bring the edit form into view (the user just tapped Edit);
    //  - returning from an edit (Save/Cancel): go back to where the list was
    //    when Edit was pressed (heights match — the form became a card again);
    //  - fresh entry from the home screen: top.
    if (editingId) {
        const form = document.getElementById('wvpersonform-' + editingId);
        if (form) form.scrollIntoView({ block: 'center' });
    } else if (peopleReturnScroll != null) {
        contentEl.scrollTop = peopleReturnScroll;
        peopleReturnScroll = null;
    } else {
        contentEl.scrollTop = 0;
    }
}

function buildPersonCard(p) {
    const card = el('div', { class: 'wv-card', id: 'wvperson-' + p.id });

    // Title line: "Name" or "Name "nickname" (Relationship)"
    const titleParts = [p.name || '(unnamed)'];
    if (p.nickname) titleParts.push(`"${p.nickname}"`);
    if (p.relationship) titleParts.push(`(${p.relationship})`);

    const head = el('div', { class: 'wv-card-head' }, [
        el('div', { class: 'wv-question', text: titleParts.join(' ') })
    ]);
    if (p.private) head.append(el('span', { class: 'wv-badge wv-badge-private', text: '🔒 Private' }));
    card.append(head);

    // Attribute tags (lives with me, etc.)
    if (p.livesWithMe) {
        card.append(el('div', { class: 'wv-person-tags' }, [
            el('span', { class: 'wv-person-tag wv-person-tag-lives', text: '🏠 Lives with me' })
        ]));
    }

    if (p.about) card.append(el('p', { class: 'wv-person-about', text: p.about }));

    card.append(el('div', { class: 'wv-actions' }, [
        el('button', { class: 'wv-btn wv-btn-link', text: 'Edit',
            onclick: () => { peopleReturnScroll = contentEl.scrollTop; renderPeople(p.id); } }),
        el('button', { class: 'wv-btn wv-btn-link', text: 'Remove',
            onclick: async () => {
                const ok = await confirmDanger({
                    title: `Remove ${p.name || 'this person'}?`,
                    body: 'This removes them and your relationship from your profile. This cannot be undone.',
                    confirmLabel: 'Remove',
                    cancelLabel: 'Cancel'
                });
                if (!ok) return;
                await rel.removePerson(p.id);
                renderPeople();
            } })
    ]));
    return card;
}

// Standard relationships offered in the People editor, grouped for scanning.
// "Other…" reveals a free-text field. One relationship per person for now
// (the data model stores a single me->person edge); multiple relationships
// with one person — e.g. "cousin" + "wife" — is a deliberate later refinement.
const REL_GROUPS = [
    { label: 'Family', items: ['Mother', 'Father', 'Sister', 'Brother', 'Daughter', 'Son', 'Grandmother', 'Grandfather', 'Aunt', 'Uncle', 'Cousin', 'Niece', 'Nephew'] },
    { label: 'Partner', items: ['Wife', 'Husband', 'Partner'] },
    { label: 'Friends & social', items: ['Friend', 'Close friend', 'Best friend', 'Roommate', 'Neighbor', 'Classmate', 'Coworker'] },
    { label: 'Care & support', items: ['Caregiver', 'Support worker', 'Teacher', 'Boss', 'Doctor', 'Therapist'] },
    { label: 'Pet', items: ['Pet'] }
];
const REL_KNOWN = new Set(REL_GROUPS.flatMap((g) => g.items.map((s) => s.toLowerCase())));
const OTHER = '__other__';

// Edit form for an existing person, or the blank "add someone" form when
// `existing` is null.
function buildPersonForm(existing) {
    const card = el('div', { class: 'wv-card wv-person-form',
        id: existing ? 'wvpersonform-' + existing.id : null });

    const nameIn = el('input', { type: 'text', class: 'wv-text', placeholder: 'Name',
        value: existing ? existing.name : '' });

    const nicknameIn = el('input', { type: 'text', class: 'wv-text',
        placeholder: 'What you call them — optional (Mom, J.J., Grandpa…)',
        value: existing ? existing.nickname : '' });

    // Relationship — standard list + "Other…" (free text).
    const relSelect = el('select', { class: 'wv-select' });
    relSelect.append(el('option', { value: '' }, 'Relationship…'));
    for (const g of REL_GROUPS) {
        const og = el('optgroup', { label: g.label });
        for (const it of g.items) og.append(el('option', { value: it }, it));
        relSelect.append(og);
    }
    relSelect.append(el('option', { value: OTHER }, 'Other…'));

    const otherIn = el('input', { type: 'text', class: 'wv-text', placeholder: 'Relationship (your words)' });
    const otherWrap = el('div', { class: 'wv-rel-other' }, [otherIn]);
    const syncOther = () => { otherWrap.style.display = relSelect.value === OTHER ? '' : 'none'; };
    relSelect.addEventListener('change', syncOther);

    if (existing && existing.relationship) {
        const r = existing.relationship;
        if (REL_KNOWN.has(r.toLowerCase())) {
            relSelect.value = REL_GROUPS.flatMap((g) => g.items).find((s) => s.toLowerCase() === r.toLowerCase());
        } else {
            relSelect.value = OTHER;
            otherIn.value = r;
        }
    }
    syncOther();
    const getRelationship = () => (relSelect.value === OTHER ? otherIn.value.trim() : relSelect.value);

    const aboutIn = el('input', { type: 'text', class: 'wv-text', placeholder: 'Anything worth knowing (optional)',
        value: existing ? existing.about : '' });

    const livesId = 'wvlives-' + (existing ? existing.id : 'new');
    const livesCheck = el('input', { type: 'checkbox', id: livesId });
    if (existing && existing.livesWithMe) livesCheck.checked = true;
    const livesRow = el('label', { class: 'wv-person-checkbox-row', for: livesId }, [
        livesCheck, el('span', { text: 'Lives with me' })
    ]);

    const privId = 'wvpriv-' + (existing ? existing.id : 'new');
    const privCheck = el('input', { type: 'checkbox', id: privId });
    if (existing && existing.private) privCheck.checked = true;
    const privRow = el('label', { class: 'wv-person-checkbox-row', for: privId }, [
        privCheck, el('span', { text: 'Private — AI knows but won\'t bring them up unprompted' })
    ]);

    card.append(el('div', { class: 'wv-person-fields' }, [nameIn, nicknameIn, relSelect, otherWrap, aboutIn, livesRow, privRow]));

    const save = el('button', { class: 'wv-btn wv-btn-primary', text: existing ? 'Save' : 'Add person',
        onclick: async () => {
            const name = nameIn.value.trim();
            const relationship = getRelationship();
            if (!name && !relationship) return;   // nothing to save
            if (existing) {
                await rel.updatePerson(existing.id, {
                    name, relationship,
                    about: aboutIn.value.trim(),
                    nickname: nicknameIn.value.trim(),
                    livesWithMe: livesCheck.checked,
                    isPrivate: privCheck.checked
                });
            } else {
                await rel.addPerson({
                    name, relationship,
                    about: aboutIn.value.trim(),
                    nickname: nicknameIn.value.trim(),
                    livesWithMe: livesCheck.checked,
                    isPrivate: privCheck.checked
                });
            }
            renderPeople();
        } });

    const actions = el('div', { class: 'wv-actions' }, [save]);
    if (existing) {
        actions.append(el('button', { class: 'wv-btn wv-btn-link', text: 'Cancel', onclick: () => renderPeople() }));
    }
    card.append(actions);
    return card;
}

// --- Module (a chunk of cards) ----------------------------------------------

function renderModule(moduleId, focusKey = null) {
    const mod = wv.getRegistry().modules.find((m) => m.id === moduleId);
    if (!mod) return renderHome();

    contentEl.scrollTop = 0;
    contentEl.innerHTML = '';

    contentEl.append(el('button', { class: 'wv-back', text: '‹ All topics', onclick: renderHome }));
    contentEl.append(el('h3', { class: 'wv-page-title', text: mod.title }));

    // Show module-level note if present (e.g. the "Private by default" notice on A5)
    if (mod.note) {
        contentEl.append(el('p', { class: 'wv-module-note', text: '🔒 ' + mod.note }));
    }

    for (const field of mod.fields) {
        contentEl.append(buildCard(field));
    }
    // No bottom "back to topics" button — the "‹ All topics" link at the top of
    // the page is the single, unambiguous way back (Ken, July 3 2026).

    // Deep-link from the gaps section: jump to a specific field's card and focus
    // it, rather than the module's first field.
    if (focusKey) {
        const card = document.getElementById('wvcard-' + focusKey);
        if (card) {
            card.scrollIntoView({ block: 'center' });
            focusFirstField(card);
            return;
        }
    }
    focusFirstField();
}

function refreshCard(field) {
    const old = document.getElementById('wvcard-' + field.key);
    if (old) old.replaceWith(buildCard(field));
}

// --- Card -------------------------------------------------------------------

function buildCard(field) {
    const state = wv.getState(field.key);
    const card = el('div', { class: 'wv-card', id: 'wvcard-' + field.key });

    const head = el('div', { class: 'wv-card-head' }, [
        el('div', { class: 'wv-question', text: field.q })
    ]);
    if (state === 'answered') head.append(el('span', { class: 'wv-badge wv-badge-answered', text: '✓ Answered' }));
    else if (state === 'declined') head.append(el('span', { class: 'wv-badge wv-badge-declined', text: 'Prefer not to say' }));
    card.append(head);

    // Show a private notice on fields whose value is sent to the AI for context
    // but must not be spoken unless the user selects a response that includes it.
    if (field.defaultPrivacy === 'private') {
        card.append(el('p', { class: 'wv-private-note', text: '🔒 AI uses this for context — only spoken if you choose a response that includes it.' }));
    }

    if (state === 'declined') {
        // Undo restores the prior answer if there was one (decline never destroys
        // it), otherwise it just re-opens the question (Ken, July 2026).
        const hadAnswer = wv.hasStashedAnswer(field.key);
        card.append(el('div', { class: 'wv-actions' }, [
            el('button', { class: 'wv-btn wv-btn-link',
                text: hadAnswer ? 'Undo — bring my answer back' : 'Undo — ask me this again',
                onclick: async () => { await wv.undeclineField(field.key); refreshCard(field); } })
        ]));
        return card;
    }

    card.append(buildInput(field));

    const actions = el('div', { class: 'wv-actions' });
    const current = wv.getField(field.key);
    const speakBtn = el('button', {
        class: 'wv-btn wv-btn-speak',
        text: '🔊 Speak my answer',
        onclick: () => { const v = formatValue(wv.getField(field.key)); if (v) speak(v); }
    });
    if (!formatValue(current)) speakBtn.setAttribute('disabled', 'true');
    actions.append(speakBtn);
    actions.append(el('button', { class: 'wv-btn wv-btn-link', text: 'Prefer not to say',
        onclick: async () => { await wv.declineField(field.key); refreshCard(field); } }));
    card.append(actions);

    return card;
}

// Build the type-appropriate input region and wire saving.
function buildInput(field) {
    const current = wv.getField(field.key);
    const hasOptions = Array.isArray(field.options) && field.options.length > 0;

    if (field.type === 'choice') return buildChoice(field, current);
    if (field.type === 'multi' && hasOptions) return buildMultiChips(field, current);
    if (field.type === 'multi') return buildFreeMulti(field, current);
    if (field.type === 'repeat') return buildRepeat(field, current);
    return buildTextish(field, current);   // text | number
}

function saveAndRefresh(field, value) {
    return wv.setField(field.key, value).then(() => refreshCard(field));
}

// choice — single select chips + "in my own words"
function buildChoice(field, current) {
    const wrap = el('div', { class: 'wv-input' });
    const chips = el('div', { class: 'wv-chips' });
    for (const opt of field.options) {
        chips.append(el('button', {
            class: 'wv-chip' + (current === opt ? ' wv-chip-on' : ''),
            text: opt,
            onclick: () => saveAndRefresh(field, opt)
        }));
    }
    wrap.append(chips);

    // free-text alternative (also shows the current value if it is custom)
    const isCustom = current != null && !field.options.includes(current);
    const input = el('input', { type: 'text', class: 'wv-text', placeholder: 'In my own words…',
        value: isCustom ? current : '' });
    const save = el('button', { class: 'wv-btn wv-btn-primary', text: 'Save',
        onclick: () => { const v = input.value.trim(); if (v) saveAndRefresh(field, v); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    wrap.append(el('div', { class: 'wv-own' }, [input, save]));
    return wrap;
}

// multi with a fixed option list — toggle chips + add your own
function buildMultiChips(field, current) {
    const selected = Array.isArray(current) ? [...current] : [];
    const wrap = el('div', { class: 'wv-input' });
    const chips = el('div', { class: 'wv-chips' });
    const all = [...field.options, ...selected.filter((s) => !field.options.includes(s))];
    for (const opt of all) {
        chips.append(el('button', {
            class: 'wv-chip' + (selected.includes(opt) ? ' wv-chip-on' : ''),
            text: opt,
            onclick: () => {
                const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
                if (next.length) saveAndRefresh(field, next);
                else wv.resetField(field.key).then(() => refreshCard(field));
            }
        }));
    }
    wrap.append(chips);

    const input = el('input', { type: 'text', class: 'wv-text', placeholder: 'Add your own…' });
    const add = el('button', { class: 'wv-btn wv-btn-primary', text: 'Add',
        onclick: () => { const v = input.value.trim(); if (v && !selected.includes(v)) saveAndRefresh(field, [...selected, v]); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add.click(); });
    wrap.append(el('div', { class: 'wv-own' }, [input, add]));
    return wrap;
}

// multi without options — comma-separated free text
function buildFreeMulti(field, current) {
    const wrap = el('div', { class: 'wv-input' });
    const value = Array.isArray(current) ? current.join(', ') : '';
    const input = el('input', { type: 'text', class: 'wv-text', placeholder: 'Separate with commas…', value });
    const save = el('button', { class: 'wv-btn wv-btn-primary', text: 'Save',
        onclick: () => {
            const parts = input.value.split(',').map((s) => s.trim()).filter(Boolean);
            if (parts.length) saveAndRefresh(field, parts);
            else wv.resetField(field.key).then(() => refreshCard(field));
        } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    wrap.append(el('div', { class: 'wv-own' }, [input, save]));
    return wrap;
}

// text | number
function buildTextish(field, current) {
    const wrap = el('div', { class: 'wv-input' });
    const input = el('input', {
        type: field.type === 'number' ? 'text' : 'text',
        class: 'wv-text',
        placeholder: 'Type your answer…',
        value: current != null ? String(current) : ''
    });
    const save = el('button', { class: 'wv-btn wv-btn-primary', text: 'Save',
        onclick: () => { const v = input.value.trim(); if (v) saveAndRefresh(field, v); else wv.resetField(field.key).then(() => refreshCard(field)); } });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') save.click(); });
    wrap.append(el('div', { class: 'wv-own' }, [input, save]));
    return wrap;
}

// repeat — rows of sub-fields (e.g. name + relationship)
function buildRepeat(field, current) {
    const entries = Array.isArray(current) ? [...current] : [];
    const subs = field.fields && field.fields.length ? field.fields : ['value'];
    const wrap = el('div', { class: 'wv-input' });

    if (entries.length) {
        const list = el('div', { class: 'wv-entry-list' });
        entries.forEach((entry, i) => {
            list.append(el('div', { class: 'wv-entry' }, [
                el('span', { text: formatValue(entry) }),
                el('button', { class: 'wv-entry-remove', text: '✕', 'aria-label': 'Remove',
                    onclick: () => {
                        const next = entries.filter((_, j) => j !== i);
                        if (next.length) saveAndRefresh(field, next);
                        else wv.resetField(field.key).then(() => refreshCard(field));
                    } })
            ]));
        });
        wrap.append(list);
    }

    const inputs = subs.map((s) => el('input', { type: 'text', class: 'wv-text wv-text-sub', placeholder: s }));
    const add = el('button', { class: 'wv-btn wv-btn-primary', text: 'Add',
        onclick: () => {
            const obj = {};
            subs.forEach((s, i) => { obj[s] = inputs[i].value.trim(); });
            if (Object.values(obj).some(Boolean)) saveAndRefresh(field, [...entries, obj]);
        } });
    wrap.append(el('div', { class: 'wv-entry-add' }, [...inputs, add]));
    return wrap;
}
