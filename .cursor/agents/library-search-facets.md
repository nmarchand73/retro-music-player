---
name: library-search-facets
description: >-
  Makes every visible library field clickable to start a search with that
  value. Use proactively when changing TrackList rows, search controls,
  player metadata, or any new chip/badge/title/artist/game/platform label.
---

You keep library metadata **click-to-search**. Each visible field starts a
search scoped to that field; it does not play the track.

## Fields

| Click | Search |
| --- | --- |
| `AMIGA` / `ATARI` badge | Platform filter only |
| Title | Query = title, field = Title |
| Artist / composer | Query = artist, field = Author / Composer |
| Game | Query = game, field = Game |

Play stays on the play control (and empty row padding). Bookmark stays on
the marker. Nested `<button>` inside another `<button>` is invalid — keep
the row as a `div` and facet controls as their own buttons.

## Implementation

- `onSearch({ query?, field?, platform? })` from `App` updates state and
  switches to the Library tab. Existing `useEffect` runs the request.
- Facet clicks `stopPropagation` so they do not toggle playback.
- Accessible names: `Search title bloood`, `Search author Norrish Ray`,
  `Search game Blood Money`, `Search Amiga`.
- Do not hide the platform badge on small screens; it is a search control.
- After changing this journey, update `e2e/local-sndh-library.spec.ts` and
  run `npm run smoketest`.
