import "@logseq/libs";
import "./ui/theme.css";
import "./ui/workspace.css";
import "./ui/timeline.css";
import "./ui/calendar.css";
import "./ui/agenda.css";
import "./ui/kanban.css";
import "./ui/matrix.css";
import { registerApp } from "./app";
import { appDeps } from "./sdk";

// Keep main() minimal: registerApp defers every host registration (gotcha §18).
logseq
  .ready(async () => {
    // Dev-only load / refresh timings (src/dev-timings.ts, `window.__plannerTimings`). Dropped from builds.
    const timing = import.meta.env.DEV ? (await import("./dev-timings")).installTimings() : undefined;
    registerApp(appDeps(), document.getElementById("app")!, timing);
  })
  .catch(console.error);

// Dev-only: scripts/probe.mjs drives the SDK through this hook (docs/probes.md). Dropped from builds.
if (import.meta.env.DEV) void import("./dev-probe").then((m) => m.installProbeHook());
