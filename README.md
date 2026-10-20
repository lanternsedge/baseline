# Baseline Tennis

A personal tennis news app for iPad: top stories, ATP, WTA, Grand Slams, this week's schedule with order of play, and daily Pro Tips.

- **App:** `site/` (served by GitHub Pages at https://lanternsedge.github.io/baseline/)
- **Data updater:** `scripts/update-data.mjs`, run by `.github/workflows/publish.yml` about every 30 minutes. It pulls news feeds, coaching-channel videos and ESPN tennis scoreboards into `site/data/`.
- **Tournament calendar:** `site/data/calendar.json`, checked weekly against the official ATP and WTA calendars.
- **Pro Tips library and TV guide:** `site/data/library.json`.

For personal use. Headlines link to the original publishers.
