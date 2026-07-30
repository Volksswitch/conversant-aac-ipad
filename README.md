# Conversant AAC — iPad trial build

**This repository is a deployment target, not source.** The files here are a copy
of `app/` from the `ipad` branch of the main Conversant AAC repository, pushed here
so the iPad trial can be served from a URL separate from the app that testers are
currently evaluating.

Do not edit anything here. Changes belong on the `ipad` branch of the source
repository and are copied across when a new build is published.

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

This is a work-in-progress trial. In particular the screen layout has not yet been
recalibrated for the iPad's shorter usable height, so expect a cramped layout and
possibly content sitting under the browser toolbar.

Storage in a Safari tab is *evictable* — the browser may clear it after about a
week without use. Export a backup before relying on anything you enter.
