import { describe, expect, it } from "vitest";
import { parseProject, serializeProject } from "../src/io";
import { setActions, setHardware, setPathActions } from "../src/model/commands";
import type { ActionDef, HardwareCode } from "../src/types";
import { atomicSegments } from "../src/utils/pathTraversal";
import { DEFAULT_ROBOT, fixtures, loadProject } from "./support/fixtures";

const base = loadProject(fixtures.find((f) => f.name === "features-1.5")!.text);
const firstId = atomicSegments(base.lines)[0].id;

const actions: ActionDef[] = [
  {
    id: "shoot",
    name: "발사",
    kind: "timed",
    durationMs: 4000,
    steps: [{ atMs: 0, code: "launch1.setVelocity(1600);" }],
  },
  { id: "intake", name: "흡입", kind: "during", start: "a();", stop: "b();" },
];
const hardware: HardwareCode = {
  imports: "import x.Y;",
  fields: "private Y y;",
  init: "y = new Y();",
};

function segment(doc: typeof base, id: string) {
  return atomicSegments(doc.lines).find((line) => line.id === id)!;
}

function reload(doc: typeof base) {
  const result = parseProject(serializeProject(doc), DEFAULT_ROBOT);
  if (!result.ok) throw new Error(result.error);
  return result.doc;
}

describe("actions in the project", () => {
  it("round-trips actions, hardware and path action ids", () => {
    const doc = setPathActions(firstId, "actionsAfter", ["shoot"])(
      setHardware(hardware)(setActions(actions)(base)),
    );
    const reloaded = reload(doc);
    expect(reloaded.actions).toEqual(actions);
    expect(reloaded.hardware).toEqual(hardware);
    expect(segment(reloaded, firstId).actionsAfter).toEqual(["shoot"]);
  });

  it("omits empty fields", () => {
    const withIds = setPathActions(firstId, "actionsAfter", ["shoot"])(
      setActions(actions)(base),
    );
    const doc = setHardware({ imports: "", fields: "", init: "" })(
      setPathActions(firstId, "actionsAfter", [])(setActions([])(withIds)),
    );
    expect("actions" in doc).toBe(false);
    expect("hardware" in doc).toBe(false);
    expect("actionsAfter" in segment(doc, firstId)).toBe(false);
  });

  it("drops malformed actions on load", () => {
    const raw = JSON.parse(serializeProject(base));
    raw.actions = [
      { id: "a" },
      42,
      { id: "b", name: "x", kind: "during", start: "", stop: "" },
      { id: "c", name: "y", kind: "timed", durationMs: "1", steps: [] },
    ];
    const result = parseProject(JSON.stringify(raw), DEFAULT_ROBOT);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.actions?.map((a) => a.id)).toEqual(["b"]);
  });

  it("drops non-string path action ids on load", () => {
    const raw = JSON.parse(serializeProject(base));
    raw.lines[0].actionsDuring = ["intake", 3];
    const result = parseProject(JSON.stringify(raw), DEFAULT_ROBOT);
    if (!result.ok) throw new Error(result.error);
    expect(result.doc.lines[0].actionsDuring).toEqual(["intake"]);
  });
});
