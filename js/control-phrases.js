/* Control phrases — persistence model (Ken, June 28 2026)
 *
 * The user-editable spoken text behind the persistent override controls and the
 * conversation opener/closer cards, so a user can make each one sound like
 * something THEY would say:
 *   - holdOn   : spoken when "Hold on" is tapped (a floor-holding beat)
 *   - pardon   : spoken when "Pardon?" is tapped (asks the partner to repeat)
 *   - openers  : the cards shown by "Start conversation" (templates; {name} is
 *                replaced with the active Partner's name, dropped when none)
 *   - windDowns: the cards shown by "Wind down" — signal an intent to end the
 *                conversation ("I should get going.") WITHOUT saying goodbye yet
 *   - closings : the actual goodbyes ("Bye!", "Take care!") that appear once the
 *                user has selected a wind-down statement
 * ("Say again" has no editable phrase — it re-speaks the user's own last words.)
 *
 * Wind-down vs. closing (Ken, July 2026): these are two distinct steps of the CA
 * closing sequence. "Wind down" surfaces the wind-downs; selecting one auto-offers
 * the closings; if the partner doesn't reciprocate, re-pressing "Wind down" dips
 * to the next page of wind-downs. Legacy files had a single `closers` list — it is
 * dropped and both new lists reseed from defaults (single-user pre-beta; re-edit
 * via Settings → Controls if you'd customized the old closers).
 *
 * Stored like the other user-owned data (express-panel.js, worldview.js):
 *   - <data folder>/control-phrases.json   portable source of truth (FSA)
 *   - localStorage 'aac_control_phrases'    same-machine write-through cache
 * Reconciliation is the v0.2.25 rule: a file in the connected folder wins; the
 * cache is promoted to a new file only when none exists on disk yet.
 *
 * Engine note: openers carry a {name} placeholder, but the name-substitution
 * lives in engine.js (applyName) where the opener palette is built — this model
 * just stores the raw templates. The engine keeps an inline default set mirroring
 * DEFAULTS so it works even before app.js injects these.
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';
import * as ns from './namespace.js';

const FILE = 'control-phrases.json';
const CACHE_KEY = ns.key('aac_control_phrases');

export const DEFAULTS = {
    holdOn: 'Let me think about that.',
    pardon: "Sorry, I didn't catch that. Could you say it again?",
    // Shown alongside the goodbyes when the PARTNER starts closing. A pre-closing
    // is an offer to end, and CA is explicit that declining it — raising one more
    // thing — is made maximally relevant at exactly that moment. Without this card
    // the user's only options are to say goodbye or leave the palette (Ken, July
    // 27 2026). It buys the floor; the user then says the thing itself.
    declineClosing: 'Actually, before you go —',
    // {name} → the active Partner's name; dropped (with tidy punctuation) when
    // no Partner is active. Kept in sync with engine.js's inline fallback.
    openers: [
        'Hi {name}, got a minute?',
        'Can I ask you something, {name}?',
        'Guess what, {name}.',
        'Hey {name}, how are you doing?',
        'Good to see you, {name}.',
        'How have you been, {name}?',
        "What's new with you, {name}?",
        'I was just thinking about you, {name}.',
        'Got a story for you, {name}.',
    ],
    // Wind-down statements: signal "I'm ready to wrap up" without saying goodbye.
    windDowns: [
        'I should get going.',
        'I need to head out.',
        'This was really nice, thanks.',
        'Great catching up with you.',
        'Anyway, I should let you go.',
        "It's been good seeing you.",
        'I should probably wrap up.',
        "I've got to run soon.",
    ],
    // Closing statements: the actual goodbyes, offered after a wind-down.
    closings: [
        'Bye!',
        'Take care!',
        'See you later!',
        "Let's talk again soon.",
        'Have a good day!',
        'Talk soon!',
        'Goodbye!',
        'Catch you later.',
    ],
};

let phrases = null; // in-memory working copy

// Coerce any stored/edited value into the full shape, filling gaps from defaults.
// Blank list entries are KEPT (the editor needs a transient empty row to type
// into) — they're filtered out at engine-injection time, not here. A list that is
// entirely missing falls back to defaults.
function normalize(value) {
    const v = value && typeof value === 'object' ? value : {};
    const str = (x, d) => (typeof x === 'string' && x.trim() ? x : d);
    const list = (x, d) => {
        if (!Array.isArray(x)) return d.slice();
        const arr = x.map((s) => (typeof s === 'string' ? s : ''));
        return arr.length ? arr : d.slice();
    };
    const seededList = (x) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string') : []);
    const seeded = (v.seeded && typeof v.seeded === 'object') ? v.seeded : {};
    // A legacy file has `closers` and neither new key — since windDowns/closings
    // are absent, list(undefined, DEFAULTS.*) reseeds both from defaults and the old
    // `closers` (which mixed the two senses) is simply ignored. No auto-classify.
    return {
        holdOn: str(v.holdOn, DEFAULTS.holdOn),
        pardon: str(v.pardon, DEFAULTS.pardon),
        declineClosing: str(v.declineClosing, DEFAULTS.declineClosing),
        openers: list(v.openers, DEFAULTS.openers),
        windDowns: list(v.windDowns, DEFAULTS.windDowns),
        closings: list(v.closings, DEFAULTS.closings),
        // Watermark: every default opener/windDown/closing value ever injected into
        // this user's set. Drives additive merging (mergeNewDefaults) so a release
        // that adds new default cards shows them to existing users automatically,
        // WITHOUT resurrecting cards the user deliberately deleted.
        seeded: {
            openers: seededList(seeded.openers),
            windDowns: seededList(seeded.windDowns),
            closings: seededList(seeded.closings),
        },
    };
}

// Append default openers/closers the user has NOT been offered before to the END
// of their list — the "be smart about new functionality, but protect edits" rule
// (Ken, July 8 2026). "File in folder wins" still protects the user's edits; this
// only ADDS genuinely-new defaults. A default already in `seeded` is respected
// as-is: kept if present, and NOT re-added if the user removed it. A default NOT in
// `seeded` is new — appended once (unless already present) and recorded. There is
// no cap on how many can be defined (only on how many the UI shows at once), so
// appending is always safe. Returns true if anything changed (persist if so).
function mergeNewDefaults(p) {
    let changed = false;
    for (const key of ['openers', 'windDowns', 'closings']) {
        const seededSet = new Set(p.seeded[key]);
        const present = new Set(p[key]);
        for (const d of DEFAULTS[key]) {
            if (seededSet.has(d)) continue;   // already offered in a past release
            p.seeded[key].push(d);
            seededSet.add(d);
            if (!present.has(d)) { p[key].push(d); present.add(d); }  // append at the end
            changed = true;
        }
    }
    return changed;
}

function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}
function writeCache(p) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(p)); } catch { /* quota — disk is truth */ }
}
function writeDisk(p) {
    writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), ...p }, null, 2))
        .catch(() => { /* best-effort */ });
}

/** Load: data folder (source of truth) → cache → defaults. */
export async function load() {
    let loaded = null;
    const raw = await readFile(FILE);
    if (raw) { try { loaded = JSON.parse(raw); } catch { loaded = null; } }
    if (!loaded) loaded = readCache();
    phrases = normalize(loaded);
    const changed = mergeNewDefaults(phrases);   // append any new default cards
    writeCache(phrases);
    if (changed) writeDisk(phrases);              // persist the appended defaults + watermark
    return phrases;
}

/** Synchronous read for the editor / engine injection (returns a copy). */
export function getPhrases() {
    if (!phrases) phrases = normalize(readCache());
    return {
        ...phrases,
        openers: phrases.openers.slice(),
        windDowns: phrases.windDowns.slice(),
        closings: phrases.closings.slice(),
    };
}

/** Persist an edited set (cache immediately, disk in the background). */
export function setPhrases(next) {
    // Carry the seeded watermark forward — the editor doesn't send it, and losing
    // it would make a deleted default reappear on the next load (mergeNewDefaults).
    const priorSeeded = (phrases && phrases.seeded) ? phrases.seeded : { openers: [], windDowns: [], closings: [] };
    const incoming = (next && typeof next === 'object') ? next : {};
    phrases = normalize({ ...incoming, seeded: incoming.seeded || priorSeeded });
    writeCache(phrases);
    writeDisk(phrases);
    return getPhrases();
}

/** Restore the default phrases. */
export function resetPhrases() {
    phrases = normalize(DEFAULTS);
    // A reset adopts the full current defaults, so watermark them all — a later
    // release still appends only genuinely-new cards, not these.
    phrases.seeded = {
        openers: DEFAULTS.openers.slice(),
        windDowns: DEFAULTS.windDowns.slice(),
        closings: DEFAULTS.closings.slice(),
    };
    writeCache(phrases);
    writeDisk(phrases);
    return getPhrases();
}

/**
 * Reconcile once a data folder becomes available (v0.2.25 rule): adopt an
 * existing control-phrases.json, otherwise promote the cache to a new file.
 * Returns 'adopted' | 'wrote' | 'noop'.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';
    const raw = await readFile(FILE);
    let disk = null;
    if (raw) { try { disk = JSON.parse(raw); } catch { disk = null; } }
    if (disk) {
        phrases = normalize(disk);
        const changed = mergeNewDefaults(phrases);   // append any new default cards
        writeCache(phrases);
        if (changed) await writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), ...phrases }, null, 2));
        return 'adopted';
    }
    phrases = getPhrases();
    await writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), ...phrases }, null, 2));
    return 'wrote';
}
