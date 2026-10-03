import "@logseq/libs";

// Compile-time guard: references an API introduced in @logseq/libs ≥ 0.3.1.
// If this file fails typecheck, upgrade the SDK. Never imported at runtime.
// package.json carries the 0.3.4 floor (0.2.12 drops the last datascriptQuery input; runtime-only fix).
export const _sdkGuard: typeof logseq.App.getCurrentRoute = logseq.App.getCurrentRoute;
