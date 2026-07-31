# Conversant AAC — iPad trial build

**This repository is a deployment target, not source.** The files here are a copy
of `app/` from **`main`** in the Conversant AAC repository, pushed here so the iPad
trial can be served from a URL separate from the app that testers are currently
evaluating.

There is no separate iPad branch. The trial and the production app are built from
the same commit on `main`: iPad-specific behavior is selected at runtime by
capability detection, never by a build flag, so the two deployments differ only in
their URL and — because of that URL — their storage namespace.

Do not edit anything here except this README. Changes belong in `app/` in the
source repository and are copied across by `scripts/publish-ipad-trial.mjs`, which
refuses to publish anything that is not already what production is serving.

## Try it

**https://volksswitch.github.io/conversant-aac-ipad/**

Open it in **Safari** on the iPad. Not Chrome or Edge: every browser on iPadOS uses
Safari's engine, but speech recognition is reachable only from Safari itself — in
Chrome and Edge it starts and then silently delivers nothing. Measured on an iPad
10th generation, iPadOS 26, on July 30 2026.

Open it as a **browser tab**, not from the Home Screen, for the same reason.

## What is deliberately different here

This build stores its data under its own namespace (`ipad:…` keys, and an `ipad/`
subdirectory in the browser's private storage), so it cannot see or disturb the
data belonging to the production app on the same origin. It therefore starts with
an empty profile. Use **Settings → General → Backup & transfer** to move real data
in or out.

## Known, expected rough edges

This is a work-in-progress trial. The screen layout has not yet been recalibrated
for the iPad's shorter usable height, so expect a cramped layout — this iPad sits
right at the lower bound of the size range the layout was tuned for, and the bounds
have not yet been re-derived. (Content sitting *under* the browser toolbar was a
separate problem and is fixed.)

Pinch-to-zoom and double-tap-to-zoom are switched off deliberately, here and on
Windows: a keyguard's holes are cut in plastic and cannot zoom with the screen. Use
**Settings → Text Size**, and **Speech & Input → Button size**, to make things
bigger.

Storage in a Safari tab is *evictable* — the browser may clear it after about a
week without use. Export a backup before relying on anything you enter.
