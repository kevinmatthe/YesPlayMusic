# Local music web rebuild, 2026-11-13

The user explicitly superseded the Vue2 reuse constraint: discard legacy architecture and use YesPlayMusic only as a functional reference. Keep the implemented Go/Postgres data, sessions, stable track IDs, CAS revisions, sharing/transfer contract and acceptance scenarios. Local deployment is primary; existing Vercel integration failures are not delivery gates.

The chosen implementation is Vue3 + TypeScript + Vite + Pinia, with a single native HTMLAudioElement service outside route views. A typed API boundary owns same-origin calls; the player owns queue, source lifetime, stale-response guards and MediaSession. Components consume reactive state and send explicit commands. There is no Electron, Vue2 compatibility runtime, NetEase account service or personal cookie.

Alternative approaches considered: retaining Vue2 minimizes framework changes but keeps the old coupling/build chain; switching to React is viable but adds a different framework without a functional benefit. A fresh Vue3 implementation meets the user's modernization direction while keeping the Vue ecosystem familiar.

Keep the calm ink/cream/green visual direction, but organize a complete listening product: navigation, personal playlists/likes/history, search, device queue, now-playing/lyrics, transfer/recovery, read-only shared view. Desktop and mobile use the same global audio instance. Autoplay failure, preview-only sources and unavailable/restricted sources are explicit.

Implementation sequence:

1. Establish current dependency versions from primary docs/registry; Vite production build, strict TypeScript, Vitest setup. Add a test that the package has only modern Vue/browser dependencies and confirm it fails on the legacy package.
2. Build typed API and injectable player with deferred-response/fake-audio tests before implementation. Cover stable IDs, stale lyrics/source responses, one retry, restored progress, CAS conflict, duplicate queue occurrences and LRC timestamps.
3. Build Pinia library/session state, component-based interface, dialogs and route views over the retained API. Use accessible controls and mobile navigation. Preserve JSON import/export and revocable shares.
4. Restore the original database safely using root orchestration without clearing it; run the independent service locally. Keep synthetic fixtures separate from the real source. Validate real audio status/duration/position honestly.
5. Run typecheck, unit tests, production build, backend regressions and browser acceptance across desktop/mobile viewports. Viewport emulation is not a phone/Feishu test. Capture screenshots and runtime/rollback evidence, update the existing PRs only.

Acceptance remains the original MVP's private persistent library, global playback correctness, usable local runtime and concrete migration/config/deployment/rollback evidence. Real Feishu app authorization and physical-device background playback require the actual app/client; do not claim them from mocks.
