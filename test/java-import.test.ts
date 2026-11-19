import { describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/io";
import { importSequentialJava } from "../src/io/javaImport";
import { generateSequentialCommandCode } from "../src/lib/codegen";
import { atomicSegments } from "../src/utils/pathTraversal";
import { DEFAULT_ROBOT, fixtures, loadProject } from "./support/fixtures";

const base = createDefaultProject(DEFAULT_ROBOT, "decode.webp");
const exportOf = (doc: ReturnType<typeof loadProject>, className = "Auto") =>
  generateSequentialCommandCode(
    doc.startPoint,
    doc.lines,
    className,
    doc.sequence,
    { actions: doc.actions, hardware: doc.hardware },
  );
const load = (text: string, from = base) => {
  const result = importSequentialJava(text, from);
  if (!result.ok) throw new Error(result.error);
  return result;
};

describe("opening an exported sequential command", () => {
  for (const fixture of fixtures) {
    it(`round-trips ${fixture.name}`, () => {
      const original = exportOf(loadProject(fixture.text));
      const result = load(original);
      expect(result.warnings).toEqual([]);
      expect(exportOf(result.doc)).toBe(original);
    });
  }

  it("reads an edited coordinate and wait", () => {
    const original = exportOf(loadProject(fixtures[0].text), "Edited");
    const edited = original
      .replace(/(Pose \w+ = poseFactory\.of\()[^,]+/, "$1100 + 2")
      .replace(/waitMs\(\d+\)/, "waitMs(750)");
    const result = load(edited);
    expect(result.warnings).toEqual([]);
    expect(result.doc.startPoint.x).toBe(102);
    expect(exportOf(result.doc, "Edited")).toContain("waitMs(750)");
  });

  it("ignores reformatting and a changed package", () => {
    const doc = loadProject(
      fixtures.find((f) => f.name === "actions-biobuzz")!.text,
    );
    const reformatted = exportOf(doc)
      .replace(/^ {12}/gm, "                ")
      .replace("package org.firstinspires.ftc.teamcode.auto;", "package x;");
    expect(load(reformatted).warnings).toEqual([]);
  });

  it("brings back actions the browser does not have", () => {
    const doc = loadProject(
      fixtures.find((f) => f.name === "actions-biobuzz")!.text,
    );
    const result = load(exportOf(doc), { ...base, actions: undefined });
    expect(result.warnings).toEqual([]);
    expect(result.doc.actions?.map((a) => a.kind).sort()).toEqual(
      doc.actions!.map((a) => a.kind).sort(),
    );
    expect(exportOf(result.doc)).toBe(exportOf(doc));
    const during = atomicSegments(result.doc.lines).filter(
      (s) => s.actionsDuring?.length,
    );
    expect(during).toHaveLength(1);
  });

  it("warns about code the next export would drop", () => {
    const original = exportOf(loadProject(fixtures[0].text));
    const extra = original.replace(
      "telemetry.update();",
      'telemetry.addLine("hi");\n            telemetry.update();',
    );
    const line = extra.split("\n").findIndex((l) => l.includes('"hi"')) + 1;
    expect(load(extra).warnings).toEqual([
      `Line ${line} has code the Visualizer does not keep. Exporting again would drop it, so save under a new name.`,
    ]);
  });

  it("refuses a hand-written OpMode", () => {
    const result = importSequentialJava(
      "public class X extends LinearOpMode { void runOpMode() {} }",
      base,
    );
    expect(result.ok).toBe(false);
  });
});

it("does not count an import Android Studio removed as lost", () => {
  const original = generateSequentialCommandCode(
    base.startPoint,
    base.lines,
    "Auto",
    base.sequence,
  );
  const optimized = original.replace(
    "import static com.pedropathing.api.Paths.*;\n",
    "",
  );
  expect(load(optimized).warnings).toEqual([]);
});
