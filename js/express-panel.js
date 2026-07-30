/* Express Panel — persistence model (June 26 2026)
 *
 * The user's editable, ordered, typed item list (phrase / partner / feeling —
 * see express-items.js) that backs the Express Panel. Stored like the other
 * user-owned data (worldview.js, relationships.js):
 *   - <data folder>/express-panel.json   portable source of truth (FSA)
 *   - localStorage 'aac_express_items'    same-machine write-through cache
 * Reconciliation is the v0.2.25 rule: a file in the connected folder wins; the
 * cache is promoted to a new file only when none exists on disk yet.
 *
 * Editing is synchronous from the UI's perspective (getItems/setItems work off an
 * in-memory + localStorage copy); the file write is best-effort in the background,
 * exactly like worldview/relationships save().
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';
import * as ns from './namespace.js';
import { DEFAULT_ITEMS, ensureIds } from './express-items.js';

const FILE = 'express-panel.json';
const CACHE_KEY = ns.key('aac_express_items');

let items = null; // in-memory working copy

function parseItems(value) {
    if (Array.isArray(value)) return value;
    if (value && Array.isArray(value.items)) return value.items;
    return null;
}

function readCache() {
    try {
        return parseItems(JSON.parse(localStorage.getItem(CACHE_KEY)));
    } catch { return null; }
}

function writeCache(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(list)); } catch { /* quota — disk is truth */ }
}

function writeDisk(list) {
    // Best-effort; never blocks the UI. No-op without a data folder.
    writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), items: list }, null, 2))
        .catch(() => { /* disk write is best-effort */ });
}

/** Load: data folder (source of truth) → cache → defaults. */
export async function load() {
    let loaded = null;
    const raw = await readFile(FILE);
    if (raw) { try { loaded = parseItems(JSON.parse(raw)); } catch { loaded = null; } }
    if (!loaded) loaded = readCache();
    items = ensureIds(loaded && loaded.length ? loaded : DEFAULT_ITEMS);
    writeCache(items);
    return items;
}

/** Synchronous read for the renderer/editor (returns copies). */
export function getItems() {
    if (!items) {
        const c = readCache();
        items = ensureIds(c && c.length ? c : DEFAULT_ITEMS);
    }
    return items.map((x) => ({ ...x }));
}

/** Persist an edited list (cache immediately, disk in the background). */
export function setItems(list) {
    items = ensureIds(Array.isArray(list) ? list : []);
    writeCache(items);
    writeDisk(items);
    return items;
}

/** Restore the provided starting layout. */
export function resetItems() {
    items = ensureIds(DEFAULT_ITEMS);
    writeCache(items);
    writeDisk(items);
    return items;
}

/**
 * Reconcile once a data folder becomes available (v0.2.25 rule): adopt an
 * existing express-panel.json, otherwise promote the cache to a new file.
 * Returns 'adopted' | 'wrote' | 'noop'.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';
    const raw = await readFile(FILE);
    let disk = null;
    if (raw) { try { disk = parseItems(JSON.parse(raw)); } catch { disk = null; } }
    if (disk) {
        items = ensureIds(disk);
        writeCache(items);
        return 'adopted';
    }
    items = getItems();
    await writeFile(FILE, JSON.stringify({ version: 1, updated: new Date().toISOString(), items }, null, 2));
    return 'wrote';
}
