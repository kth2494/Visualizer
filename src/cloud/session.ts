import * as Y from "yjs";
import type { ProjectStore } from "../state/project.svelte";
import { readDoc, ROOT, writeDoc } from "./binding";

/** The origin of this browser's own edits, which are the only ones it undoes. */
export const LOCAL = Symbol("local");

/**
 * Keep `project` and `ydoc` in step: local edits go into the Y document,
 * everyone else's come back out. Returns the function that unbinds them.
 */
export function bindProject(project: ProjectStore, ydoc: Y.Doc): () => void {
  const root = ydoc.getMap(ROOT);
  // Steps end where the store says (each edit, drag or burst of typing), not on a timer.
  const undo = new Y.UndoManager(root, {
    trackedOrigins: new Set([LOCAL]),
    captureTimeout: Number.MAX_SAFE_INTEGER,
  });
  const refresh = () => {
    if (!project.history) return;
    project.history.canUndo = undo.canUndo();
    project.history.canRedo = undo.canRedo();
  };

  project.history = {
    canUndo: false,
    canRedo: false,
    undo: () => void undo.undo(),
    redo: () => void undo.redo(),
    stop: () => undo.stopCapturing(),
    cancel: () => {
      undo.undo();
      undo.redoStack.pop();
      refresh();
    },
  };
  project.onChange = (doc) => {
    writeDoc(ydoc, doc, LOCAL);
    project.markSaved(); // a cloud auto is always saved
  };

  const onChange = (_: unknown, transaction: Y.Transaction) => {
    if (transaction.origin !== LOCAL) project.replace(readDoc(ydoc));
    refresh();
  };
  root.observeDeep(onChange);
  undo.on("stack-item-added", refresh);
  undo.on("stack-item-popped", refresh);

  return () => {
    root.unobserveDeep(onChange);
    undo.destroy();
    project.onChange = null;
    project.history = null;
  };
}
