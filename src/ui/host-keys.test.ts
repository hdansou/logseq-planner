// @vitest-environment happy-dom
import { Window } from "happy-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installHostKeys, shouldForward, type HostDocument, type KeyLike } from "./host-keys";

const field = (html: string) => {
  const holder = document.createElement("div");
  holder.innerHTML = html;
  return holder.firstElementChild as HTMLElement;
};
const ev = (key: string, over: Partial<KeyLike> = {}): KeyLike => ({ type: "keydown", key, metaKey: false, ctrlKey: false, defaultPrevented: false, target: document.body, ...over });

describe("shouldForward (N16)", () => {
  it("forwards keydown and keyup, nothing else", () => {
    expect(shouldForward(ev("k", { metaKey: true }))).toBe(true);
    expect(shouldForward(ev("k", { metaKey: true, type: "keyup" }))).toBe(true);
    expect(shouldForward(ev("k", { type: "keypress" }))).toBe(false);
  });

  it("never forwards an event Planner prevented", () => {
    expect(shouldForward(ev("k", { metaKey: true, defaultPrevented: true }))).toBe(false);
  });

  it.each(["Escape", "Tab", "Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"])("does not forward %j without Meta or Ctrl, forwards it with either", (key) => {
    expect(shouldForward(ev(key))).toBe(false);
    expect(shouldForward(ev(key, { metaKey: true }))).toBe(true);
    expect(shouldForward(ev(key, { ctrlKey: true }))).toBe(true);
  });

  it("forwards plain letters and symbols from outside a field (t t, g shift+p)", () => {
    expect(shouldForward(ev("t"))).toBe(true);
    expect(shouldForward(ev("P"))).toBe(true);
    expect(shouldForward(ev("?"))).toBe(true);
  });

  it("forwards a bare modifier key, even from a field", () => {
    for (const key of ["Shift", "Meta", "Control", "Alt"]) {
      expect(shouldForward(ev(key))).toBe(true);
      expect(shouldForward(ev(key, { target: field("<input>") }))).toBe(true);
    }
  });

  describe("from an editable target", () => {
    const targets = { input: "<input>", textarea: "<textarea></textarea>", select: "<select></select>", contenteditable: "<div contenteditable='true'><b>x</b></div>" };
    it.each(Object.entries(targets))("%s: a plain key stays in the field", (_name, html) => {
      expect(shouldForward(ev("t", { target: field(html) }))).toBe(false);
    });
    it("a node inside a contenteditable counts as editable", () => {
      expect(shouldForward(ev("t", { target: field(targets.contenteditable).querySelector("b") }))).toBe(false);
    });
    it("contenteditable=false is not editable", () => {
      expect(shouldForward(ev("t", { target: field("<div contenteditable='false'></div>") }))).toBe(true);
    });
    it("Meta / Ctrl with a non-editing key is forwarded (Cmd+K)", () => {
      expect(shouldForward(ev("k", { metaKey: true, target: field("<input>") }))).toBe(true);
      expect(shouldForward(ev("P", { ctrlKey: true, target: field("<input>") }))).toBe(true);
    });
    it.each(["a", "A", "c", "v", "x", "z", "Z", "y", "Backspace", "Delete", "ArrowLeft", "ArrowUp"])("Cmd+%s stays in the field", (key) => {
      expect(shouldForward(ev(key, { metaKey: true, target: field("<input>") }))).toBe(false);
      expect(shouldForward(ev(key, { ctrlKey: true, target: field("<input>") }))).toBe(false);
    });
  });
});

describe("installHostKeys", () => {
  let hostWindow: Window;
  let host: HostDocument;
  let received: KeyboardEvent[];
  let prevent: boolean;
  const offs: Array<() => void> = [];
  const install = (h: HostDocument | null = host) => {
    const off = installHostKeys(document, h);
    offs.push(off);
    return off;
  };
  afterEach(() => offs.splice(0).forEach((off) => off()));
  beforeEach(() => {
    hostWindow = new Window();
    host = hostWindow.document as unknown as HostDocument;
    received = [];
    prevent = false;
    host.body.addEventListener("keydown", (e) => {
      received.push(e);
      if (prevent) e.preventDefault();
    });
    host.body.addEventListener("keyup", (e) => void received.push(e));
  });
  const press = (init: KeyboardEventInit & { keyCode?: number }, type = "keydown") => {
    const e = new KeyboardEvent(type, { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(e);
    return e;
  };

  it("re-dispatches on the host body with every field, built by the host window's KeyboardEvent", () => {
    install();
    press({ key: "k", code: "KeyK", keyCode: 75, which: 75, metaKey: true, shiftKey: true, altKey: true, ctrlKey: false } as never);
    expect(received).toHaveLength(1);
    const e = received[0];
    expect(e).toBeInstanceOf(hostWindow.KeyboardEvent);
    expect(e.type).toBe("keydown");
    expect(e).toMatchObject({ key: "k", code: "KeyK", keyCode: 75, which: 75, metaKey: true, ctrlKey: false, shiftKey: true, altKey: true, bubbles: true, cancelable: true });
  });

  it("forwards keyup too", () => {
    install();
    press({ key: "t" }, "keyup");
    expect(received.map((e) => e.type)).toEqual(["keyup"]);
  });

  it("does not forward what the rule refuses", () => {
    install();
    press({ key: "Escape" });
    expect(received).toHaveLength(0);
  });

  it("does not forward an event another listener prevented first", () => {
    const prevented = (e: Event) => e.preventDefault();
    document.addEventListener("keydown", prevented);
    offs.push(() => document.removeEventListener("keydown", prevented));
    install(); // registered after: bubble order
    press({ key: "k", metaKey: true });
    expect(received).toHaveLength(0);
  });

  it("prevents the original when the host prevented the forwarded event", () => {
    install();
    prevent = true;
    expect(press({ key: "k", metaKey: true }).defaultPrevented).toBe(true);
    prevent = false;
    expect(press({ key: "k", metaKey: true }).defaultPrevented).toBe(false);
  });

  it("a cross-origin frame (no host document) installs nothing and does not throw", () => {
    const add = vi.spyOn(document, "addEventListener");
    const off = install(null);
    expect(add).not.toHaveBeenCalled();
    expect(() => off()).not.toThrow();
    add.mockRestore();
  });

  it("the remover stops forwarding", () => {
    const off = install();
    off();
    press({ key: "k", metaKey: true });
    expect(received).toHaveLength(0);
  });
});
