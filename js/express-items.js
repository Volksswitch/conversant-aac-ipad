/* Express Panel — base-UI quick-speak + influencer panel (June 2026)
 *
 * The panel is now a single USER-EDITABLE, ORDERED list of typed items (Ken,
 * June 26 2026). Each item is one of three types, and the item's position in the
 * list maps 1:1 to a cell of the paired keyboard layout's grid (so one static
 * keyguard overlays both — Rule 9; the editor lets the user reorder = re-map):
 *
 *   - phrase  : { type:'phrase',  text, cat, speak? }   speaks directly on tap
 *                 (single- or confirming double-tap per Rule 10). `cat` colors it.
 *   - partner : { type:'partner', name, nickname?, personId? }   a TOGGLE that
 *                 marks who the user is talking with (a substitute / validation
 *                 for partner recognition). Personalizes openers ("Hi Tim, …")
 *                 and tells the AI who the partner is. May reference a person in
 *                 the relationship graph (personId) or be a free-form name.
 *   - feeling : { type:'feeling', text }                a TOGGLE that sets the
 *                 user's current mood so suggestions lean that way.
 *
 * Partner and Feeling are mutually-exclusive WITHIN their kind (one active
 * partner, one active feeling); tapping an active one again turns it off, and
 * tapping a different one of the same kind switches. They carry distinct colors
 * (see INFLUENCER_COLORS) so they read apart from each other and from phrases.
 *
 * This module holds only DEFAULTS + metadata; the live list lives in the
 * express-panel.js model (data folder + cache) and is edited in Settings →
 * Express Panel.
 * The space cell of the layout is always "In my own words" (handled by the
 * renderer), independent of this list.
 */

// Functional categories for PHRASE items (Ken: color phrases by category). Color
// is the SECONDARY cue — the phrase text is always shown — so this never
// violates "no meaning by color alone"; it just groups at a glance.
export const CATEGORIES = {
  affirm: { label: 'Affirm / deny', color: '#00796B', tint: '#e0f2f1' }, // teal
  social: { label: 'Social',        color: '#3949AB', tint: '#e8eaf6' }, // indigo
  pace:   { label: 'Pace / turn',   color: '#E65100', tint: '#fff3e0' }, // deep orange
  repair: { label: 'Repair',        color: '#6A1B9A', tint: '#f3e5f5' }, // purple
  need:   { label: 'Needs',         color: '#AD1457', tint: '#fce4ec' }, // magenta
  cont:   { label: 'Continuer',     color: '#546E7A', tint: '#eceff1' }, // blue-grey
};

// Distinct, saturated colors for the two influencer TYPES — different from each
// other and from every phrase category (Ken). Rendered as a solid fill so they
// pop apart from the pastel phrase buttons; the toggled-on state is stronger still.
export const INFLUENCER_COLORS = {
  partner: { color: '#5D4037', tint: '#efebe9' }, // brown
  feeling: { color: '#00838F', tint: '#e0f7fa' }, // cyan
};

// Choice chips: the alternatives the partner just offered ("mild / moderate /
// severe"), filled into the Express Panel's reserved leading cells and cleared
// when the turn ends. Green, echoing the CHOICE response cards they steer, so the
// two surfaces read as the same idea. Not user-editable — these are transient and
// AI-derived, which is exactly why they live in RESERVED cells rather than
// displacing the user's own phrases.
export const CHOICE_COLOR = { color: '#2E7D32', tint: '#e8f5e9' }; // green

// Suggested feelings for the editor's quick-add (the user can type any).
export const FEELING_PRESETS = [
  'Happy', 'Sad', 'Angry', 'Stressed', 'Curious', 'Bored',
  'Excited', 'Tired', 'Anxious', 'Calm', 'Frustrated', 'Grateful',
];

// --- item builders (defaults only) ------------------------------------------
const PH = (text, cat = 'cont', speak) => (speak ? { type: 'phrase', text, cat, speak } : { type: 'phrase', text, cat });
const FE = (text) => ({ type: 'feeling', text });

// The provided STARTING LAYOUT (Ken: "a starting layout should be provided").
// Feelings lead so the influencer concept is visible, then the common phrases.
// Partners start empty — they are personal; the user adds their own people in the
// editor (free-form or picked from People I Know). Sized to fill a typical layout.
// Stable ids ('d0', 'd1', …) so getItems() returns the SAME id every call —
// the toggle state (active partner/feeling) is tracked by id, so an unstable id
// would break the toggled-on highlight.
export const DEFAULT_ITEMS = [
  FE('Happy'), FE('Sad'), FE('Stressed'), FE('Curious'), FE('Tired'), FE('Excited'),
  PH('Yes', 'affirm'), PH('No', 'affirm'), PH('Yes please', 'affirm'), PH('No thank you', 'affirm'),
  PH('Maybe', 'affirm'), PH("I don't know", 'affirm'), PH("I'm not sure", 'affirm'), PH('I think so', 'affirm'),
  PH('Okay', 'cont'), PH('Got it', 'cont'), PH("That's funny", 'cont'), PH('I agree', 'affirm'),
  PH('Please', 'social'), PH('Thank you', 'social'), PH("You're welcome", 'social'), PH('Sorry', 'social'),
  PH('Excuse me', 'social'), PH('Hi', 'social'), PH('Bye', 'social'), PH('See you later', 'social'),
  PH('Wait', 'pace'), PH('One moment', 'pace'), PH('Go on', 'pace'), PH('Not now', 'pace'),
  PH('Say that again', 'repair'), PH('Help', 'need'),
].map((it, i) => ({ id: 'd' + i, ...it }));

// Assign a stable id to any item missing one (defaults + freshly-added items).
let _n = 0;
export function makeId() {
  return 'fp' + Date.now().toString(36) + (_n++).toString(36);
}
export function ensureIds(items) {
  return (items || []).map((it) => (it && it.id ? it : { ...it, id: makeId() }));
}
