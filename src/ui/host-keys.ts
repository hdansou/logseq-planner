/**
 * Logseq's shortcuts while Planner is open (N16). Keyboard focus is inside the plugin frame, so the host never sees
 * the keys; a document listener in the frame re-dispatches the ones Planner did not use on the host document.
 */

/** The parts of a keyboard event the rule reads. */
export interface KeyLike {
  type: string;
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  target: unknown;
}

const NAVIGATION = new Set(["Escape", "Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
const MODIFIERS = new Set(["Shift", "Meta", "Control", "Alt"]);
/** With Meta / Ctrl held these still edit text, so a field keeps them (compared lower-case). */
const EDITING = new Set(["a", "c", "v", "x", "z", "y", "backspace", "delete", "arrowup", "arrowdown", "arrowleft", "arrowright"]);
const EDITABLE = "input, textarea, select, [contenteditable]";

const isEditable = (target: unknown): boolean => {
  const el = target as { closest?: (s: string) => Element | null } | null;
  const hit = el?.closest?.(EDITABLE);
  return !!hit && hit.getAttribute("contenteditable") !== "false";
};

/** True when the host should also get this key event. */
export function shouldForward(e: KeyLike): boolean {
  if (e.type !== "keydown" && e.type !== "keyup") return false;
  if (e.defaultPrevented) return false;
  if (MODIFIERS.has(e.key)) return true;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod && NAVIGATION.has(e.key)) return false;
  if (isEditable(e.target)) return mod && !EDITING.has(e.key.toLowerCase());
  return true;
}

/**
 * The host side the dispatcher needs: its document (events go to the body) whose window supplies `KeyboardEvent`; the
 * sidebar dock (src/ui/dock.ts, N06a) also finds `#right-sidebar` in it and takes its window's observers.
 */
export type HostDocument = Pick<Document, "body" | "activeElement" | "hasFocus" | "addEventListener" | "removeEventListener" | "querySelector" | "querySelectorAll"> & { defaultView: (Window & typeof globalThis) | null };

/** What the focus hand-back needs from the app. */
export interface FocusBack {
  /** Planner is shown. */
  isVisible(): boolean;
  /** Focuses the plugin frame (`window.focus()`). */
  focusFrame(): void;
}

/**
 * Listens on `doc` (bubble phase, so Planner's own handlers run first) and re-dispatches what `shouldForward` allows
 * on `host.body`, with `keyCode` / `which` (the host's shortcut handler reads `keyCode`) and the host window's
 * `KeyboardEvent`. A host that prevents the event makes the original prevented too. `host` null (cross-origin frame:
 * web app, dev server) installs nothing.
 *
 * Also hands focus back: when a host dialog opened by a forwarded key closes, the host's focus falls to its `body` and
 * Planner's own keys stay dead. On a host `focusout`, the next macrotask checks that nothing in the host is focused,
 * Planner is visible and the host window has focus (not in the background), then focuses the frame. Focus on a real
 * host element (a dialog's input, a toolbar button) is left alone. Returns the remover.
 */
export function installHostKeys(doc: Document, host: HostDocument | null, back: FocusBack): () => void {
  if (!host) return () => {};
  const forward = (e: KeyboardEvent) => {
    if (!shouldForward(e)) return;
    const HostKeyboardEvent = host.defaultView!.KeyboardEvent;
    const sent = new HostKeyboardEvent(e.type, {
      key: e.key, code: e.code, keyCode: e.keyCode, which: e.which,
      metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
      bubbles: true, cancelable: true,
    } as KeyboardEventInit);
    if (!host.body.dispatchEvent(sent)) e.preventDefault();
  };
  let pending: ReturnType<typeof setTimeout> | undefined;
  const afterFocusOut = () => {
    clearTimeout(pending);
    pending = setTimeout(() => {
      const active = host.activeElement;
      if ((active === null || active === host.body) && back.isVisible() && host.hasFocus()) back.focusFrame();
    }, 0);
  };
  doc.addEventListener("keydown", forward);
  doc.addEventListener("keyup", forward);
  host.addEventListener("focusout", afterFocusOut, true);
  return () => {
    clearTimeout(pending);
    host.removeEventListener("focusout", afterFocusOut, true);
    doc.removeEventListener("keydown", forward);
    doc.removeEventListener("keyup", forward);
  };
}
