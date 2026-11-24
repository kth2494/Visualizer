import { getContext, setContext } from "svelte";
import type { ProjectDoc } from "../io";
import type { Command } from "../model/commands";

const HISTORY_LIMIT = 200;
/** Edits sharing a coalesce key this close together form one undo step. */
const COALESCE_MS = 1000;

/**
 * The open project. The document is never mutated: every edit replaces it,
 * so undo history is a list of earlier documents and "unsaved" is a
 * reference comparison against the last saved one.
 */
export class ProjectStore {
  doc = $state.raw<ProjectDoc>()!;
  #undo = $state.raw<ProjectDoc[]>([]);
  #redo = $state.raw<ProjectDoc[]>([]);
  #saved = $state.raw<ProjectDoc>()!;
  #transactionBase: ProjectDoc | null = null;
  #lastCoalesced: { key: string; at: number } | null = null;

  #previewed = false;

  /** Set while a cloud auto is open: undo goes through it instead. */
  history = $state<SharedHistory | null>(null);
  /** Called with every document this store produces (not with `replace`d ones). */
  onChange: ((doc: ProjectDoc) => void) | null = null;

  canUndo = $derived(
    this.history ? this.history.canUndo : this.#undo.length > 0,
  );
  canRedo = $derived(
    this.history ? this.history.canRedo : this.#redo.length > 0,
  );
  dirty = $derived(this.doc !== this.#saved);

  constructor(doc: ProjectDoc) {
    this.doc = doc;
    this.#saved = doc;
  }

  /**
   * Apply an edit as one undo step. Edits passing the same `coalesce` key in
   * quick succession merge, so typing a value is a single step.
   */
  apply(command: Command, options: { coalesce?: string } = {}) {
    if (this.#transactionBase) {
      this.preview(command);
      return;
    }
    const next = command(this.doc);
    if (next === this.doc) return;

    const now = Date.now();
    const merges =
      options.coalesce !== undefined &&
      this.#lastCoalesced?.key === options.coalesce &&
      now - this.#lastCoalesced.at < COALESCE_MS;
    if (!merges) this.#record(this.doc);
    this.#lastCoalesced =
      options.coalesce === undefined
        ? null
        : { key: options.coalesce, at: now };
    this.#set(next);
  }

  /** Show an edit without recording it; `commit` records everything since as one step. */
  preview(command: Command) {
    if (!this.#transactionBase) {
      this.history?.stop();
      this.#transactionBase = this.doc;
      this.#previewed = false;
    }
    const next = command(this.doc);
    if (next === this.doc) return;
    this.#previewed = true;
    this.#set(next);
  }

  commit() {
    const base = this.#transactionBase;
    this.#transactionBase = null;
    this.#lastCoalesced = null;
    if (base && base !== this.doc) this.#record(base);
  }

  cancel() {
    if (this.#transactionBase && this.history) {
      if (this.#previewed) this.history.cancel();
    } else if (this.#transactionBase) {
      this.#set(this.#transactionBase);
    }
    this.#transactionBase = null;
  }

  undo() {
    this.commit();
    if (this.history) return this.history.undo();
    const previous = this.#undo.at(-1);
    if (!previous) return;
    this.#undo = this.#undo.slice(0, -1);
    this.#redo = [...this.#redo, this.doc];
    this.doc = previous;
  }

  redo() {
    this.commit();
    if (this.history) return this.history.redo();
    const next = this.#redo.at(-1);
    if (!next) return;
    this.#redo = this.#redo.slice(0, -1);
    this.#undo = [...this.#undo, this.doc];
    this.doc = next;
  }

  /** Open a different document. History starts over. */
  load(doc: ProjectDoc, options: { saved?: boolean } = {}) {
    this.#transactionBase = null;
    this.#lastCoalesced = null;
    this.#undo = [];
    this.#redo = [];
    this.doc = doc;
    if (options.saved ?? true) this.#saved = doc;
  }

  /** Show a document someone else changed: no undo step, nothing unsaved. */
  replace(doc: ProjectDoc) {
    this.doc = doc;
    this.#saved = doc;
  }

  markSaved() {
    this.#saved = this.doc;
  }

  #set(doc: ProjectDoc) {
    this.doc = doc;
    this.onChange?.(doc);
  }

  #record(doc: ProjectDoc) {
    if (this.history) return this.history.stop();
    this.#undo = [...this.#undo, doc].slice(-HISTORY_LIMIT);
    this.#redo = [];
  }
}

/** Undo for a shared document, where undo must skip other people's edits. */
export interface SharedHistory {
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  /** End the current undo step. */
  stop(): void;
  /** Revert the step in progress, leaving no redo. */
  cancel(): void;
}

const CONTEXT_KEY = Symbol("project");

export function provideProject(project: ProjectStore) {
  setContext(CONTEXT_KEY, project);
}

export function useProject(): ProjectStore {
  return getContext<ProjectStore>(CONTEXT_KEY);
}
