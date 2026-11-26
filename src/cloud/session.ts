import * as Y from "yjs";
import type { ProjectStore } from "../state/project.svelte";
import {
  readDoc,
  readTeam,
  ROOT,
  teamRoot,
  withLibrary,
  writeDoc,
  writeTeam,
} from "./binding";

/** The origin of this browser's own edits, which are the only ones it undoes. */
export const LOCAL = Symbol("local");

/**
 * Keep `project` and `ydoc` in step: local edits go into the Y document,
 * everyone else's come back out. With `team`, robot actions and hardware
 * code live there instead, shared by every auto. Returns the unbind function.
 */
export function bindProject(
  project: ProjectStore,
  ydoc: Y.Doc,
  team?: Y.Doc,
): () => void {
  const roots = [ydoc.getMap(ROOT), ...(team ? [teamRoot(team)] : [])];
  // Steps end where the store says (each edit, drag or burst of typing), not on a timer.
  const managers = roots.map(
    (root) =>
      new Y.UndoManager(root, {
        trackedOrigins: new Set([LOCAL]),
        captureTimeout: Number.MAX_SAFE_INTEGER,
      }),
  );
  // Which document each of my steps changed, newest last, to undo in order.
  const undone: Y.UndoManager[] = [];
  const done: Y.UndoManager[] = [];
  let replaying = false;
  const refresh = () => {
    if (!project.history) return;
    project.history.canUndo = done.length > 0;
    project.history.canRedo = undone.length > 0;
  };
  managers.forEach((manager) => {
    manager.on("stack-item-added", (event: { type: "undo" | "redo" }) => {
      // A fresh edit (not a redo replaying) is a new step and clears every redo.
      if (event.type === "undo" && !replaying) {
        undone.length = 0;
        managers.forEach((m) => m.clear(false, true));
        done.push(manager);
      }
      refresh();
    });
  });
  const step = (from: Y.UndoManager[], to: Y.UndoManager[], undo: boolean) => {
    const manager = from.pop();
    if (!manager) return;
    replaying = true;
    if (undo) manager.undo();
    else manager.redo();
    replaying = false;
    to.push(manager);
    refresh();
  };

  project.history = {
    canUndo: false,
    canRedo: false,
    undo: () => step(done, undone, true),
    redo: () => step(undone, done, false),
    stop: () => managers.forEach((manager) => manager.stopCapturing()),
    cancel: () => {
      const manager = done.pop();
      if (!manager) return;
      replaying = true;
      manager.undo();
      manager.redoStack.pop();
      replaying = false;
      refresh();
    },
  };

  const current = () =>
    team ? withLibrary(readDoc(ydoc), readTeam(team)) : readDoc(ydoc);
  project.onChange = (doc) => {
    if (team) {
      // Actions live only in the library, so one edit is one undo step.
      writeDoc(
        ydoc,
        { ...doc, actions: undefined, hardware: undefined },
        LOCAL,
      );
      writeTeam(team, { actions: doc.actions, hardware: doc.hardware }, LOCAL);
    } else {
      writeDoc(ydoc, doc, LOCAL);
    }
    project.markSaved(); // a cloud auto is always saved
  };

  const onChange = (_: unknown, transaction: Y.Transaction) => {
    if (transaction.origin !== LOCAL) project.replace(current());
    refresh();
  };
  roots.forEach((root) => root.observeDeep(onChange));

  return () => {
    roots.forEach((root) => root.unobserveDeep(onChange));
    managers.forEach((manager) => manager.destroy());
    project.onChange = null;
    project.history = null;
  };
}
