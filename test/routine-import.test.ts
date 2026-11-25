import { describe, expect, it } from "vitest";
import { createDefaultProject, serializeProject } from "../src/io";
import { importRoutine } from "../src/io/routineImport";
import { buildRoutine, routineText } from "../src/lib/codegen/routine";
import { DEFAULT_ROBOT, fixtures, loadProject } from "./support/fixtures";

const base = createDefaultProject(DEFAULT_ROBOT, "decode.webp");
const load = (text: string, from = base) => {
  const result = importRoutine(text, from);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("opening a routine from the robot", () => {
  it("opens the project it carries exactly", () => {
    const doc = loadProject(
      fixtures.find((f) => f.name === "actions-biobuzz")!.text,
    );
    const text = routineText({
      ...buildRoutine(doc, "오토1"),
      project: JSON.parse(serializeProject(doc)),
    });
    const result = load(text);
    expect(result.name).toBe("오토1");
    expect(result.warnings).toEqual([]);
    expect(serializeProject(result.doc)).toBe(serializeProject(doc));
  });

  for (const fixture of fixtures) {
    it(`rebuilds an older routine that drives the same: ${fixture.name}`, () => {
      const doc = loadProject(fixture.text);
      const routine = buildRoutine(doc, "x");
      // Same browser: its remembered actions carry the ids.
      const result = load(routineText(routine), {
        ...base,
        actions: doc.actions,
        hardware: doc.hardware,
      });
      expect(buildRoutine(result.doc, "x")).toEqual(routine);
    });
  }

  it("marks actions it cannot find so the robot still refuses them", () => {
    const doc = loadProject(
      fixtures.find((f) => f.name === "actions-biobuzz")!.text,
    );
    const result = load(routineText(buildRoutine(doc, "x")), {
      ...base,
      actions: undefined,
    });
    expect(result.warnings[0]).toMatch(/Unknown action/);
    expect(result.doc.actions?.every((a) => a.name.startsWith("Unknown"))).toBe(
      true,
    );
  });

  it("refuses a file that is not a routine", () => {
    expect(importRoutine("{}", base).ok).toBe(false);
    expect(importRoutine("not json", base).ok).toBe(false);
  });
});
