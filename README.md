# Baseline Tennis

A personal tennis news app for iPad: top stories, an audio briefing, ATP, WTA, Grand Slams, this week's schedule with order of play, and daily Pro Tips.

- **App:** `site/` (served by GitHub Pages at https://lanternsedge.github.io/baseline/)
- **Data updater:** `scripts/update-data.mjs`, run by `.github/workflows/publish.yml` about every 30 minutes. It pulls news feeds, coaching-channel videos and ESPN tennis scoreboards into `site/data/`.
- **Tournament calendar:** `site/data/calendar.json`, checked weekly against the official ATP and WTA calendars.
- **Audio briefing:** `site/data/briefings.json`, written by a scheduled Claude task (morning every day; midday and evening editions during Grand Slams, 1000-level events and the year-end finals). `scripts/briefing.mjs plan` decides whether a run should write an edition; `scripts/briefing.mjs add draft.json` validates and adds it. The app reads it aloud with the iPad's British voices.
- **Pro Tips library and TV guide:** `site/data/library.json`.

For personal use. Headlines link to the original publishers.
