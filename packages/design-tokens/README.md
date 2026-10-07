# @2j/design-tokens

Versioned design tokens shared by admin web, staff app, and client app. `tokens.json` is the authoring source; generated CSS is exported from `@2j/design-tokens/tokens.css`. Theme selection belongs to each app shell through `data-theme="dark"`; this package does not force a product default.

Run `pnpm --filter @2j/design-tokens typecheck`, `build`, and `test`. Update source JSON and regenerate CSS with `node packages/design-tokens/tooling/generate-css.mjs`; CI rejects stale generated output. Brand green is inherited from the existing 2J client app.
