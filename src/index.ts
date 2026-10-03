import "@logseq/libs";
import { registerApp } from "./app";
import { appDeps } from "./sdk";

// Keep main() minimal: registerApp defers every host registration (gotcha §18).
logseq.ready(() => registerApp(appDeps(), document.getElementById("app")!)).catch(console.error);
