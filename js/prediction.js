/* Word prediction — fully LOCAL, no AI per keystroke (CLAUDE.md "Word
 * prediction — local tiers"). Per-keypress prediction must be instant and
 * offline; the LLM is reserved for explicit phrase EXPANSION, never this.
 *
 * Two local layers here:
 *   1. Prefix completion from a bundled frequency-ordered list (data/words.json)
 *      — earlier in the list = more common, so we keep file order as the rank.
 *   2. Personalized learning — the user's own word frequency, persisted locally
 *      (localStorage), boosted ahead of the dictionary so their vocabulary and
 *      recent words surface first and improve over time. No network, no privacy
 *      cost. (A next-word n-gram layer is the recorded future extension.)
 *
 * predict(prefix) returns up to `limit` lowercase words; the caller (keyboard)
 * matches the typed prefix's capitalization when inserting.
 */

import * as ns from './namespace.js';

const FREQ_KEY = ns.key('aac_word_freq');

let words = [];                 // frequency-ordered dictionary (file order = rank)
let rank = new Map();           // word -> dictionary index (lower = more common)
let userFreq = null;            // { word: count } personalized, lazy-loaded

function loadUserFreq() {
    if (userFreq) return userFreq;
    try { userFreq = JSON.parse(localStorage.getItem(FREQ_KEY)) || {}; }
    catch { userFreq = {}; }
    return userFreq;
}

function saveUserFreq() {
    try { localStorage.setItem(FREQ_KEY, JSON.stringify(userFreq)); } catch { /* quota/full */ }
}

export async function load() {
    if (words.length) return;
    try {
        const data = await fetch('data/words.json').then((r) => r.json());
        if (Array.isArray(data)) {
            words = data.map((w) => String(w).toLowerCase());
            rank = new Map(words.map((w, i) => [w, i]));
        }
    } catch { /* prediction simply yields nothing until the list loads */ }
    loadUserFreq();
}

// Record that the user committed a word (on word boundary, or by picking a
// prediction) — boosts it for next time. Words shorter than 2 chars are ignored.
export function learn(word) {
    const w = String(word || '').toLowerCase().replace(/[^a-z']/g, '');
    if (w.length < 2) return;
    const uf = loadUserFreq();
    uf[w] = (uf[w] || 0) + 1;
    saveUserFreq();
}

// Top predictions for a typed prefix. Personalized matches (by the user's own
// count) come first, then dictionary matches (by frequency rank), deduped.
export function predict(prefix, limit = 3) {
    const p = String(prefix || '').toLowerCase().replace(/[^a-z']/g, '');
    if (!p) return [];
    const uf = loadUserFreq();

    // Personalized matches, most-used first; exclude the exact prefix itself.
    const personal = Object.keys(uf)
        .filter((w) => w !== p && w.startsWith(p))
        .sort((a, b) => uf[b] - uf[a]);

    const out = [];
    const seen = new Set();
    const push = (w) => { if (!seen.has(w)) { seen.add(w); out.push(w); } };
    personal.forEach(push);

    // Then dictionary matches in frequency order until we hit the limit.
    if (out.length < limit) {
        for (const w of words) {
            if (out.length >= limit) break;
            if (w !== p && w.startsWith(p)) push(w);
        }
    }
    return out.slice(0, limit);
}
