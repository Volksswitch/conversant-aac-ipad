/* Transcript-shaping helpers — the pure array logic behind the conversation
 * transcript (the `<id>.json` file), extracted from storage.js so the tricky
 * rules can be unit-tested without the File System Access / DOM plumbing.
 *
 * Ken (July 2026) — the transcript must MIRROR the conversation pane at all times,
 * so it's a reliable record while the app misbehaves. That means the partner's
 * in-progress turn is written as soon as it's shown live and updated on every
 * pause, not only when the user finally responds. These helpers implement the
 * exact rules:
 *   - a partner turn is written at the first pause (raw text, empty cleaned line),
 *   - each later pause OVERWRITES the raw line and CLEARS the cleaned line,
 *   - the turn is FINALIZED (cleaned line filled) when the user responds.
 * No FSA, no DOM, no module state — the caller (storage.js) owns the exchanges
 * array and the "pending partner turn" reference and passes them in.
 */

// Upsert the partner's in-progress ("pending") turn. If `pending` is a live
// partner turn, overwrite its raw text and CLEAR its cleaned text (the partner
// kept talking, so the previous cleaned text is stale); otherwise append a new
// pending partner entry. Returns the pending turn object (the caller keeps it as
// the new `pending` reference).
export function upsertPartnerInterim(exchanges, pending, { rawTranscript, partner = null, timestamp }) {
    if (pending) {
        pending.rawTranscript = rawTranscript;
        pending.cleanedTranscript = '';          // partner continued — stale cleaned text is dropped
        if (partner) pending.partner = partner;
        return pending;
    }
    const turn = {
        timestamp: timestamp || new Date().toISOString(),
        role: 'partner',
        rawTranscript,
        cleanedTranscript: '',
        partner,
    };
    exchanges.push(turn);
    return turn;
}

// Finalize a partner turn with its cleaned text (called when the user responds,
// or when a conversation is torn down). `handle` is the pending turn returned by
// upsertPartnerInterim (detached by the caller so no further interim touches it).
// If `handle` is set it is updated IN PLACE — preserving its position before the
// user's turn; if `handle` is null (an interruption captured before any pause was
// ever written) a fresh finalized partner entry is appended. Returns the entry.
export function finalizePartner(exchanges, handle, { rawTranscript, cleanedTranscript, partner = null, timestamp }) {
    if (handle) {
        handle.rawTranscript = rawTranscript;
        handle.cleanedTranscript = cleanedTranscript;
        if (partner) handle.partner = partner;
        return handle;
    }
    const turn = {
        timestamp: timestamp || new Date().toISOString(),
        role: 'partner',
        rawTranscript,
        cleanedTranscript,
        partner,
    };
    exchanges.push(turn);
    return turn;
}
