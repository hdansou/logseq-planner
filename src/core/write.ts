// Shared by the writes Planner makes (Kanban moves, Timeline date edits): the property key form and the ordered write
// with its roll-back. Pure apart from the injected write call.

/** The property key the write calls take: the full ident without its leading colon (the form T01's working calls used). */
export const writeKey = (ident: string): string => ident.replace(/^:/, "");

/** How a failed write is told: what the view shows afterwards, and what did not happen when the earlier writes were put back. */
export interface WriteWords {
  /** "The board shows what the graph holds." */
  shows: string;
  /** "the card has not moved" (after ", so "). */
  unmoved: string;
}

/**
 * Runs `one` for each write in order; throws on the first one that fails (its message, then `words.shows`). When a later
 * write fails after earlier ones worked, those are put back (`undo`, newest first, each through `one`, so each is read
 * back) and the error says whether that worked: "… Start was put back to 5 Oct, so the bar has not moved." or
 * "… Putting Start back to 5 Oct failed too: … The timeline shows what the graph holds." `was` names a write's previous value.
 */
export async function writeInOrder<W extends { prop: { title: string } }>(
  writes: W[], one: (w: W) => Promise<void>, undo: (w: W) => W, was: (w: W) => string, words: WriteWords,
): Promise<void> {
  const done: W[] = [];
  for (const w of writes) {
    try {
      await one(w);
    } catch (e) {
      const failed = (e as Error).message;
      if (!done.length) throw new Error(`${failed} ${words.shows}`);
      const back: string[] = [];
      for (const d of [...done].reverse()) {
        try {
          await one(undo(d));
        } catch (r) {
          throw new Error(`${failed} Putting ${d.prop.title} back to ${was(d)} failed too: ${(r as Error).message} ${words.shows}`);
        }
        back.push(`${d.prop.title} was put back to ${was(d)}`);
      }
      throw new Error(`${failed} ${back.join(", ")}, so ${words.unmoved}.`);
    }
    done.push(w);
  }
}
