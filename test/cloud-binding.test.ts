import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { docUpdate, readDoc, writeDoc } from "../src/cloud/binding";
import { createDefaultProject, type ProjectDoc } from "../src/io";
import { addSegment, removePath, updatePoint } from "../src/model/commands";
import { createSegment } from "../src/utils/normalize";
import type { AtomicPath } from "../src/types";
import { DEFAULT_ROBOT, fixtures, loadProject } from "./support/fixtures";

const plain = (doc: ProjectDoc) => JSON.parse(JSON.stringify(doc));

/** Two documents that see each other's changes, as two browsers in one room. */
function pair(doc: ProjectDoc) {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const start = docUpdate(doc); // the room's one starting state
  Y.applyUpdate(a, start);
  Y.applyUpdate(b, start);
  const sync = () => {
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  };
  return { a, b, sync };
}

const twoPaths = () => {
  const doc = createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp");
  return addSegment(createSegment(30, 40))(doc);
};

describe("cloud binding", () => {
  for (const fixture of fixtures) {
    it(`round-trips ${fixture.name}`, () => {
      const doc = loadProject(fixture.text);
      const y = new Y.Doc();
      Y.applyUpdate(y, docUpdate(doc));
      expect(readDoc(y)).toEqual(plain(doc));
    });
  }

  it("shows one side's edit on the other", () => {
    const doc = twoPaths();
    const { a, b, sync } = pair(doc);
    const moved = updatePoint(
      { kind: "path", lineId: doc.lines[0].id, index: 0 },
      { x: 10 },
    )(doc);
    writeDoc(a, moved);
    sync();
    expect(readDoc(b)).toEqual(plain(moved));
  });

  it("keeps both people's edits to different paths and fields", () => {
    const doc = twoPaths();
    const { a, b, sync } = pair(doc);
    const [first, second] = doc.lines;
    writeDoc(
      a,
      updatePoint({ kind: "path", lineId: first.id, index: 0 }, { x: 11 })(doc),
    );
    writeDoc(
      b,
      updatePoint(
        { kind: "path", lineId: second.id, index: 0 },
        { y: 22 },
      )(
        updatePoint(
          { kind: "path", lineId: first.id, index: 0 },
          { y: 33 },
        )(doc),
      ),
    );
    sync();
    const merged = readDoc(a);
    const ends = merged.lines.map((l) => (l as AtomicPath).endPoint);
    expect(readDoc(b)).toEqual(merged);
    expect(ends[0]).toMatchObject({ x: 11, y: 33 });
    expect(ends[1].y).toBe(22);
  });

  it("reorders, adds and deletes paths without duplicates", () => {
    const doc = twoPaths();
    const { a, b, sync } = pair(doc);
    const reordered = { ...doc, lines: [doc.lines[1], doc.lines[0]] };
    writeDoc(a, reordered);
    writeDoc(b, removePath(doc.lines[0].id)(doc));
    sync();
    expect(readDoc(a)).toEqual(readDoc(b));
    expect(readDoc(a).lines.map((l) => l.id)).toEqual([doc.lines[1].id]);

    const added = addSegment(createSegment(50, 60))(readDoc(a));
    writeDoc(a, added);
    sync();
    expect(readDoc(b).lines.map((l) => l.id)).toEqual(
      added.lines.map((l) => l.id),
    );
  });

  it("adds and removes control points", () => {
    const doc = twoPaths();
    const y = new Y.Doc();
    Y.applyUpdate(y, docUpdate(doc));
    const withControls = {
      ...doc,
      lines: doc.lines.map((l, i) =>
        i === 0 && l.kind === "atomic"
          ? {
              ...l,
              controlPoints: [
                { x: 1, y: 2 },
                { x: 3, y: 4 },
              ],
            }
          : l,
      ),
    };
    writeDoc(y, withControls);
    expect(readDoc(y)).toEqual(plain(withControls));
    writeDoc(y, doc);
    expect(readDoc(y)).toEqual(plain(doc));
  });

  it("leaves absent keys absent", () => {
    const doc = createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp");
    const y = new Y.Doc();
    Y.applyUpdate(y, docUpdate({ ...doc, actions: [] }));
    writeDoc(y, { ...doc, actions: undefined });
    expect("actions" in readDoc(y)).toBe(false);
  });
});
