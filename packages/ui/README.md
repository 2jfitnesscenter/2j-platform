# @2j/ui

Shared React components will consume `@2j/design-tokens`; this task defines their visual contract, not the component runtime. Components must expose keyboard and touch states consistently across desktop and mobile layouts, support light/dark semantic tokens, and keep focus indicators visible.

Initial component contracts and interaction states are documented in [`docs/design-system/foundation.md`](../../docs/design-system/foundation.md). Component implementation starts only in a scoped TASK after the UI framework/app shell is established.
