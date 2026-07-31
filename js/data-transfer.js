/*
 * data-transfer.js — Export / Import of the complete user data package.
 *
 * WHY THIS EXISTS (Ken, July 30 2026). On Windows the data folder is a real,
 * user-visible directory: backup, transfer between machines, and the plain sense
 * of owning your own data all come free, because the user can open the folder and
 * copy worldview.json (the v0.2.25 "file in the folder wins" flow). On iPad the
 * data folder is OPFS — private to the browser, invisible in the Files app — so
 * ALL THREE of those jobs disappear at once and have to be rebuilt explicitly.
 *
 * It is also the safety net that makes the iPad's Safari-tab mode survivable:
 * measured July 30 2026, navigator.storage.persist() is DENIED in a browser tab,
 * so site data is evictable after seven days of non-use. An export turns that
 * from a loss into a re-import.
 *
 * And it is the bridge between the two iPad modes. A Home Screen app and a
 * Safari tab are separate storage silos (measured), so moving between them
 * without an export loses everything.
 *
 * None of this is iPad-only: this is the mechanism the long-planned cross-device
 * transfer feature has always needed on Windows too.
 *
 * WHAT TRAVELS: the four user-owned data files, the portable settings, and the
 * conversation logs. WHAT DOES NOT: the API key and the machine-local counters —
 * storage.getPortableSettings() applies the same exclusion the named-profile
 * feature uses, so a backup file can never carry the plaintext key (SEC-6).
 */

import * as storage from './storage.js';

export const PACKAGE_KIND = 'conversant-aac-backup';
export const PACKAGE_VERSION = 1;

// The user-owned data files. Each has a data-folder file (source of truth) and a
// localStorage write-through cache (same-machine mirror / no-folder stopgap), so
// the export reads whichever is actually present and the import writes BOTH —
// otherwise an import would appear to work and then be silently overwritten by a
// stale cache on the next load.
const DATA_FILES = [
    { file: 'worldview.json',       cache: 'aac_worldview',       label: 'About Me answers' },
    { file: 'relationships.json',   cache: 'aac_relationships',   label: 'People and relationships' },
    { file: 'control-phrases.json', cache: 'aac_control_phrases', label: 'Starters and control phrases' },
    { file: 'express-panel.json',   cache: 'aac_express_items',   label: 'Express Panel items' },
];

function readCache(key) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

// Folder file first (it is the source of truth per v0.2.25), falling back to the
// localStorage cache so a machine that never had a folder granted still exports
// everything the user has entered.
async function readOne(entry) {
    try {
        const text = await storage.readFile(entry.file);
        if (text) return JSON.parse(text);
    } catch { /* fall through to the cache */ }
    return readCache(entry.cache);
}

// Assemble the whole package. Missing pieces are simply absent rather than null,
// so an import can tell "the user had no relationships" from "this key was never
// part of the package format".
export async function buildPackage(appVersion) {
    const data = {};
    for (const entry of DATA_FILES) {
        const value = await readOne(entry);
        if (value !== null && value !== undefined) data[entry.file] = value;
    }
    let conversations = [];
    try {
        conversations = await storage.listConversationLogs();
    } catch { /* no folder, or unreadable — export the rest anyway */ }

    return {
        kind: PACKAGE_KIND,
        packageVersion: PACKAGE_VERSION,
        appVersion: appVersion || '',
        exportedAt: new Date().toISOString(),
        settings: storage.getPortableSettings(),
        data,
        conversations,
    };
}

// Plain-language counts for the confirmation dialogs, so the user can see what
// they are about to write out or overwrite rather than trusting a filename.
export function summarize(pkg) {
    const lines = [];
    for (const entry of DATA_FILES) {
        const value = pkg && pkg.data ? pkg.data[entry.file] : undefined;
        if (value === undefined) continue;
        let detail = '';
        // worldview.json keys its answers under `fields`, not `answers` — reading
        // the wrong key meant this line silently showed no count at all, on the one
        // screen where the user decides whether a backup is worth restoring from.
        // Only `answered` fields count: a declined one is a recorded refusal, not
        // an answer, and calling it one would overstate what the backup holds.
        if (entry.file === 'worldview.json' && value && value.fields) {
            const answered = Object.values(value.fields)
                .filter((f) => f && f.state === 'answered').length;
            detail = ` (${answered} answered)`;
        } else if (entry.file === 'relationships.json' && value && Array.isArray(value.people)) {
            detail = ` (${value.people.length})`;
        } else if (Array.isArray(value)) {
            detail = ` (${value.length})`;
        }
        lines.push(entry.label + detail);
    }
    const convos = (pkg && Array.isArray(pkg.conversations)) ? pkg.conversations.length : 0;
    lines.push(`${convos} saved conversation${convos === 1 ? '' : 's'}`);
    const settingCount = pkg && pkg.settings ? Object.keys(pkg.settings).length : 0;
    lines.push(`${settingCount} setting${settingCount === 1 ? '' : 's'} (your API key is never included)`);
    return lines;
}

function pad(n) { return String(n).padStart(2, '0'); }

// "conversant-backup-2026-07-30-1432.json" — sorts chronologically in the Files
// app, which is where these land on an iPad.
export function suggestedFilename(now = new Date()) {
    return 'conversant-backup-' +
        now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
        '-' + pad(now.getHours()) + pad(now.getMinutes()) + '.json';
}

// Hand a file to the user through the browser's own download path. On iPadOS this
// opens the share/save sheet and the file lands in Files — which is the ONLY way to
// get a file out of this app on a tablet, since the data folder there is OPFS and
// invisible. Shared with the Keyguard Design tab's "Screen Openings.txt" for exactly
// that reason.
export function downloadText(filename, text, mime = 'application/json') {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke on the next tick — revoking synchronously can cancel the download in
    // some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// Trigger a download of the package. On iPadOS this opens the share/save sheet and
// the file lands in Files, which is what makes the data user-visible again.
export async function downloadPackage(appVersion) {
    const pkg = await buildPackage(appVersion);
    downloadText(suggestedFilename(), JSON.stringify(pkg, null, 2));
    return pkg;
}

// Write the package into <data folder>/backups/ instead of downloading it (Ken,
// July 31 2026). Used where the user picked a real folder: the backup then sits
// beside the data it protects, in the folder they already sync and copy, rather
// than in the browser's Downloads. Returns the path written so the caller can say
// where it went. The download path above remains the ONLY route on a tablet.
export async function savePackageToFolder(appVersion) {
    const pkg = await buildPackage(appVersion);
    const path = await storage.saveBackup(suggestedFilename(), JSON.stringify(pkg, null, 2));
    return { pkg, path };
}

// Validate and parse. Throws a user-facing message — this is the one place a user
// can hand the app an arbitrary file, so the failure has to be legible rather than
// a raw JSON error.
export function parsePackage(text) {
    let pkg;
    try {
        pkg = JSON.parse(text);
    } catch {
        throw new Error('That file is not a Conversant backup — it is not readable as JSON.');
    }
    if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
        throw new Error('That file is not a Conversant backup.');
    }
    if (pkg.kind !== PACKAGE_KIND) {
        throw new Error('That file is not a Conversant backup. Look for a file named conversant-backup-….json');
    }
    if (typeof pkg.packageVersion !== 'number' || pkg.packageVersion > PACKAGE_VERSION) {
        throw new Error('That backup was made by a newer version of Conversant. Update the app first, then import it.');
    }
    if (!pkg.data || typeof pkg.data !== 'object') {
        throw new Error('That backup looks damaged — it has no data section.');
    }
    return pkg;
}

// Restore everything. DESTRUCTIVE — the caller must confirm first (standing rule:
// confirmDanger, never window.confirm). Writes the folder file AND the cache for
// each store so the result survives the reload the caller performs afterwards.
// Returns what was actually restored, so the caller can report it honestly rather
// than claiming success for pieces that failed.
export async function applyPackage(pkg) {
    const restored = { files: [], conversations: 0, settings: false, failed: [] };

    for (const entry of DATA_FILES) {
        const value = pkg.data[entry.file];
        if (value === undefined) continue;
        const text = JSON.stringify(value, null, 2);
        try {
            localStorage.setItem(entry.cache, JSON.stringify(value));
        } catch {
            restored.failed.push(entry.label);
            continue;
        }
        try {
            await storage.writeFile(entry.file, text);   // no-op without a data folder
        } catch { /* cache write already succeeded; folder is best-effort */ }
        restored.files.push(entry.label);
    }

    if (pkg.settings && typeof pkg.settings === 'object') {
        storage.applyPortableSettings(pkg.settings);
        restored.settings = true;
    }

    if (Array.isArray(pkg.conversations)) {
        for (const c of pkg.conversations) {
            if (!c || !c.id) continue;
            if (await storage.writeConversationLog(c.id, c.data)) restored.conversations++;
        }
    }

    return restored;
}
