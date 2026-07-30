/* Icon vocabulary (UI Layout Rule 4: control buttons are icon-only).
 *
 * Inline SVG so icons inherit the button's text color (`currentColor`) and the
 * proportional font scale (sized in `em`), and so there's no icon-font/network
 * dependency. Each entry is the full <svg>; `stroke="currentColor"` + no fill
 * means a button's color rules drive the icon. Accessible names are NOT baked in
 * here — callers set aria-label/title (Rule 4: keep the accessible name even
 * though the visible control is just the glyph).
 *
 * Content buttons (response cards, Express Panel buttons) are EXEMPT — they
 * show text — so they are not in this module.
 */

const SVG = (paths) =>
    `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;

export const ICONS = {
    // Listen — microphone (the .listening selected/red state signals capture).
    mic: SVG('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><line x1="12" y1="18" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/>'),
    // Say again — single replay loop (distinct from the shuffle = regenerate).
    replay: SVG('<path d="M3 12a9 9 0 1 0 2.6-6.3"/><path d="M3 4v4h4"/>'),
    // Hold on — pause bars ("hold").
    pause: SVG('<rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/>'),
    // Pardon? — question mark in a speech bubble ("didn't catch that").
    pardon: SVG('<path d="M21 11.5a8.5 8.5 0 0 1-11.5 8L3 21l1.5-6.5A8.5 8.5 0 1 1 21 11.5z"/><path d="M10 9.2a2.2 2.2 0 1 1 3.4 2.5c-.8.5-1.4 1-1.4 1.9"/><line x1="12" y1="16.3" x2="12" y2="16.3"/>'),
    // Wind down — settle down: arrow down onto a baseline.
    windDown: SVG('<path d="M12 4v10"/><path d="M7 11l5 5 5-5"/><line x1="5" y1="20" x2="19" y2="20"/>'),
    // Start conversation — speech bubble with a plus.
    startChat: SVG('<path d="M21 11.5a8.5 8.5 0 0 1-11.5 8L3 21l1.5-6.5A8.5 8.5 0 1 1 21 11.5z"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="9.5" y1="10.5" x2="14.5" y2="10.5"/>'),
    // End conversation — X in a circle ("end"; the button is red).
    endChat: SVG('<circle cx="12" cy="12" r="9"/><line x1="8.5" y1="8.5" x2="15.5" y2="15.5"/><line x1="15.5" y1="8.5" x2="8.5" y2="15.5"/>'),
    // Regenerate / "show me different options" — shuffle (a different set).
    shuffle: SVG('<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15l6 6"/><path d="M3 4l6 6"/>'),
    // Speak — speaker with a sound wave.
    speak: SVG('<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/>'),
    // Reframe — sparkles (hand the text to the AI for new options).
    reframe: SVG('<path d="M12 3l1.7 4.3L18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7z"/><path d="M5 15l.8 2.2L8 18l-2.2.8L5 21l-.8-2.2L2 18l2.2-.8z"/>'),
    // Clear — X.
    clear: SVG('<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>'),
    // Compose / "In my own words" — a pencil (write your own words).
    compose: SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'),
    // Don't-save (privacy) — a shield with a diagonal slash: this conversation is
    // NOT written to the data folder. The .private-on selected state signals it's on.
    noSave: SVG('<path d="M12 3l7 3v5c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/><line x1="4.5" y1="4" x2="19.5" y2="20"/>'),
    // Settings — gear (Command Bar entry to Settings + About Me). Filled
    // Material-style cog: symmetric, crisp at small sizes (the stroked Feather
    // gear read as a blob — Ken, June 29 2026). Uses its own fill="currentColor"
    // rather than the stroked SVG() helper.
    settings: '<svg class="icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.49.49 0 0 0-.48-.41h-3.84a.49.49 0 0 0-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87a.49.49 0 0 0 .12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 0 0-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/></svg>',

    // Keyboard toolbar.
    cut: SVG('<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><line x1="8.2" y1="7.6" x2="20" y2="16.4"/><line x1="8.2" y1="16.4" x2="20" y2="7.6"/>'),
    copy: SVG('<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>'),
    paste: SVG('<rect x="6" y="4" width="12" height="16" rx="2"/><rect x="9" y="2.5" width="6" height="3.6" rx="1"/>'),
    hide: SVG('<path d="M5 9l7 7 7-7"/>'),
};

// Set a button to an icon + its accessible name (aria-label + title tooltip).
// `iconName` keys ICONS. Falls back to leaving the button untouched if unknown.
export function setIconButton(btn, iconName, label) {
    if (!btn || !ICONS[iconName]) return;
    btn.innerHTML = ICONS[iconName];
    btn.classList.add('icon-btn');
    if (label) {
        btn.setAttribute('aria-label', label);
        btn.title = label;
    }
}
