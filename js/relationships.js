/* AAC Conversation Assistant — relationship graph model
 *
 * Relationship data is a *graph*, not flat question/answer: people are nodes
 * (each with attributes), and relationships are edges (which also carry data).
 * That is structurally different from the worldview questionnaire (worldview.js),
 * so it lives in its own file and its own model layer (Ken, June 15 2026).
 *
 * Storage mirrors worldview.js:
 *   - <data folder>/relationships.json   per-user graph (FSA), source of truth
 *   - localStorage 'aac_relationships'    same-machine write-through cache
 * Reconciliation is the v0.2.25 rule — the file in the connected folder wins;
 * the cache is promoted only when no file exists on disk yet.
 *
 * Shape:
 *   { version, updated,
 *     people: [ { id, name, private, attrs: { about, ... } } ],
 *     edges:  [ { from, to, type, attrs: {} } ] }
 * The user is the implicit node "me"; a person's relationship to the user is the
 * `type` of the me->person edge. Person<->person edges are supported by the data
 * model (e.g. "my sister is married to my brother-in-law") even though the
 * current UI only edits me->person edges — keeping the build small without
 * trapping the schema.
 */

import { readFile, writeFile, hasDataFolder } from './storage.js';
import * as ns from './namespace.js';

const FILE = 'relationships.json';
const CACHE_KEY = ns.key('aac_relationships');
const ME = 'me';

let graph = null;

// --- shape helpers ----------------------------------------------------------

function defaultGraph() {
    return {
        version: 1,
        updated: new Date().toISOString(),
        people: [],
        edges: []
    };
}

function normalize(g) {
    const base = defaultGraph();
    return {
        version: g.version ?? base.version,
        updated: g.updated ?? base.updated,
        people: Array.isArray(g.people) ? g.people : [],
        edges: Array.isArray(g.edges) ? g.edges : []
    };
}

function newId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY)); } catch { return null; }
}

function writeCache(g) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(g)); } catch { /* quota — disk is truth */ }
}

// --- load / save ------------------------------------------------------------

/** Load the graph: data folder (source of truth) → cache → empty. */
export async function load() {
    let loaded = null;
    const raw = await readFile(FILE);
    if (raw) { try { loaded = JSON.parse(raw); } catch { loaded = null; } }
    if (!loaded) loaded = readCache();
    graph = loaded ? normalize(loaded) : defaultGraph();
    writeCache(graph);
    return graph;
}

function ensureLoaded() {
    if (!graph) graph = readCache() ? normalize(readCache()) : defaultGraph();
    return graph;
}

async function save() {
    graph.updated = new Date().toISOString();
    writeCache(graph);
    await writeFile(FILE, JSON.stringify(graph, null, 2));
}

/**
 * Reconcile cache with the data folder once a folder becomes available. Same
 * rule as worldview.syncToFolder (v0.2.25): the file in the connected folder is
 * the source of truth — if a relationships.json is present it wins; otherwise
 * the cache is promoted to a new file. Returns 'wrote' | 'adopted' | 'noop'.
 */
export async function syncToFolder() {
    if (!hasDataFolder()) return 'noop';

    const raw = await readFile(FILE);
    let disk = null;
    if (raw) { try { disk = JSON.parse(raw); } catch { disk = null; } }

    if (disk) {
        graph = normalize(disk);
        writeCache(graph);
        return 'adopted';
    }
    graph = normalize(readCache() || graph || defaultGraph());
    await save();
    return 'wrote';
}

// --- people / edges ---------------------------------------------------------

function meEdge(personId) {
    return ensureLoaded().edges.find((e) => e.from === ME && e.to === personId);
}

/** People joined with their relationship-to-the-user, for the editor + display. */
export function listPeople() {
    return ensureLoaded().people.map((p) => {
        const edge = meEdge(p.id);
        return {
            id: p.id,
            name: p.name,
            nickname: (p.attrs && p.attrs.nickname) || '',
            relationship: edge ? edge.type : '',
            about: (p.attrs && p.attrs.about) || '',
            livesWithMe: !!(p.attrs && p.attrs.livesWithMe),
            private: !!p.private
        };
    });
}

export function getPerson(id) {
    return listPeople().find((p) => p.id === id) || null;
}

export async function addPerson({ name, relationship = '', about = '', nickname = '', livesWithMe = false, isPrivate = false } = {}) {
    const g = ensureLoaded();
    const id = newId();
    g.people.push({
        id, name: (name || '').trim(), private: !!isPrivate,
        attrs: { about: (about || '').trim(), nickname: (nickname || '').trim(), livesWithMe: !!livesWithMe }
    });
    if ((relationship || '').trim()) {
        g.edges.push({ from: ME, to: id, type: relationship.trim(), attrs: {} });
    }
    await save();
    return id;
}

export async function updatePerson(id, { name, relationship, about, nickname, livesWithMe, isPrivate } = {}) {
    const g = ensureLoaded();
    const p = g.people.find((x) => x.id === id);
    if (!p) return;
    if (name !== undefined) p.name = (name || '').trim();
    if (about !== undefined) { p.attrs = p.attrs || {}; p.attrs.about = (about || '').trim(); }
    if (nickname !== undefined) { p.attrs = p.attrs || {}; p.attrs.nickname = (nickname || '').trim(); }
    if (livesWithMe !== undefined) { p.attrs = p.attrs || {}; p.attrs.livesWithMe = !!livesWithMe; }
    if (isPrivate !== undefined) p.private = !!isPrivate;
    if (relationship !== undefined) {
        const edge = meEdge(id);
        const t = (relationship || '').trim();
        if (edge) {
            if (t) edge.type = t;
            else g.edges = g.edges.filter((e) => e !== edge);
        } else if (t) {
            g.edges.push({ from: ME, to: id, type: t, attrs: {} });
        }
    }
    await save();
}

export async function removePerson(id) {
    const g = ensureLoaded();
    g.people = g.people.filter((p) => p.id !== id);
    g.edges = g.edges.filter((e) => e.from !== id && e.to !== id);
    await save();
}

export async function resetAll() {
    const g = ensureLoaded();
    g.people = [];
    g.edges = [];
    await save();
}

export function count() {
    return ensureLoaded().people.length;
}

// --- LLM profile block ------------------------------------------------------

/**
 * Compact text for the generation system prompt — the relationship slice of
 * "speak AS this person." Private people are never named or described; they are
 * surfaced only as a phrase-around instruction by their relationship, mirroring
 * the worldview privacy rule.
 */
export function buildBlock() {
    ensureLoaded();
    const people = listPeople();
    if (!people.length) return '';

    const facts = [];
    const privateKnown = [];   // AI knows these people but must not mention them spontaneously
    for (const p of people) {
        const displayName = p.name || p.relationship || 'someone';
        const nick = p.nickname ? ` (called "${p.nickname}")` : '';
        const relParts = [p.relationship, p.livesWithMe ? 'lives with me' : ''].filter(Boolean);
        const rel = relParts.length ? ` (${relParts.join(', ')})` : '';
        const about = p.about ? ` — ${p.about}` : '';
        const entry = `- ${displayName}${nick}${rel}${about}`;
        if (p.private) {
            privateKnown.push(entry);
        } else {
            facts.push(entry);
        }
    }

    if (!facts.length && !privateKnown.length) return '';
    const lines = ['People in my life:'];
    if (facts.length) lines.push(...facts);
    // Address people by their preferred term, not their given name (Ken: "when
    // I'm talking to my mother Mary, I always call her 'mom', not 'Mary'").
    if (people.some((p) => p.nickname)) {
        lines.push('When you refer to or address any of these people, ALWAYS use the name shown in quotes after "called" (their preferred term of address — e.g. "mom", "dad"), never their given name.');
    }
    if (privateKnown.length) {
        lines.push(
            'These people are known to you for context — do not bring them up unprompted; only include them if the user\'s chosen response requires it:',
            ...privateKnown
        );
    }
    return lines.join('\n');
}
