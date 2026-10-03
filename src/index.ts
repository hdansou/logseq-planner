import "@logseq/libs";
import "./ui/theme.css";
import "./ui/workspace.css";
import "./ui/timeline.css";
import { registerApp } from "./app";
import { appDeps } from "./sdk";

// Keep main() minimal: registerApp defers every host registration (gotcha §18).
logseq.ready(() => registerApp(appDeps(), document.getElementById("app")!)).catch(console.error);

// Dev-only: scripts/probe.mjs drives the SDK through this hook (docs/probes.md). Dropped from builds.
if (import.meta.env.DEV) void import("./dev-probe").then((m) => m.installProbeHook());
