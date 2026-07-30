/* "What's new" post-update notice.
 *
 * Conversant auto-updates itself on launch (a redeployed sw.js activates and the
 * controllerchange handler in index.html reloads the page — see index.html). After
 * that silent update, the freshly-loaded build shows the user a short, plain-language
 * summary of what changed since the version they last saw, so an update never happens
 * invisibly. Modeled on the Keyguard Designer web app's "What's new" system.
 *
 * The notes are BUNDLED in the app (the RELEASE_NOTES map below), not fetched — so
 * the notice works even offline / on locked-down networks: the freshly-loaded app
 * already IS the new version, so it carries its own notes.
 *
 * RELEASE_NOTES is generated from the user-facing CHANGELOG.md by
 * scripts/apply-release-notes.mjs (trigger: "apply release notes"). Do NOT edit the
 * block between the @@RELEASE_NOTES markers by hand — edit CHANGELOG.md and regenerate.
 */

import * as storage from './storage.js';

// Clinician/user-facing "What's new" notes, keyed by app version string
// (major.minor.patch). Versions with no user-visible change simply have no key.
// @@RELEASE_NOTES_START@@
const RELEASE_NOTES = {
  "0.5.98": [
    "When someone offers you a set of choices, you now get all of them. If your partner asks something like \"would you say it's mild, moderate, or severe?\", the response cards are now the choices they actually offered — one card each, in the order they said them — plus a card for when your real answer isn't on their list (\"it's somewhere in between\"). Previously all four cards were different ways of saying the same one of their choices, so the others were out of reach unless you typed them yourself. This works however they offer the choices — whether they ask \"mild, moderate, or severe?\" or simply mention what's available, as in \"we've got muffins, croissants, and a few different pastries — anything jump out at you?\". If one of the things they mention is vague, its card asks about it (\"What kind of pastries do you have?\") rather than guessing. Just listing things in passing — \"I picked up milk, eggs, and bread\" — is not an offer and is left alone. If they only offer two choices, the two spare cards are filled with the answers people actually give — \"About the same.\", \"It comes and goes.\" — or a question back to them, rather than being left empty.",
    "Choice buttons in the Express Panel, for when you want to say more. Those same choices also appear as green buttons at the start of the Express Panel. Tapping one — \"moderate\", say — asks the AI for a full set of responses all about that choice: a plain way to say it, a more hesitant one, one that adds a detail. So you can answer in one tap from the cards, or take a moment and say something fuller about one of them. The buttons appear only while a choice is on offer, and take only as many spaces as there are choices — your phrases shift along to make room and slide back afterwards. You can cap how many appear, or turn them off, under Settings → Conversation.",
    "The listening beep no longer sounds after every single exchange. If you have \"resume listening automatically\" turned on, the microphone restarts each time you reply, and the beep was sounding every time — which turned a one-time \"this device is listening\" cue into a constant interruption. It now sounds once, at the start of the conversation. With automatic resuming turned off, every time you tap Listen still beeps, because each one is a fresh, deliberate start.",
    "\"Actually, before you go —\" when someone starts saying goodbye. When the other person begins wrapping up, the goodbyes now come with one extra card that holds them a moment, so you are not limited to either saying goodbye or scrambling to type. Choosing it speaks the phrase, keeps the conversation open, and hands the floor back to you. You can reword it under Settings → Controls, and it stays put when you press \"New 4\" for different goodbyes.",
    "Better at noticing when someone is wrapping up. People rarely end a conversation by saying \"goodbye\" — they start with \"Well…\", \"Anyway…\", \"I should let you go\", \"It was good seeing you\", or \"Have a good one\". The app now recognises these as the beginning of a goodbye, while still leaving well alone when the same words simply introduce a new topic (\"Anyway, what did you think of the film?\").",
    "You can see what your partner is saying as they say it. While they were speaking, their words-so-far often sat just out of sight below the bottom of the conversation area, hidden behind the row of buttons — and only came into view once they finished. The conversation now keeps their in-progress words in view the whole time they are talking.",
    "\"New 4\" no longer forgets what you asked for. If you picked one of their choices — or typed something into Reframe — and then pressed New 4 for different wording, it used to throw that away and go back to the plain options. Now it keeps it: you get four different ways of saying the same thing. Your steering lasts as long as their turn, so once you reply it starts fresh.",
    "Practice Mode moved into Settings. Practice now lives on its own Practice tab in Settings, instead of a button on the opening screen — so you can drop into a practice conversation at any time, not just before you start. The tab lists the scenarios to choose from, and while you are practicing it shows which one you are in, with an End practice button to stop. Ending a practice conversation (either with that button or with End conversation) now returns you straight to the normal conversation screen, ready for a real conversation, rather than back to the opening screen."
  ],
  "0.5.97": [
    "Practice Mode — rehearse a conversation with the AI. On the opening screen, tap \"Practice a conversation\" and pick a scenario (ordering coffee, meeting a new colleague, a doctor's visit, catching up with a friend, a job interview). The AI plays the other person — it speaks their part aloud in its own voice — and you reply by choosing response cards, exactly like a real conversation, but with no microphone and no time pressure. Tap \"Start Listening\" to hear the other person's next turn, just as you would in a real chat. You can set the practice partner's voice in Settings → Speech & Input, and End conversation returns you to the opening screen. (Practice needs a Claude API key, since the AI both plays the partner and suggests your responses.)"
  ],
  "0.5.96": [
    "A clearer, one-at-a-time startup. The opening screens now appear in order — press Start, then (if the app just updated) the \"What's new\" summary, then a note about the API key — instead of the API-key note piling on top of the \"What's new\" screen. The API-key note explains that a key is what lets the AI suggest responses, with two buttons: \"Close\" to go straight into the app (listening and speaking in your own words work without a key) and \"Add API key to Settings\".",
    "A clearer sign that the device is listening. When you start listening, the app now plays a short chime and the Listen button turns red and gently pulses while the microphone is on. The chime is an audible heads-up for the person you're talking with — they're facing you, not the screen — that the device has started listening. You can turn the chime off in Settings → Conversation (\"Play a chime when listening starts\"); it's on by default."
  ],
  "0.5.95": [
    "No more flicker when you pick a response. Selecting a response card no longer makes a scrollbar flash across the whole screen and the command buttons and cards briefly shrink and jump left. Only the conversation area scrolls now, and the buttons stay put.",
    "The conversation scrollbar is wider and easier to grab. The scrollbar on the conversation area is now a chunky, high-contrast bar — much easier to use with limited hand control.",
    "Your spoken statements now sit in a neat bubble. Each of your statements in the conversation is now only as wide as its words (a bubble on the right), instead of a wide blue band that stretched most of the way across."
  ],
  "0.5.94": [
    "The app now tells you when your API key is missing or looks wrong. On the opening screen, if you haven't added your Claude API key yet, a clear notice appears above Start explaining the AI can't suggest responses until you add one (you can still Start and speak in your own words). In Settings → General, typing a key that doesn't look right (wrong start, spaces, too short) shows a red note under the field.",
    "New \"Test\" button for your API key (Settings → General, next to Paste). Tap it to check your key against Anthropic — it tells you \"✓ Your key is working\" or \"✗ The key was rejected,\" which catches a key that was pasted incompletely. The test costs nothing."
  ],
  "0.5.93": [
    "Winding down and saying goodbye are now two separate steps. Tapping Wind down shows statements that signal you'd like to wrap up (\"I should get going.\", \"Great catching up with you.\") — not goodbyes. Once you pick one, the actual goodbyes (\"Bye!\", \"Take care!\") appear automatically. If the other person doesn't take the hint, tap Wind down again to politely restate it.",
    "More wind-down statements and goodbyes to choose from. When you've set up more than fit on screen, the New button (and tapping Wind down again) brings up a different set — it also works this way for your conversation starters."
  ],
  "0.5.92": [
    "\"Ask them to repeat\" now keeps the reply as its own turn. After you ask the other person to repeat, what they say next appears as a new turn after your \"could you say that again?\" line — instead of being tacked onto the end of what they said before.",
    "Sentences no longer run together in the transcript. When someone's speech comes in as separate pieces, they're now joined with a space (\"Good morning. How was your weekend?\") instead of stuck together (\"Good morning.How was your weekend?\")."
  ],
  "0.5.91": [
    "A placeholder no longer talks over a button you pressed. Pressing a button that speaks — a response, an Express Panel phrase, or Repeat what I said / Hold on — now stops any \"let me think\" placeholder instantly, so it can't cut in partway through what you're saying. (Your response options still appear as usual.)"
  ],
  "0.5.90": [
    "The app's own speech no longer leaks into the other person's words. When the app spoke — a placeholder, or a repeated statement from \"Repeat what I said\" — the microphone sometimes caught a piece of it (often slightly mis-heard, like \"still\" as \"steel\") and tacked it onto what the other person said. The filter that removes the app's own voice is now much better at catching those partial and mis-heard pieces, so they're kept out of the conversation. The microphone still stays on the whole time, so the other person can still talk over the app."
  ],
  "0.5.89": [
    "Fixed: a repeated statement no longer jumps above the other person's words. When you used Repeat what I said (or Hold on / Ask them to repeat) while the other person's latest words were still on screen, your spoken line was shown above theirs. It now appears in the right place — after what they said — matching the saved record."
  ],
  "0.5.88": [
    "Saved conversations are now written as they happen. The conversation file kept in your data folder now mirrors what's on screen moment to moment — it's created the instant you start listening, the other person's words are saved at each pause (and updated as they keep talking), and your responses are saved the moment they appear. So if the app ever hiccups mid-conversation, the saved record still shows exactly what led up to it."
  ],
  "0.5.87": [
    "The settings-profile picker now shows which profile is in use. After you save or load a profile — and after restarting — the drop-down reflects the profile that's actually in effect (with an \"In use\" note), instead of resetting to the first name in the list. (Your settings were always applied correctly; only the name shown was wrong.)",
    "Press Enter to save a settings profile. Typing a name in the profile box and pressing Enter now saves your current settings under that name.",
    "\"Ask them to repeat\" no longer erases what the partner said. Tapping it asks the partner to say it again and keeps listening, but it now keeps everything they'd already said in the conversation — their repeat is added to it, nothing is thrown away.",
    "Renamed the setting \"'Pardon?' phrase\" to \"'Ask them to repeat' phrase\" to match the button's name.",
    "Fixed: the partner's full words are kept when you interrupt them. If you cut in (with an Express Panel phrase or \"In my own words\") while the partner was mid-sentence, sometimes only their first few words were saved. Now everything they'd said up to your interruption is kept in the conversation and the saved transcript."
  ],
  "0.5.86": [
    "The partner's last words are kept when you end a conversation. If the partner spoke but you ended (or restarted) the conversation before choosing a reply, their words are now saved to that conversation instead of being dropped. This also fixes a bug where those words could reappear at the top of your next conversation as if the partner had just said them, even though no one had spoken."
  ],
  "0.5.85": [
    "Move between Settings tabs with the arrow keys. If you use a physical keyboard, you can now Tab once to the column of Settings tabs and then use the up/down arrow keys to jump straight to another tab — General, About Me, Speech, and so on — instead of tabbing through everything on the current tab first.",
    "The on-screen keyboard's keys are no longer part of keyboard \"Tab\" navigation. Tabbing through Settings with a physical keyboard used to walk through all forty-odd on-screen keys; it now skips them (you still tap them as before).",
    "A \"Save\" button on each Express Panel item. When you edit a phrase, partner, or feeling and are using the on-screen keyboard, tap that item's Save to keep the change and put the keyboard away so you can see the panel again.",
    "Clearer names for the keyboard/Express Panel layouts. In Settings they're now \"Side Layout 1\", \"Bottom Layout 1\", and so on (they set the layout for both the on-screen keyboard and the Express Panel).",
    "Simpler wording on the button that loads a saved settings profile: just \"Load\"."
  ],
  "0.5.84": [
    "Fixed: wind-down replies now show the right number of cards. When the other person replied to your wind-down and the app offered your goodbyes again, it showed eight of them even when you'd chosen one card per category. It now matches your setting — four cards (or eight, if you picked eight).",
    "Faster goodbyes. While you're wrapping up, if the other person simply says goodbye, your closing cards now come back right away instead of after a short wait — so you can say your own goodbye sooner. (If they say something other than a plain farewell, the app still asks the AI for suggestions as usual.)",
    "You can now Tab between the controls in the \"In my own words\" box. Pressing Tab (or Shift+Tab) on a physical keyboard cycles through the typing box and the Speak, Reframe, and Cancel buttons instead of jumping away to controls behind the box.",
    "Keyguard-design settings are together on the Keyguard Design tab. \"Keyboard separation\" moved there from Speech & Input, and a new \"Transcript separation\" sets the gap between the transcript and the buttons below it (by making the transcript a little shorter). Both leave room for a keyguard bar without moving any button holes."
  ],
  "0.5.83": [
    "About Me now opens like every other Settings tab. Instead of taking over the whole screen with its own title bar and \"Done\" button, About Me appears in the panel next to the Settings tabs, just like General, Text Size, and the rest. Use the same Close button to return to the conversation.",
    "Save and reload your settings as named profiles. In Settings → General → Settings profiles, you can now save all of your settings (voice, silence period, dock and layout, button and gap sizes, tap mode, text sizes, placeholders) under a name, and bring them back later in one tap. Handy for keeping a known setup to return to, or copying your setup to another device — the profiles are stored in your data folder. Your API key and cost counters are not included.",
    "Fixed: saying goodbye no longer repeats the other person's last words. When you picked several farewells in a row from Wind down (for example \"Great seeing you,\" then \"This was really nice,\" then \"Bye!\"), the other person's final sentence was wrongly repeated in the conversation before each of your goodbyes. It's now recorded just once, the way it was actually said."
  ],
  "0.5.82": [
    "The app no longer goes quiet trying to guess when the other person is finished. Every time the other person pauses, it offers response suggestions (and refines them if they keep talking), until you pick one or end the conversation — you decide when their turn is over, not the app. This removes a whole class of glitch where a conversation you started could stall with no responses and no thinking-out-loud placeholder."
  ],
  "0.5.81": [
    "Fixed: conversations you start yourself now work. When you opened a conversation with a starter (for example \"Hi Tyler, got a minute?\") and the other person replied with a short go-ahead (\"Yeah, sure — any time\"), the app could go silent: no thinking-out-loud placeholder and no suggested responses. It now correctly treats their reply as your cue to lead and offers responses as expected."
  ],
  "0.5.80": [
    "Fixed a leftover clipped-looking border on the \"In my own words\" box. A thin framing line around the box had a rounded corner that got cut off at the edge of the response area, making it look broken. It's now flush and borderless, matching the response cards behind it."
  ],
  "0.5.79": [
    "The app keeps working when the AI can't be reached. If the AI service (or your internet) is unavailable, response suggestions can't be generated — but the partner's words are still shown in the transcript in blue italics (raw, since the AI couldn't tidy them up), the transcript takes on a faint red tint to flag the hiccup, and the problem is recorded in the error log. You can keep the conversation going with the Express Panel and \"In my own words\" — everything you say is spoken, shown in the transcript, and saved as usual. (Note: the browser's speech recognition itself needs an internet connection, so with no internet at all the partner's words can't be transcribed — the red tint is your signal that something's wrong.)",
    "Cleaner \"In my own words\" box. The typing box no longer draws a border around itself, and the Cancel button now has the same dark border as Reframe."
  ],
  "0.5.78": [
    "When the partner asks you to repeat, all three options now show the actual words. If the partner doesn't catch what you said, the \"say it again / say it differently / explain it more\" choices now display the real, ready-to-speak sentences on the cards (prepared the moment they ask), so you can read and pick — instead of showing a label and only producing the wording after you tap.",
    "\"Don't save this conversation\" now covers everything. When a conversation is marked not to be saved, the partner's words are also kept out of the app's error records and out of any copied bug report — previously a technical hiccup could still tuck a snippet of what the partner said into those. Nothing from a private conversation is written down now.",
    "With 8 response cards chosen, you now see 8 slots everywhere. When \"Suggestions per category\" is set to 2 (8 cards), the response area now shows eight slots when the app opens and between turns — not four — so it matches what you see while choosing a reply, and a keyguard lines up the same way throughout.",
    "More conversation closings, so \"Wind down\" fills all eight. There are now eight built-in closings (added \"I need to head out.\", \"Let's talk again soon.\", \"Take care!\", \"Catch you later.\") to match the eight starters, so an 8-card layout fills every slot when you start or end a conversation.",
    "New built-in starters and closings now appear automatically. When an update adds new default conversation starters or closings, they're added to the end of your existing list on their own — you no longer have to reset to see them. Anything you've edited or removed is still respected: your own wording stays, and a card you deleted won't come back.",
    "A placeholder now plays after anything the partner says — including a greeting. Previously the \"I'm thinking…\" placeholders only played after a question. Now the partner always hears a short response coming while you choose, so they're never left wondering whether you heard them or can communicate. After a question you'll hear a question-style \"Good question.\"; after a greeting or statement, a neutral \"Let me see.\" / \"One moment.\" (The initial delay and the per-turn limit still apply, so a quick pick plays none, and you can still set the limit to 0 to turn placeholders off.)"
  ],
  "0.5.77": [
    "Interrupting the partner now records what they had said. If you cut in with an instant statement (like a \"Bye\" Express phrase) while the partner is still talking, the words they'd said up to that point are now saved in the transcript — placed just before your interruption — instead of vanishing. If auto-listen is on, the partner keeps being recorded afterward too if they continue."
  ],
  "0.5.76": [
    "Errors are now saved inside the conversation file, in order. If something goes wrong during a conversation, the problem is written into that conversation's saved record at the moment it happens, in time order with what was said — so a support report shows exactly what failed and when. (Your turns were already saved as they happened; this adds the errors alongside them.)",
    "Each conversation is saved to its own file again. A second conversation in the same session no longer gets appended to the first conversation's file.",
    "More ways to start a conversation. Five new conversation starters were added, and when you have \"Suggestions per category\" set to 2 (eight cards), Start conversation now fills all eight cards with different openers.",
    "Your own statements go straight into the transcript. When you pick a response, type your own words, or tap an Express phrase, it is added to the conversation right after it has been spoken, instead of appearing first as a faint \"about to say\" preview line. That preview line is now only used for the app's place-holding phrases.",
    "\"Repeat what I said\", \"Hold on\", and \"Ask them to repeat\" now appear in the transcript. Anything the app says out loud for you is now part of the written conversation.",
    "Saying goodbye is quicker. After you pick a wind-down or closing line, the closing options (including \"Bye!\") stay on the cards so you can sign off without waiting for the other person to reply first.",
    "\"In my own words\" while you hold the floor now suggests statements to steer the conversation. If you've just spoken and it's your turn to lead, type where you'd like things to go and tap Reframe — the app offers statements that take the conversation there, instead of replies to a question.",
    "Fixed-purpose buttons show an icon. Buttons whose job never changes (like \"In my own words\") now show a clear icon with a tooltip, matching the rest of the control buttons."
  ],
  "0.5.75": [
    "The conversation area turns faintly red if the app hits a problem. If something goes wrong while getting responses, the conversation box gets a soft red tint — a quiet heads-up that a hiccup happened and things may act oddly for a moment (and worth mentioning if you report it). It clears on its own the next time responses come through normally, or when you start or end a conversation."
  ],
  "0.5.73": [
    "Error reports now include the conversation. The error log groups errors by the conversation they happened in (newest first), and Copy puts a full report on the clipboard — each conversation's transcript together with its errors — so you can send the whole picture, not just the error message."
  ],
  "0.5.72": [
    "The app now keeps an error log you can look at. When something goes wrong — most importantly when the AI doesn't return any response options — it's recorded with a timestamp and the conversation it happened in, so a problem from a live demo leaves a trace. View it in Settings → About → Error log (with Copy and Clear); it's also saved as errors.log in your data folder.",
    "You now see why response options didn't appear. If a generation request fails, the response area shows the reason and a Try again button instead of just sitting empty."
  ],
  "0.5.71": [
    "Word prediction: tap the box to accept a suggestion, not space. The suggested word completion is now taken only when you tap anywhere in the typing box — typing a space, comma, period or Enter no longer accepts it. This fixes cases like typing \"Yes\" and ending up with \"Yesterday\" when you only wanted \"Yes\" followed by a space (which could happen without you even seeing the box)."
  ],
  "0.5.70": [
    "The on-screen keyboard now stays put when you open \"In my own words.\" On the tablet the keyboard could still fail to appear (or vanish immediately) when the typing box opened — especially right after using an Express Panel phrase. It now stays up the whole time the typing box is open, in both the side and bottom layouts.",
    "A \"Reload the app\" button in Settings → About. Forces a fresh reload to pick up the latest version — the same as a hard refresh, but without needing to attach a keyboard to press Ctrl+Shift+R.",
    "\"In my own words\" buttons are now a single row in the side layout too. Speak, Reframe and Cancel sit in one horizontal row in both the side and bottom layouts (previously Speak and Reframe were stacked in the side layout)."
  ],
  "0.5.69": [
    "Conversations you start yourself are now saved. When you opened a conversation with an opener or an Express Panel phrase, that first thing you said wasn't being recorded — and if the whole conversation was just you speaking (no partner captured), nothing was saved to your data folder at all. Now the conversation is recorded from your very first words.",
    "The keyboard now always appears when you open \"In my own words.\" In some situations — especially right after using an Express Panel phrase — the typing box could open without the on-screen keyboard showing. It now comes up reliably.",
    "The \"In my own words\" buttons now line up with the response cards. Speak and Reframe sit exactly over the response-card area and Cancel over the \"New 4\" button, so a single keyguard fits both the response cards and the typing buttons — in both the side and bottom layouts."
  ],
  "0.5.68": [
    "The \"What's new\" notice is easier to read — it fills the transcript area, drops the header line, and moves the Close button up next to the title, so more of the space is given to the list of changes."
  ],
  "0.5.67": [
    "The \"What's new\" notice now appears in the transcript area (rather than centered on the screen), so it stays clear of a keyguard. Press Start to see it, then tap \"Got it\" to begin."
  ],
  "0.5.66": [
    "The \"What's new\" notice now appears right after you press Start, instead of on the opening screen. It stays up until you tap \"Got it\", so you can read it at your own pace."
  ],
  "0.5.65": [
    "The temporary welcome line beneath the Start button has been removed.",
    "The \"What's new\" notice now stays on screen until you dismiss it. It no longer disappears on its own when the app finishes updating — read it at your own pace, then tap \"Got it\" (or just press Start)."
  ],
  "0.5.64": [
    "A short welcome line now appears beneath the Start button on the opening screen."
  ],
  "0.5.62": [
    "See what's new after an update. When the app updates itself to a newer version, it now shows a short \"What's new\" summary of the features and fixes you've just received, so you always know what changed. You can also reopen it any time from Settings → About → \"See what's new in this version\"."
  ],
  "0.5.61": [
    "Cleaner About Me pages. Removed the redundant back button from the bottom of the About Me question pages; use the \"‹ Back to topics\" link at the top."
  ],
  "0.5.60": [
    "\"Prefer not to say\" no longer erases your answer. Marking a question as \"Prefer not to say\" now keeps whatever you had already entered, hidden from the AI, and an Undo brings your answer back. Previously it could discard an answer you had saved.",
    "Clearer buttons in About Me. The button that returns to the topic list is now labeled \"‹ Back to topics\", so it's no longer confused with the Done button that closes About Me.",
    "Simpler setting names. \"Minimum gap\" is now Minimum spacing, \"Optional Responses silence period\" is now Silence period, and the two \"Placeholder Statement Delay\" settings are now Initial placeholder delay and Subsequent placeholder delay."
  ],
  "0.5.59": [
    "\"Don't save this conversation.\" A new button on the command bar lets you keep the current conversation from being written to your data folder — useful for a private exchange you don't want stored. You can also set this as the default for every conversation in Settings → Conversation.",
    "Adjust text sizes. A new Text Size tab in Settings lets you set the size of the response cards, the transcript, the \"In my own words\" box, and the Express Panel buttons independently.",
    "Placeholders no longer talk over a returning partner. If the other person pauses and then keeps speaking, any \"still thinking\" placeholder that was about to play is now cancelled so it doesn't speak over them."
  ]
};
// @@RELEASE_NOTES_END@@

// --- semver comparison (major.minor.patch) -----------------------------------
// Returns -1 if a < b, 0 if equal, 1 if a > b. Tolerates missing parts and a
// leading "v". Non-numeric parts are treated as 0.
export function compareVersions(a, b) {
    const parse = (v) => String(v).replace(/^v/i, '').split('.').map((n) => parseInt(n, 10) || 0);
    const pa = parse(a);
    const pb = parse(b);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const da = pa[i] || 0;
        const db = pb[i] || 0;
        if (da < db) return -1;
        if (da > db) return 1;
    }
    return 0;
}

// Flat combined list (Ken's choice) of every note for versions newer than
// `sinceVersion` and no newer than `currentVersion`, ordered newest-version-first
// so the most recent changes read at the top.
export function collectWhatsNew(sinceVersion, currentVersion) {
    return Object.keys(RELEASE_NOTES)
        .filter((v) => compareVersions(v, sinceVersion) > 0 && compareVersions(v, currentVersion) <= 0)
        .sort((a, b) => compareVersions(b, a))                 // newest version first
        .flatMap((v) => (RELEASE_NOTES[v] || []).filter(Boolean));
}

// The notes to announce for this version, or [] if there's nothing to show. Also
// handles the silent baseline: a run with no prior record (brand-new user, OR the
// first version to ship this feature) just records the current version — the version
// that INTRODUCES the notice cannot announce itself. Does NOT render anything.
export function pending(currentVersion) {
    const seen = storage.loadLastSeenVersion();
    if (seen == null) {
        storage.saveLastSeenVersion(currentVersion);       // baseline, no notice
        return [];
    }
    if (compareVersions(seen, currentVersion) >= 0) return []; // already current
    return collectWhatsNew(seen, currentVersion);
}

// Render the announcement as a card INSIDE the pre-start block — i.e. within the
// Transcript control's footprint, a keyguard opening, so nothing (including "Got it")
// is obscured (Ken, July 4 2026, Spatial Stability). Called after the user presses
// Start; the app has already re-rendered itself post-update, so the transcript's
// location is known. `onDismiss` runs after "Got it" (which also records the version
// as seen — deferred to that explicit acknowledgment, never at render time).
export function renderPanel(currentVersion, notes, onDismiss) {
    const panel = document.getElementById('whatsNewPanel');
    if (!panel) return;
    panel.textContent = '';

    // Defensive: never draw an empty card (title + Close but no notes). If there's
    // nothing to announce, record the version as seen and hand straight off to the
    // caller's dismiss (which enters the conversation) so the user is never left
    // staring at a contentless card that greys the command bar behind it.
    const items = (notes || []).map((n) => String(n).trim()).filter(Boolean);
    if (!items.length) {
        markSeen(currentVersion);
        panel.hidden = true;
        if (onDismiss) onDismiss();
        return;
    }

    // Header row: title on the left, Close on the right (saves the vertical space a
    // bottom button row would take — Ken). No decorative graphic.
    const head = document.createElement('div');
    head.className = 'whatsnew-head';
    const h = document.createElement('h2');
    h.className = 'whatsnew-title';
    h.textContent = "What's new in Conversant AAC";
    const okBtn = document.createElement('button');
    okBtn.className = 'whatsnew-ok';
    okBtn.textContent = 'Close';
    head.append(h, okBtn);

    const list = document.createElement('ul');
    list.className = 'whatsnew-list';
    for (const note of items) {
        const li = document.createElement('li');
        li.textContent = note;
        list.appendChild(li);
    }

    let settled = false;
    okBtn.addEventListener('click', () => {
        if (settled) return;
        settled = true;
        markSeen(currentVersion);
        panel.hidden = true;
        panel.textContent = '';
        if (onDismiss) onDismiss();
    });

    panel.append(head, list);
    panel.hidden = false;
    okBtn.focus();
}

// Record that the user has seen the current version's announcement, so it won't
// reappear on the next launch. Called only when the user taps "Got it" — deferred to
// that explicit acknowledgment, never at render time (so nothing marks it seen early).
export function markSeen(currentVersion) {
    storage.saveLastSeenVersion(currentVersion);
}
