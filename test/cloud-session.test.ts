import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { docUpdate, readDoc } from "../src/cloud/binding";
import { bindProject } from "../src/cloud/session";
import { createDefaultProject } from "../src/io";
import { addSegment, setActions, updatePoint } from "../src/model/commands";
import { ProjectStore } from "../src/state/project.svelte";
import type { AtomicPath } from "../src/types";
import { createSegment } from "../src/utils/normalize";
import { DEFAULT_ROBOT } from "./support/fixtures";

/** Two browsers in one room, their documents synced as each change happens. */
function room() {
  const start = addSegment(createSegment(30, 40))(
    createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp"),
  );
  const docs = [new Y.Doc(), new Y.Doc()];
  const seed = docUpdate(start);
  docs.forEach((d) => Y.applyUpdate(d, seed));
  const [a, b] = docs;
  a.on("update", (u: Uint8Array, origin) => {
    if (origin !== "remote") Y.applyUpdate(b, u, "remote");
  });
  b.on("update", (u: Uint8Array, origin) => {
    if (origin !== "remote") Y.applyUpdate(a, u, "remote");
  });
  const stores = docs.map((d) => {
    const project = new ProjectStore(readDoc(d));
    bindProject(project, d);
    return project;
  });
  const [first, second] = stores[0].doc.lines.map((l) => l.id);
  const end = (project: ProjectStore, i: number) =>
    (project.doc.lines[i] as AtomicPath).endPoint;
  const move = (lineId: string, patch: { x?: number; y?: number }) =>
    updatePoint({ kind: "path", lineId, index: 0 }, patch);
  return { alice: stores[0], bob: stores[1], first, second, end, move };
}

describe("a shared auto", () => {
  it("undoes only my own edit", () => {
    const { alice, bob, first, second, end, move } = room();
    alice.apply(move(first, { x: 11 }));
    bob.apply(move(second, { x: 22 }));
    expect(end(alice, 1).x).toBe(22);
    expect(alice.canUndo).toBe(true);

    alice.undo();
    expect(end(alice, 0).x).not.toBe(11);
    expect(end(alice, 1).x).toBe(22);
    expect(bob.doc).toEqual(alice.doc);
    expect(alice.canRedo).toBe(true);
  });

  it("keeps a remote edit when I cancel a drag", () => {
    const { alice, bob, first, second, end, move } = room();
    const before = end(alice, 0).x;
    alice.preview(move(first, { x: 50 }));
    bob.apply(move(second, { y: 7 }));
    alice.preview(move(first, { x: 60 }));
    alice.cancel();
    expect(end(alice, 0).x).toBe(before);
    expect(end(alice, 1).y).toBe(7);
    expect(bob.doc).toEqual(alice.doc);
    expect(alice.canRedo).toBe(false);
  });

  it("is never unsaved", () => {
    const { alice, bob, first, move } = room();
    alice.apply(move(first, { x: 3 }));
    expect(alice.dirty).toBe(false);
    expect(bob.dirty).toBe(false);
  });
});

describe("the team library", () => {
  /** Alice in auto A, Bob in auto B; both see the same library. */
  function team() {
    const project = (x: number) =>
      addSegment(createSegment(x, 40))(
        createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp"),
      );
    const [a, b] = [project(30), project(90)].map((doc) => {
      const y = new Y.Doc();
      Y.applyUpdate(y, docUpdate(doc));
      return y;
    });
    const [teamA, teamB] = [new Y.Doc(), new Y.Doc()];
    teamA.on("update", (u: Uint8Array, origin) => {
      if (origin !== "remote") Y.applyUpdate(teamB, u, "remote");
    });
    teamB.on("update", (u: Uint8Array, origin) => {
      if (origin !== "remote") Y.applyUpdate(teamA, u, "remote");
    });
    const alice = new ProjectStore(readDoc(a));
    const bob = new ProjectStore(readDoc(b));
    bindProject(alice, a, teamA);
    bindProject(bob, b, teamB);
    return { alice, bob, a, b };
  }
  const shoot = {
    id: "shoot",
    name: "발사",
    kind: "timed" as const,
    steps: [],
    durationMs: 500,
  };

  it("shows an action added in one auto in every other", () => {
    const { alice, bob, a } = team();
    alice.apply(setActions([shoot]));
    expect(bob.doc.actions).toEqual([shoot]);
    // The auto itself keeps only its paths.
    expect(readDoc(a).actions).toBeUndefined();
  });

  it("undoes path and action edits one step at a time, newest first", () => {
    const { alice, bob } = team();
    const lineId = alice.doc.lines[0].id;
    alice.apply(setActions([shoot]));
    alice.apply(updatePoint({ kind: "path", lineId, index: 0 }, { x: 12 }));
    alice.undo();
    expect((alice.doc.lines[0] as AtomicPath).endPoint.x).not.toBe(12);
    expect(bob.doc.actions).toEqual([shoot]);
    alice.undo();
    expect(bob.doc.actions ?? []).toEqual([]);
    expect(alice.canUndo).toBe(false);
    alice.redo();
    expect(bob.doc.actions).toEqual([shoot]);
  });
});
