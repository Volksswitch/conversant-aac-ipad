/* AAC Conversation Assistant — worldview model (Build Step 1)
 *
 * The worldview profile lets the assistant speak AS the user: concrete facts,
 * interests, and (later) voice/values. This module is the data layer only —
 * the questionnaire UI (worldview-ui.js) and the LLM wiring (llm.js) come in
 * Build Steps 2 and 3.
 *
 * Two artifacts (see Worldview-Implementation-Plan.docx §2):
 *   - app/data/worldview-questions.json  static registry (ships with the app)
 *   - <data folder>/worldview.json       per-user profile (FSA), cached in
 *                                         localStorage for instant reads
 *
 * Three field states drive all behavior:
 *   unanswered  key absent in profile.fields   (eligible to ask / resurface)
 *   answered    { value, state:"answered" }
 *   declined    { value:null, state:"declined" }  sticky — never ask, always
 *                                                  phrase around; un-decline
 *                                                  returns it to unanswered.
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';
import * as ns from './namespace.js';

const PROFILE_FILE = 'worldview.json';
const CACHE_KEY = ns.key('aac_worldview');
const REGISTRY_URL = 'data/worldview-questions.json';

let registry = null;          // parsed worldview-questions.json
let fieldIndex = null;        // key -> { ...field, moduleId, moduleTitle }
let profile = null;           // the worldview.json object

// --- Registry ---------------------------------------------------------------

export async function loadRegistry() {
    if (registry) return registry;
    const resp = await fetch(REGISTRY_URL);
    if (!resp.ok) throw new Error(`worldview registry load failed: ${resp.status}`);
    registry = await resp.json();
    fieldIndex = {};
    for (const mod of registry.modules) {
        for (const f of mod.fields) {
            fieldIndex[f.key] = { ...f, moduleId: mod.id, moduleTitle: mod.title };
        }
    }
    return registry;
}

export function getRegistry() {
    return registry;
}

export function fieldMeta(key) {
    return fieldIndex ? fieldIndex[key] || null : null;
}

// --- Profile load / save ----------------------------------------------------

function defaultProfile() {
    return {
        version: 1,
        updated: new Date().toISOString(),
        fields: {},
        privacy: {},   // per-field privacy overrides: key -> "private" | "shareable"
        gaps: []       // [{ key, partnerText, count, lastSeen }]
    };
}

function readCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY));
    } catch {
        return null;
    }
}

function writeCache(p) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(p));
    } catch { /* quota — non-fatal, data folder is the source of truth */ }
}

function normalize(p) {
    const base = defaultProfile();
    return {
        version: p.version ?? base.version,
        updated: p.updated ?? base.updated,
        fields: p.fields ?? {},
        privacy: p.privacy ?? {},
        gaps: Array.isArray(p.gaps) ? p.gaps : []
    };
}

/**
 * Load the profile. Prefers the data folder (source of truth); falls back to
 * the localStorage cache when no folder is granted yet, then to an empty
 * profile. Always refreshes the cache from whatever was loaded.
 */
export async function load() {
    let loaded = null;
    const fromDisk = await readFile(PROFILE_FILE);   // null if no folder / missing
    if (fromDisk) {
        try { loaded = JSON.parse(fromDisk); } catch { loaded = null; }
    }
    if (!loaded) loaded = readCache();
    profile = loaded ? normalize(loaded) : defaultProfile();
    writeCache(profile);
    return profile;
}

function ensureLoaded() {
    if (!profile) profile = readCache() ? normalize(readCache()) : defaultProfile();
    return profile;
}

/** Write-through to both the data folder and the localStorage cache. */
async function save() {
    profile.updated = new Date().toISOString();
    writeCache(profile);
    await writeFile(PROFILE_FILE, JSON.stringify(profile, null, 2));
}

/**
 * Reconcile the localStorage cache with the data folder once a folder
 * becomes available. Call this right after a folder is granted/restored.
 *
 * The file in the data folder is the source of truth — the folder is the
 * portable profile, the localStorage cache is only a same-machine mirror and a
 * stopgap for when no folder is granted. So the rule is simple and predictable
 * (Ken, June 15 2026): **if a worldview.json is present in the connected
 * folder, that file wins — always.** Copying a profile in from another machine
 * therefore just works; the file is never entered into a timestamp contest
 * against the browser cache and is never overwritten by it. The cache is
 * promoted to disk only when there is NO file on disk yet (answers entered
 * before a folder was ever granted). The winner is written through to both
 * stores and becomes the in-memory profile. Returns 'wrote' | 'adopted' |
 * 'noop'.
 *
 * Trade-off (accepted): answers entered while a folder was disconnected, then
 * re-connecting a folder that already holds a file, are dropped in favor of the
 * file. A future "this folder and this browser differ — which do you want?"
 * prompt is the way to make that case loss-free.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';   // nothing to sync to yet

    const raw = await readFile(PROFILE_FILE);
    let disk = null;
    if (raw) { try { disk = JSON.parse(raw); } catch { disk = null; } }

    if (disk) {
        // A file in the connected folder is the source of truth — adopt it,
        // mirror it to the cache. Never let the cache overwrite it.
        profile = normalize(disk);
        writeCache(profile);
        return 'adopted';
    }

    // No portable file yet — promote whatever the cache holds to disk so the
    // data stops being machine-local.
    profile = normalize(readCache() || profile || defaultProfile());
    await save();
    return 'wrote';
}

// --- Field state ------------------------------------------------------------

export function getState(key) {
    const f = ensureLoaded().fields[key];
    if (!f) return 'unanswered';
    return f.state === 'declined' ? 'declined' : 'answered';
}

export function getField(key) {
    const f = ensureLoaded().fields[key];
    return f && f.state === 'answered' ? f.value : null;
}

export async function setField(key, value) {
    ensureLoaded().fields[key] = { value, state: 'answered', updated: new Date().toISOString() };
    clearGapEntry(key);   // answering a field resolves its gap
    await save();
}

export async function declineField(key) {
    // Preserve any existing answer so "Prefer not to say" is reversible — it must
    // not silently destroy a saved answer (Ken, July 2026). The stashed value is
    // NEVER sent to the AI: getField() returns null for a declined field and
    // buildBlock() treats declined as phrase-around with no value. It lives only
    // to let undeclineField() put the answer back.
    const existing = ensureLoaded().fields[key];
    const prev = existing && existing.state === 'answered' ? existing.value
        : (existing && existing.prevValue != null ? existing.prevValue : null);
    profile.fields[key] = { value: null, prevValue: prev, state: 'declined', updated: new Date().toISOString() };
    clearGapEntry(key);   // declined is a real answer — stop surfacing it
    await save();
}

/** True if a declined field has a stashed prior answer that undecline can restore. */
export function hasStashedAnswer(key) {
    const f = ensureLoaded().fields[key];
    return !!(f && f.state === 'declined' && f.prevValue != null && f.prevValue !== '');
}

/**
 * Undo a decline: restore the prior answer if there was one, otherwise return the
 * field to the unanswered state (ask me again). This is what the declined card's
 * Undo control calls, so a decline never loses a saved answer.
 */
export async function undeclineField(key) {
    const f = ensureLoaded().fields[key];
    if (f && f.state === 'declined' && f.prevValue != null && f.prevValue !== '') {
        profile.fields[key] = { value: f.prevValue, state: 'answered', updated: new Date().toISOString() };
    } else {
        delete profile.fields[key];
    }
    await save();
}

/** Skip-for-now / un-decline: return the field to the unanswered state. */
export async function resetField(key) {
    delete ensureLoaded().fields[key];
    await save();
}

/** Wipe all answers (revertibility invariant). Keeps the gaps log. */
export async function resetAll() {
    ensureLoaded();
    profile.fields = {};
    profile.privacy = {};
    await save();
}

// --- Privacy ----------------------------------------------------------------

export function effectivePrivacy(key) {
    const override = ensureLoaded().privacy[key];
    if (override) return override;
    const meta = fieldMeta(key);
    return meta?.defaultPrivacy || 'shareable';
}

export async function setPrivacy(key, privacy) {
    ensureLoaded().privacy[key] = privacy;
    await save();
}

// --- Gaps log ---------------------------------------------------------------

function clearGapEntry(key) {
    if (!profile) return;
    profile.gaps = profile.gaps.filter((g) => g.key !== key);
}

/**
 * Record facts the generation call wanted but did not have. Keys that are
 * already answered or declined are dropped — we only log genuine open gaps.
 */
export async function recordGaps(missingFacts, partnerText) {
    ensureLoaded();
    const now = new Date().toISOString();
    let changed = false;
    for (const key of missingFacts || []) {
        if (getState(key) !== 'unanswered') continue;
        const existing = profile.gaps.find((g) => g.key === key);
        if (existing) {
            existing.count += 1;
            existing.lastSeen = now;
            if (partnerText) existing.partnerText = partnerText;
        } else {
            profile.gaps.push({ key, partnerText: partnerText || '', count: 1, lastSeen: now });
        }
        changed = true;
    }
    if (changed) await save();
}

/** Open gaps, most-asked first. */
export function listGaps() {
    return [...ensureLoaded().gaps].sort((a, b) => b.count - a.count);
}

export async function clearGaps() {
    ensureLoaded().gaps = [];
    await save();
}

// --- Derived: progress and suggested-next -----------------------------------

export function getModules() {
    if (!registry) return [];
    return registry.modules.map((mod) => {
        const total = mod.fields.length;
        const answered = mod.fields.filter((f) => getState(f.key) === 'answered').length;
        const declined = mod.fields.filter((f) => getState(f.key) === 'declined').length;
        return { id: mod.id, title: mod.title, tier: mod.tier, total, answered, declined };
    });
}

/**
 * What to offer next: open gaps first (real conversational demand), then any
 * unanswered registry fields in authoring order. Returns field metadata.
 */
export function suggestedNext(limit = 5) {
    const out = [];
    const seen = new Set();
    for (const g of listGaps()) {
        if (getState(g.key) !== 'unanswered') continue;
        const meta = fieldMeta(g.key);
        if (meta && !seen.has(g.key)) { out.push(meta); seen.add(g.key); }
        if (out.length >= limit) return out;
    }
    if (registry) {
        for (const mod of registry.modules) {
            for (const f of mod.fields) {
                if (seen.has(f.key)) continue;
                if (getState(f.key) === 'unanswered') {
                    out.push(fieldMeta(f.key)); seen.add(f.key);
                    if (out.length >= limit) return out;
                }
            }
        }
    }
    return out;
}

// --- Profile block for LLM injection ---------------------------------------

function formatValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) {
        return value.map((v) => {
            if (v && typeof v === 'object') return Object.values(v).filter(Boolean).join(' — ');
            return v;
        }).filter(Boolean).join(', ');
    }
    if (typeof value === 'object') return Object.values(value).filter(Boolean).join(' — ');
    return String(value);
}

function labelFor(key) {
    const meta = fieldMeta(key);
    if (!meta) return key;
    // The canonical placeholder name reads as a clean fact label
    // ("name" -> "Name: Alex"), far better than the full question text.
    if (meta.fills && meta.fills.length) {
        const f = meta.fills[0];
        return f.charAt(0).toUpperCase() + f.slice(1);
    }
    // Fallback: the question with trailing punctuation / parentheticals removed.
    return meta.q.replace(/\s*\(.*?\)\s*$/, '').replace(/[?:]\s*$/, '');
}

/**
 * Compact profile text injected into the generation system prompt.
 *
 * Privacy model (three levels — Ken, June 19 2026):
 *   Shareable   — value sent freely; AI may use it in any response.
 *   Private     — value IS sent; AI uses it for context but must not volunteer
 *                 it. It may appear in a response only if the user picks one
 *                 that includes it. Correct for sensitive-but-useful facts
 *                 (phone, address, people the user wants AI to know about).
 *   Declined    — user chose "Prefer not to say"; NO value sent; phrase-around
 *                 only. For information the user does not want the AI to know.
 */
export function buildBlock() {
    ensureLoaded();
    const facts = [];
    const privateKnown = [];   // sent to AI, but must not be volunteered
    const phraseAround = new Set();   // declined — AI gets no value at all

    if (registry) {
        for (const mod of registry.modules) {
            for (const f of mod.fields) {
                const state = getState(f.key);
                if (state === 'declined') {
                    phraseAround.add(labelFor(f.key).toLowerCase());
                    continue;
                }
                if (state !== 'answered') continue;
                const v = formatValue(getField(f.key));
                if (!v) continue;
                if (effectivePrivacy(f.key) === 'private') {
                    privateKnown.push(`- ${labelFor(f.key)}: ${v}`);
                } else {
                    facts.push(`- ${labelFor(f.key)}: ${v}`);
                }
            }
        }
    }

    if (!facts.length && !privateKnown.length && !phraseAround.size) return '';

    const lines = ['You are speaking AS this person, in the first person. What you know about them:'];
    if (facts.length) lines.push('', ...facts);
    if (privateKnown.length) {
        lines.push(
            '',
            'These details are known to you for context — do not volunteer them spontaneously; only include them if the user selects a response that does:',
            ...privateKnown
        );
    }
    if (phraseAround.size) {
        lines.push(
            '',
            'The person chose not to share these — do not state, invent, or ask about them; phrase around if they come up: '
            + [...phraseAround].join(', ') + '.'
        );
    }
    return lines.join('\n');
}
