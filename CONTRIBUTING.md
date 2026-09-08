# Contributing to HandsFree for Chrome

Use Node.js 24 and npm. Run `npm ci`, `npm run models:download`, and `npm run check` before proposing a change. Follow the component boundaries in the README. Keep strict TypeScript and validate messages at each trust boundary.

For a new command, extend the Zod union, deterministic parser, dispatcher, command guide, and tests. Test both expected behavior and rejection cases. Never execute unvalidated model output. Do not add remote JavaScript, telemetry, broad host permissions, or persistent audio capture.

For UI changes, use `npm run build` then `node scripts/preview.mjs` for a fixture preview. This preview simulates Chrome APIs and cannot validate extension permissions. Load `dist/` into Chrome for real extension testing. Test keyboard navigation and reduced motion.

For engine changes, record browser, GPU/backend, model revision, cold-start latency, and teardown behavior. The experimental 135M model has known interpretation errors; improvements need a representative evaluation set, not just a single passing example. See `docs/VALIDATION.md`.

Open an issue with reproducible steps and redacted diagnostics. Avoid sharing private URLs, transcripts, or browsing data. Contributions are licensed under Apache-2.0.
