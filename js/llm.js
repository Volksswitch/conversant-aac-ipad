const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';

let apiKey = null;
let onUsageUpdate = null;
let worldviewBlock = '';
let relationshipsBlock = '';
let situationBlock = '';

export function setApiKey(key) {
    apiKey = key;
}

// Cheap client-side format check (no network). Catches the gross paste mistakes —
// missing prefix, embedded whitespace, obviously-truncated — but NOT a key that is
// subtly wrong (e.g. missing a few characters) since Anthropic keys have no fixed
// public length. That case needs testApiKey (a live call). Returns { ok, reason }.
export function validateKeyFormat(key) {
    const k = (key || '').trim();
    if (!k) return { ok: false, reason: 'empty' };
    if (/\s/.test(k)) return { ok: false, reason: 'whitespace' };
    if (!k.startsWith('sk-ant-')) return { ok: false, reason: 'prefix' };
    if (k.length < 40) return { ok: false, reason: 'short' };
    return { ok: true };
}

// Live verification against the API (the only way to catch a subtly-wrong key).
// Uses GET /v1/models — it authenticates the key but bills no tokens — so a "Test"
// costs nothing. 200 = valid; 401/403 = the key is rejected; anything else (incl. a
// thrown fetch) = couldn't reach the service. Returns { ok, reason, status }.
export async function testApiKey(key) {
    const k = (key ?? apiKey ?? '').trim();
    if (!k) return { ok: false, reason: 'empty' };
    try {
        const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
            method: 'GET',
            headers: {
                'x-api-key': k,
                'anthropic-version': '2023-06-01',
                'anthropic-dangerous-direct-browser-access': 'true',
            },
        });
        if (res.ok) return { ok: true, status: res.status };
        if (res.status === 401 || res.status === 403) return { ok: false, reason: 'rejected', status: res.status };
        return { ok: false, reason: 'error', status: res.status };
    } catch (err) {
        return { ok: false, reason: 'network', message: err.message };
    }
}

// The compact worldview profile text (worldview.buildBlock()). Set fresh before
// each generation so questionnaire edits take effect immediately. This is the
// sole personalization channel now that the interim name/about fields are gone.
export function setWorldviewBlock(text) {
    worldviewBlock = (text || '').trim();
}

// The compact relationship-graph text (relationships.buildBlock()). Set fresh
// before each generation alongside the worldview block, so people edits take
// effect immediately. Private people are already withheld by buildBlock.
export function setRelationshipsBlock(text) {
    relationshipsBlock = (text || '').trim();
}

// The current SITUATION — who the user is talking with (active Partner toggle)
// and how they're feeling (active Feeling toggle). Set fresh before each
// generation; empty when no influencer is active. Partner gives the AI the
// partner's identity (enabling nickname use + light tailoring); Feeling colors
// the tone of the suggestions.
export function setSituationBlock(text) {
    situationBlock = (text || '').trim();
}

// Builds the personalization + placeholder-safety block appended to the
// response-generation system prompt. Even with no profile set, the
// no-brackets instruction prevents the model from emitting "[Name]" blanks.
function buildProfileBlock() {
    const sections = [];
    if (worldviewBlock) sections.push(`\n\n${worldviewBlock}`);
    if (relationshipsBlock) sections.push(`\n\n${relationshipsBlock}`);
    if (situationBlock) sections.push(`\n\n${situationBlock}`);
    sections.push(`\n\nNever output placeholder text in square brackets such as [Name], [your name], or [city]. If you do not know a personal detail, phrase the response so it is not needed.`);
    return sections.join('');
}

export function onUsage(callback) {
    onUsageUpdate = callback;
}

function trackUsage(data) {
    if (!data.usage || !onUsageUpdate) return;
    onUsageUpdate(data.usage.input_tokens, data.usage.output_tokens);
}

export async function cleanupTranscript(rawText, conversationHistory) {
    if (!apiKey) return rawText;

    const contextLines = conversationHistory.slice(-6).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are cleaning up a speech-to-text transcript from a live conversation. The transcript may contain:
- Missing or incorrect punctuation and capitalization
- Words the speech recognizer misheard (e.g., "Kmart" instead of "Hey Mark", "eye pad" instead of "iPad")

Use the conversation context to identify likely mishearings and correct them. Apply proper punctuation and capitalization. Keep corrections conservative — only fix words that are clearly wrong given the context. Do not add, remove, or rephrase beyond correcting recognition errors.

Return ONLY the corrected transcript text, nothing else.${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 200,
            system: systemPrompt,
            messages: [{ role: 'user', content: rawText }]
        })
    });

    if (!response.ok) return rawText;

    const data = await response.json();
    trackUsage(data);
    return data.content[0].text.trim();
}

// Single combined call (Conversation-Engine-Design.docx §9): classify the
// partner's action AND generate a typed, slot-structured response palette AND report
// which personal facts were missing (worldview gaps log). The classification is
// emitted FIRST in the output so it is inspectable and so the model commits to
// the action type before producing responses (the CA recommendation as a structural
// property of the output).
//
// `context` is the engine's request context (design §9.1): { stt_confidence,
// sequence_stack, register, phase, last_user_utterance }. Optional.
//
// Returns { classification:{partner_action,turn_status,is_repair_initiator},
//           responses:[{slot,text,hint,...}], missingFacts:string[] }.
// `opts.avoid` (optional): an array of previously-offered option texts the user
// rejected as "not quite right" — set by the "Show me different options"
// regenerate control. When present, the model is told to take a different angle
// and not repeat those.
// `opts.steer` (optional): free-text guidance the user typed in the "In your own
// words" box and submitted via Reframe — additional context and/or direction for
// THIS regeneration ("I'm worried about the cost", "keep it short, lean toward
// declining", "I actually beat Tyler at chess last night"). One-shot: the caller
// does not persist it. Because it is user-authored it is ground truth — the model
// may treat any specifics in it as real (it is exactly how the user supplies the
// facts the anti-fabrication rule forbids the model from inventing).
// `opts.focusChoice` (optional): one of the alternatives the partner offered, set
// when the user taps a choice chip in the Express Panel. The user has picked it and
// wants the four structural responses built around THAT alternative, so it
// deliberately overrides the closed-set rule (which would otherwise re-detect the
// menu and return the choice cards again).
export async function generateResponses(conversationHistory, context = {}, opts = {}) {
    if (!apiKey) throw new Error('API key not set');

    const avoidBlock = (Array.isArray(opts.avoid) && opts.avoid.length)
        ? `\n\nThe user found the previous options not quite right and asked for a different set. Produce a meaningfully DIFFERENT palette — take a different angle, tone, or content; do not just reword these. Previous options to avoid repeating:\n${opts.avoid.map((t) => `- ${t}`).join('\n')}`
        : '';

    const steerText = (opts.steer || '').trim();
    const steerBlock = steerText
        ? `\n\nThe user typed this guidance for how to respond right now — treat it as additional context AND direction, and shape every response around it. It may state facts to convey (use them — being user-authored, they are TRUE and override the "keep it general" caution), and/or how to come across (tone, length, stance). Honor it while keeping the four-slot structure. User's guidance:\n"${steerText}"`
        : '';

    // 1 or 2 options per category (Settings, max 2). When 2, offer two genuinely
    // different alternatives per slot so each category cell can show a choice.
    const perCat = opts.perCategory === 2 ? 2 : 1;
    const perCatBlock = perCat === 2
        ? `\n\nProvide TWO distinct options for EACH of the four slots — 8 responses total (2 PREFERRED, 2 DISPREFERRED, 2 INITIATIVE, 2 REPAIR), in that slot order, best-first within each slot. The two options within a slot must be meaningfully DIFFERENT alternatives (different wording, angle, or content), both valid for that slot — not minor rephrasings.`
        : '';

    // How many cards the palette footprint can show (4 cells × 1 or 2 per cell).
    // A choice palette must fit it, so the model is told the ceiling.
    const paletteCap = perCat === 2 ? 8 : 4;

    // The user tapped a choice chip: they have PICKED one of the alternatives the
    // partner offered and now want the full structural treatment of it. This must
    // override the closed-set rule below — otherwise the model re-detects the same
    // menu and hands back the choice cards again, and the chip does nothing.
    const pick = (opts.focusChoice || '').trim();
    const focusBlock = pick
        ? `\n\nTHE USER HAS ALREADY CHOSEN. Of the alternatives the partner offered, the user wants to answer with "${pick}". The choice is settled, so the closed-set rule does NOT apply to this response: return "offered_options": [] and use the normal four structural slots. EVERY response must answer with "${pick}" — do not offer the other alternatives again, and do not hedge about which one they picked. PREFERRED states it plainly; DISPREFERRED says it with a softening or a caveat (still "${pick}", just more reluctantly or with a qualification); INITIATIVE says it and adds something — a detail, a consequence, or a question back; REPAIR stays a clarification on the partner's turn. Vary the wording so the four are genuinely different ways of saying it, not one sentence reworded.`
        : '';

    const systemPrompt = `You are an AAC (Augmentative and Alternative Communication) assistant. A non-speaking user is in a live conversation. You speak AS the user, in their voice — not as a helpful assistant. Their communication partner just spoke. First classify what the partner is doing, then generate a palette of structurally distinct responses the user might want to say.

Return ONLY a JSON object, no other text, with exactly this shape:
{
  "partner_action": "INVITATION|QUESTION|REQUEST|STATEMENT|GREETING|ASSESSMENT|CLOSING|OTHER",
  "turn_status": "COMPLETE|INCOMPLETE|CONTINUING",
  "is_repair_initiator": false,
  "offered_options": [],
  "responses": [
    // for a CLOSED-SET turn (offered_options non-empty) the responses are instead:
    //   {"slot": "CHOICE|CHOICE_OTHER|CHOICE_ASK|CHOICE_REPAIR", "text": "...", "hint": "..."}
    // and NONE of the four structural slots below are used. See the closed-set rule.
    {"slot": "PREFERRED", "text": "...", "hint": "..."},
    {"slot": "DISPREFERRED", "text": "...", "hint": "...", "account": true},
    {"slot": "INITIATIVE", "text": "...", "hint": "...", "format": "counter-offer|return-question|expansion"},
    {"slot": "REPAIR", "text": "...", "hint": "...", "trigger": "low_stt_confidence|uncertain_span|long_utterance|none"}
  ],
  "missing_facts": ["<key>", ...]
}

Speak only to what is real — this is the most important rule. You are voicing a real person in a real conversation, NOT writing fiction about a character. Never invent specific events, episodes, outcomes, results, scores, dates, numbers, places, or names that you were not given. Do NOT fabricate autobiography: e.g. never produce "I beat Tyler at a game last night", "I won three matches", "we went to the lake on Saturday", or any concrete happening you have not been told occurred. You MAY draw on the standing facts in the user's profile below (habitual activities, interests, the people in their life) and you MAY offer general, open, or non-committal replies. When a natural answer would otherwise need a specific detail you don't have, keep it GENERAL ("Been playing online games with friends lately") instead of inventing the specifics ("I won last night"). Every option must be something the user could select and have it be TRUE — either grounded in their profile, or general enough that only they would know the particulars. The user is the sole source of truth about their own life; never put invented events in their mouth.

Classification (commit to these BEFORE writing responses):
- "partner_action": the first-pair-part type the partner's utterance performs.
- "turn_status": your read of whether the turn sounds finished (COMPLETE) or still in progress (INCOMPLETE / CONTINUING). This is INFORMATIONAL ONLY — it does NOT change what you output; always produce responses regardless (the app, and ultimately the user, decides when to actually respond, not you).
- "is_repair_initiator": true ONLY if the partner is asking the USER to repeat or clarify the user's own last utterance ("What?", "Huh?", "You want what?", "Say that again?").
- "CLOSING" specifically — the partner is moving to END THE CONVERSATION. Do NOT look only for a farewell word: the move that OPENS a closing is usually semantically EMPTY — "Well…", "So…", "Anyway…", "Okay then", "Right", often trailing off. It says nothing precisely because its job is to signal "I have nothing more to add." Also classify as CLOSING: a reason framed around the USER's time ("I should let you go", "I'll let you get back to it"), an arrangement for next time ("See you Tuesday", "Talk soon", "I'll call you"), an appreciation that wraps things up ("It was really good seeing you", "Thanks for calling"), a service-encounter sign-off ("Have a good one", "Take care now", "Enjoy the rest of your day"), and of course the plain farewell ("Bye", "Goodbye", "Night").
  CRITICAL GUARD — ending a TOPIC is not ending the CONVERSATION. The same empty markers also introduce a new topic: "Anyway, what did you think of the film?" and "So, how's the new job?" are NOT closings — the partner is carrying on. Classify CLOSING only when they are moving to end the WHOLE conversation. When the marker is followed by a fresh question or a new subject, it is not a closing. If genuinely unsure, do NOT classify CLOSING — a wrong CLOSING replaces the user's response options with goodbyes while their partner is still talking, which is far more disruptive than missing one.
- "offered_options": the specific things the partner has just PUT ON THE TABLE for the user to choose among, IN THE ORDER THEY SAID THEM, as short bare labels ("mild", "moderate", "severe"). TWO forms count, and the second is the more common one in everyday talk:
  (a) an alternative question, where the list IS the question — "mild, moderate, or severe?", "coffee or tea?", "would you rather walk or drive?";
  (b) a list offered in a STATEMENT — "We've got muffins, croissants, and a few different pastries today — anything jump out at you?", "I could do Tuesday, Wednesday, or Friday.", "There's soup, salad, or a sandwich if you're hungry." The list does NOT have to be exhaustive. A question after the list ("anything jump out at you?") is a STRONG SIGNAL that the options are being offered, but it is NOT required — a plain declarative offer counts too, as the last two examples show, and those are common in casual planning. If the partner named things the user could pick, list them.
  The test is whether the partner is OFFERING them for the user to choose from — not merely mentioning them. A narrative list is NOT an offer: "I picked up milk, eggs, and bread on the way home" puts nothing on the table, so use []. An open question with no named options ("how have you been feeling?", "what do you fancy?") is [] too. NEVER invent an option the partner did not say.
  If one item is vague or open-ended ("a few different pastries", "some other bits"), do not pretend it is a definite choice — either make its card ask about it naturally ("What kind of pastries do you have?") or leave it out. And since a list like this is usually not the whole menu, keep a CHOICE_OTHER card for what the user actually wants whenever a cell is free.

CLOSED-SET TURNS override the slot structure. When "offered_options" is NOT empty, the four structural slots are the wrong shape for this turn: the user needs to be able to pick ANY of the offered alternatives, not four variations on one of them. Returning four takes on a single option is a FAILURE — it silently strips away the choices the partner actually offered. So when "offered_options" is not empty, do NOT use PREFERRED/DISPREFERRED/INITIATIVE/REPAIR at all. Instead return at most ${paletteCap} responses total, in this order:

FIRST, one {"slot": "CHOICE", "text": "...", "hint": "..."} per offered alternative, IN THE ORDER OFFERED — "text" is a natural, complete sentence answering with that alternative in the user's voice ("It's been pretty mild."), and "hint" is the bare option label ("mild"). Never make "text" the bare label on its own.

THE PARTNER'S OWN ALTERNATIVES ALWAYS TAKE PRECEDENCE over anything you would add. Never drop, merge, or omit one of them to make room for a filler below. If the alternatives exactly fill the palette — four alternatives with ${paletteCap} cells, say — return those alternatives ALONE and no fillers at all. If they somehow exceed ${paletteCap}, return the first ${paletteCap} and no fillers.

THEN, ONLY IF CELLS REMAIN, FILL EVERY ONE, up to ${paletteCap} total. A partner who offers two alternatives leaves two cells free, and leaving them empty wastes what the user can say. Fill them from this list, most useful first — each at most once unless noted:
- {"slot": "CHOICE_OTHER"} — an answer OUTSIDE the offered set: in-between, neither, or it-depends ("It's somewhere between mild and moderate.", "Neither, thanks.", "Honestly, it changes day to day."). Include this whenever a cell is free; a real person's answer often isn't on the menu. Never a bare "I don't know."
- A SECOND {"slot": "CHOICE_OTHER"} — use this when the situation has another obvious answer that isn't in the set. Two-way questions especially ("better or worse?" → "About the same." AND "It comes and goes."). Prefer this over the two below when such an answer genuinely exists; it is usually the most useful thing in a free cell.
- {"slot": "CHOICE_ASK"} — turn the question back or ask for what you need to decide ("What would you recommend?", "What are you having?", "What are my options if neither works?"). Good when the user could reasonably not know or want the partner's steer.
- {"slot": "CHOICE_REPAIR"} — ask the partner to say the choices again ("Sorry, what were the options?"). Include when the alternatives were long, unusual, or may have been misheard.
Every one of these needs the same natural "text" plus a short "hint" (a few words naming it: "in between", "ask them", "say again").

Responses — the four structural slots below apply when "offered_options" is EMPTY (for a closed set, use the CHOICE shape above instead). ALWAYS return all four — even if the turn seems to trail off, is short, or contains filler/disfluencies; the ONLY time you return "responses": [] is when is_repair_initiator is true:
- "hint" is a short glanceable label naming the response (a few words), not a truncation of "text".
- PREFERRED: the most likely thing THIS user would say, delivered plainly, no hedging.
- DISPREFERRED: a properly formed reluctant / declining / disagreeing reply — a brief MEANINGFUL softener that carries content ("I'd love to, but…", "I wish I could —"), the declination, and a short account/reason. Never a bare "No." Keep the account GENERAL or grounded in the profile — do not invent a specific excuse (a named appointment, a concrete prior plan) the user may not actually have; "I'm pretty wiped today" or "it's not really my thing" are safe, "I have a dentist appointment at 3" is fabricated.
- INITIATIVE: a response that stops the user being purely responsive — a counter-offer, a return question, or a topic expansion. Vary its grammatical format (conditional / declarative / interrogative) from the other responses.
- REPAIR: a clarification request on the PARTNER's turn — open-class ("Sorry?") when overall confidence is low, restricted ("Dinner where?") when a specific span is uncertain.

User is leading: if the engine context has "user_holds_floor_to_lead": true, the partner has just RESPONDED to something the USER initiated (an opener or pre-question such as "Can I ask you something?"). The user now holds the floor to LEAD — do NOT generate replies as if answering the partner. Treat the partner's reply, even a short one ("sure", "go ahead", "of course", "any time"), as a go-ahead, not as a question to the user. Generate responses that let the user CONTINUE and lead: PREFERRED advances what the user wanted to say or asks their actual question; INITIATIVE offers a topic or question to raise; DISPREFERRED can gracefully back off ("Actually, never mind"); REPAIR stays a clarification on the partner only if their reply was unclear.

Get to the point: NO response may begin with an empty interjection — no "Ah", "Oh", "Um", "Er", "Well", "So", "Hmm", "You know" at the start. Open with the substance. (A meaningful softener on DISPREFERRED, like "I'd love to, but…", is fine; a bare interjection is not.)

- "missing_facts": lowercase snake_case keys for personal facts about the user you needed but were not given (e.g. "home_city", "fav_team", "occupation"). Use [] if none. Always phrase responses around any missing fact — never output bracketed placeholders.

Conversation context (engine state — use it, do not echo it):
${JSON.stringify(context)}${buildProfileBlock()}${avoidBlock}${steerBlock}${perCatBlock}${focusBlock}`;

    const messages = conversationHistory.map(entry => ({
        role: entry.role === 'partner' ? 'user' : 'assistant',
        content: entry.text
    }));

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: perCat === 2 ? 1000 : 700,
            system: systemPrompt,
            messages
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    return parseGeneration(data.content[0].text.trim());
}

// Practice Mode (§8): the AI plays the communication PARTNER. Given a scenario
// persona and the conversation so far, produce the partner's next spoken line. The
// ROLES ARE INVERTED from generateResponses — here the model IS the partner, so the
// partner's own prior lines are 'assistant' and the user's responses are 'user'.
// Returns a plain string (the words to speak). Requires a key like any generation.
export async function generatePartnerUtterance(scenario, conversationHistory = []) {
    if (!apiKey) throw new Error('API key not set');

    const systemPrompt = `You are role-playing a communication partner so a non-speaking AAC user can PRACTICE having a conversation. ${scenario.partnerPersona}

The register is: ${scenario.register}.

Produce ONLY your next spoken line, as the partner — the exact words you would say out loud. Rules:
- One short, natural turn (usually one or two sentences). It is spoken aloud, so keep it easy to follow.
- Speak directly to the user in the first person. Use their name only if it is natural.
- Output ONLY the words you speak — no quotation marks, no stage directions, no narration, no role labels.
- React naturally to what the user just said and keep the conversation moving. If the conversation is just beginning, greet them and open the scenario.
- Stay in character and appropriate to the register at all times.`;

    const messages = conversationHistory.map(entry => ({
        role: entry.role === 'partner' ? 'assistant' : 'user',
        content: entry.text
    }));
    // The API requires a non-empty messages array starting with a 'user' turn. When
    // the partner opens (no history, or history that starts with the partner's own
    // line), prime it with a neutral cue so the model produces the opening line.
    if (messages.length === 0 || messages[0].role !== 'user') {
        messages.unshift({ role: 'user', content: '(Begin the conversation.)' });
    }

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({ model: MODEL, max_tokens: 200, system: systemPrompt, messages })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    let line = data.content[0].text.trim();
    // Strip a stray wrapping pair of quotes the model sometimes adds.
    line = line.replace(/^["'“”']+/, '').replace(/["'“”']+$/, '').trim();
    return line;
}

// Reframe-to-lead (Ken): the user HOLDS THE FLOOR (they just responded, or the
// conversation is between turns) and wants to STEER the conversation somewhere.
// They typed a direction in the "In your own words" box and hit Reframe. Instead
// of replies to a partner, generate STATEMENTS the user could say next to take the
// conversation where they want. Returns { responses:[{slot:'STATEMENT',text,hint}] }
// so it renders one-per-cell like openers/closers. `count` (4 or 8) matches the
// footprint capacity.
export async function generateStatements(steer, conversationHistory = [], context = {}, count = 4) {
    if (!apiKey) throw new Error('API key not set');
    const n = count === 8 ? 8 : 4;

    const contextLines = conversationHistory.slice(-8).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are an AAC assistant speaking AS a non-speaking user in a live conversation. You speak in the user's OWN voice, never as a helpful assistant. The user currently HOLDS THE FLOOR — it is their turn — and they want to LEAD the conversation in a direction. They typed this direction/goal for what they want to say or where they want things to go:
"${steer}"

Generate ${n} distinct STATEMENTS (or questions) the user could say NEXT to move the conversation toward that goal. These are things the USER initiates — NOT answers to a partner's question. Vary them: some plain statements, some questions that open the topic, some gentle lead-ins. Order them best-first.

Speak only to what is real: never invent specific events, outcomes, dates, numbers, or names you were not given. You MAY use standing facts from the user's profile below and the direction they typed (being user-authored, it is TRUE). When a natural statement would need a specific you don't have, keep it general rather than fabricating.

Do not begin any statement with an empty interjection ("Ah", "Oh", "Well", "So", "Hmm"). Open with the substance.

Return ONLY a JSON array of ${n} strings, nothing else. Example: ["...", "...", "..."].

Conversation context (engine state — use it, do not echo it):
${JSON.stringify(context)}${buildProfileBlock()}${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 600,
            system: systemPrompt,
            messages: [{ role: 'user', content: steer }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    return { responses: parseStatements(data.content[0].text.trim(), n) };
}

// Parse a JSON array of statement strings (tolerating stray prose around it) into
// STATEMENT-slot response descriptors. Falls back to splitting lines if needed.
function parseStatements(text, n) {
    let list = null;
    try { list = JSON.parse(text); } catch { /* try to extract */ }
    if (!Array.isArray(list)) {
        const m = text.match(/\[[\s\S]*\]/);
        if (m) { try { list = JSON.parse(m[0]); } catch { /* fall through */ } }
    }
    if (!Array.isArray(list)) {
        // Last resort: non-empty lines, stripped of list markers/quotes.
        list = text.split('\n').map(s => s.replace(/^\s*[-*\d.]*\s*/, '').replace(/^["']|["']$/g, '').trim()).filter(Boolean);
    }
    if (!Array.isArray(list) || !list.length) throw new Error('Could not parse statements from API');
    return list.slice(0, n).map(t => ({ slot: 'STATEMENT', text: String(t).trim(), hint: '' })).filter(m => m.text);
}

// Repair-of-self (design §7.2): the partner asked the user to repeat/clarify.
// Re-speak verbatim needs no LLM (the app handles it); this call covers the
// "rephrase" and "expand" operations on the user's own last utterance.
export async function repairSelf(lastUserUtterance, op, conversationHistory = []) {
    if (!apiKey) throw new Error('API key not set');
    const instruction = op === 'expand'
        ? 'Expand and clarify the following thing the user just said, adding a little more detail so it is clearer. Keep it natural and in the user\'s own voice.'
        : 'Rephrase the following thing the user just said so it means the same but is worded differently and may be clearer. Keep it natural and in the user\'s own voice.';

    const contextLines = conversationHistory.slice(-4).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are an AAC assistant speaking AS a non-speaking user. The partner did not understand the user's last spoken turn. ${instruction}

Return ONLY the new utterance text, nothing else.${buildProfileBlock()}${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 200,
            system: systemPrompt,
            messages: [{ role: 'user', content: lastUserUtterance }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    return data.content[0].text.trim();
}

// Pre-generate BOTH repair-of-self rewordings in ONE call (Ken, July 8 2026), so
// the Rephrase and Expand cards can show their real, immediately-speakable text
// instead of a hint + a post-tap round-trip. Fired when the partner asks the user
// to repeat ("What?"). Returns { rephrase, expand } (either '' if parsing failed).
// Re-speak needs no LLM (it's the user's last utterance verbatim), so it's not here.
export async function repairOptions(lastUserUtterance, conversationHistory = []) {
    if (!apiKey) throw new Error('API key not set');

    const contextLines = conversationHistory.slice(-4).map(entry =>
        `${entry.role === 'partner' ? 'Partner' : 'User'}: ${entry.text}`
    ).join('\n');

    const systemPrompt = `You are an AAC assistant speaking AS a non-speaking user. The partner did not understand the user's last spoken turn, so the user may want to say it again a different way. Produce TWO alternatives to the user's last utterance, both in the user's own voice:
- "rephrase": the same meaning, worded differently and possibly clearer. Same length or shorter.
- "expand": the same point with a little more detail added, so it is clearer.

Return ONLY a JSON object, no other text: {"rephrase": "...", "expand": "..."}${buildProfileBlock()}${contextLines ? '\n\nConversation so far:\n' + contextLines : ''}`;

    const response = await fetch(API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model: MODEL,
            max_tokens: 300,
            system: systemPrompt,
            messages: [{ role: 'user', content: lastUserUtterance }]
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    trackUsage(data);
    return parseRepairOptions(data.content[0].text.trim());
}

function parseRepairOptions(text) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {
        const m = text.match(/\{[\s\S]*\}/);
        if (m) { try { parsed = JSON.parse(m[0]); } catch { /* fall through */ } }
    }
    if (parsed && typeof parsed === 'object') {
        return {
            rephrase: typeof parsed.rephrase === 'string' ? parsed.rephrase.trim() : '',
            expand: typeof parsed.expand === 'string' ? parsed.expand.trim() : '',
        };
    }
    return { rephrase: '', expand: '' };
}

// Robustly parse the structured generation output. Tolerates a bare array or a
// legacy {options:[...]} object (older builds / best-effort) by mapping it onto
// the slot palette, plus stray prose around the JSON object.
function parseGeneration(text) {
    let parsed = null;
    try {
        parsed = JSON.parse(text);
    } catch {
        const obj = text.match(/\{[\s\S]*\}/);
        const arr = text.match(/\[[\s\S]*\]/);
        if (obj) { try { parsed = JSON.parse(obj[0]); } catch { /* fall through */ } }
        if (!parsed && arr) { try { parsed = JSON.parse(arr[0]); } catch { /* fall through */ } }
    }

    const SLOTS = ['PREFERRED', 'DISPREFERRED', 'INITIATIVE', 'REPAIR'];

    // Legacy: a bare array of option strings.
    if (Array.isArray(parsed)) {
        return {
            classification: null,
            responses: parsed.map((t, i) => ({ slot: SLOTS[i] || 'PREFERRED', text: String(t), hint: '' })),
            missingFacts: [],
        };
    }

    if (parsed && typeof parsed === 'object') {
        const classification = {
            partner_action: parsed.partner_action || (parsed.classification && parsed.classification.fpp) || 'OTHER',
            turn_status: parsed.turn_status || 'COMPLETE',
            is_repair_initiator: !!parsed.is_repair_initiator,
            // The closed set of alternatives the partner offered ("mild, moderate,
            // severe"), [] for an ordinary turn. Drives the CHOICE palette.
            offered_options: arr(parsed.offered_options).map((o) => String(o).trim()).filter(Boolean),
        };
        // Preferred shape: typed responses.
        if (Array.isArray(parsed.responses)) {
            return { classification, responses: parsed.responses, missingFacts: arr(parsed.missing_facts) };
        }
        // Legacy {options:[...]}.
        if (Array.isArray(parsed.options)) {
            return {
                classification,
                responses: parsed.options.map((t, i) => ({ slot: SLOTS[i] || 'PREFERRED', text: String(t), hint: '' })),
                missingFacts: arr(parsed.missing_facts),
            };
        }
    }
    throw new Error('Could not parse responses from API');
}

function arr(v) { return Array.isArray(v) ? v : []; }
