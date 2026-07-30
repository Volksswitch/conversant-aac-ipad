// Practice Mode scenario library (Architecture Overview §8; Ken, July 18 2026).
//
// In Practice Mode the AI plays the communication partner: it authors the
// partner's side of one of these scenarios (spoken via TTS), and the user selects
// responses exactly as in a real conversation — the microphone is bypassed, so the
// loop can be rehearsed in acoustically clean conditions before a real conversation.
//
// This is the bundled STARTER set (one per §8 category). Custom, user-authored
// scenarios are a later increment (they'll move to a data-folder file with the
// "file in folder wins" reconciliation, like the other user-owned sets).
//
// Each scenario:
//   id            — stable key
//   category      — §8 grouping (Social / Practical / Professional / Medical / Personal)
//   title         — shown on the picker card and used in the conversation stamp
//   description   — one line shown under the title on the picker
//   opensWith     — 'partner' (the AI speaks first when the user taps Start Listening).
//                   All starter scenarios open with the partner, so the single
//                   Start-Listening-as-partner-cue flow is uniform. ('user' opens
//                   are a later addition.)
//   partnerPersona — the system-prompt description of WHO the partner is, their
//                    goal, and their tone. Drives llm.generatePartnerUtterance.
//   register      — the interactional norm set (§8: scenarios set register explicitly).

export const SCENARIOS = [
    {
        id: 'coffee-order',
        category: 'Practical',
        title: 'Ordering at a coffee shop',
        description: 'A friendly barista takes your order.',
        opensWith: 'partner',
        partnerPersona: 'You are a warm, upbeat barista at a small coffee shop. The user is a customer who just walked up to the counter. Greet them, take their order, and ask the normal follow-ups (size, hot or iced, for here or to go, anything else). Keep your turns short and natural, one or two sentences. Do not rush; let the customer lead the pace.',
        register: 'casual, friendly service encounter',
    },
    {
        id: 'new-colleague',
        category: 'Social',
        title: 'Meeting a new colleague',
        description: 'Someone new introduces themselves at work.',
        opensWith: 'partner',
        partnerPersona: 'You are a friendly new colleague meeting the user for the first time at their workplace. Introduce yourself, make light small talk (how long they have worked here, what they do, plans for the weekend). Be warm and easygoing. Keep turns short and give the user room to reply.',
        register: 'friendly, informal workplace small talk',
    },
    {
        id: 'doctor-visit',
        category: 'Medical',
        title: 'A visit to the doctor',
        description: 'A doctor asks about how you have been feeling.',
        opensWith: 'partner',
        partnerPersona: 'You are a kind, unhurried family doctor. The user is your patient at a routine visit. Ask how they have been feeling, follow up gently on what they say (when it started, how bad it is, anything that helps), and be reassuring. Ask one thing at a time. Keep turns short and never lecture.',
        register: 'calm, respectful medical consultation',
    },
    {
        id: 'friend-catchup',
        category: 'Personal',
        title: 'Catching up with a friend',
        description: 'A good friend wants to hear how you have been.',
        opensWith: 'partner',
        partnerPersona: 'You are a close, caring friend the user has not seen in a while. Greet them warmly, ask how they have been, and react with genuine interest to whatever they share (follow up, laugh, sympathize). Share a little about yourself too. Keep it relaxed and personal, short turns.',
        register: 'warm, close, personal catch-up',
    },
    {
        id: 'job-interview',
        category: 'Professional',
        title: 'A job interview',
        description: 'An interviewer asks about you and your experience.',
        opensWith: 'partner',
        partnerPersona: 'You are a polite, professional hiring manager interviewing the user for a job. Welcome them, then ask standard interview questions one at a time (tell me about yourself, why this role, a strength, a time you solved a problem). Be encouraging and give them time. Keep your turns concise.',
        register: 'polite, professional interview',
    },
];

export function getScenario(id) {
    return SCENARIOS.find(s => s.id === id) || null;
}
