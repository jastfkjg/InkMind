# Writing UI regression checks

Run `npm test` for storage validation, user/novel isolation, concurrent save coalescing and failed-save retry tests. These tests use the project's existing esbuild dependency; no additional test framework is required.

## Isolated browser fixture

Use separate terminals in `frontend/`:

```bash
node tests/ui-fixture.mjs
```

```bash
VITE_API_URL=http://127.0.0.1:18991 npm run dev -- --host 127.0.0.1 --port 5198 --strictPort
```

Open `http://127.0.0.1:5198`. Sign in with `writer@example.invalid` and any nonempty test password. The fixture stores everything in memory and never connects to a real database or model. Stop both processes after testing. Never expose the fixture beyond localhost.

The fixture's `/__test/control` endpoint accepts JSON `{ "failSaves": true, "delay": 2500 }` to simulate failures and latency. Reset with `{ "failSaves": false, "delay": 0 }`. `/__test/state` exposes the in-memory chapters and PATCH log for verification. These endpoints exist only in the fixture, not the application.

## Smoke checklist

- Type in a chapter and immediately select another page: the final edit must be saved first.
- Edit during a delayed save, then leave: the newest content must win, with no overlapping PATCH requests.
- Fail saves: the editor must retain text, show retry, and prevent navigation/logout. Restore the connection and retry.
- Reopen the fixture in another tab after a failed save: offer the unsynced draft; restore only after an explicit choice.
- Select a later chapter, a mid-document selection, and a scroll position: leaving and returning must restore them.
- Generate a fixture preview: no streaming/preview content may appear in the PATCH log. Cancel restores the original; confirm uses the confirmation endpoint.
- Open version history and roll back with “save current”: the returned content must remain after autosave settles.
- Toggle focus mode and exit with Escape: global navigation and the assistant should hide and return correctly.
- Check 375px mobile width in light/dark modes, AI bottom sheets, long titles, and account-menu language/theme access.
- Check chapter search and homepage search/sort. Export and delete must remain available in More; do not delete real content while testing.

The fixture validates frontend behavior only. Real model streaming, database persistence, provider failures, native mobile keyboards and assistive technologies still need integration/device testing.

## README screenshot profile

Run `node tests/ui-fixture.mjs --demo` instead of the default fixture command to load the fictional novel “山海来信” with four chapters and readable sample prose. The other two library cards are display-only; use “山海来信” for editor interactions. All demo data is held in memory and resets when the process restarts. Default smoke-test data and failure controls are unchanged when `--demo` is omitted.

The same Vite command and test login above apply. Use a fresh browser profile if earlier smoke tests left local drafts or editor preferences. See [capture notes](../../images/readme/README.md) for exact screenshot states. This fixture covers selected UI flows only: it is not a complete backend, offline mode, or evidence of live model behavior.
