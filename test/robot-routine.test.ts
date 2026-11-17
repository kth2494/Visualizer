import { describe, expect, it } from "vitest";
import { generateSequentialCommandCode } from "../src/lib/codegen";
import {
  actionsHash,
  buildRoutine,
  generateRobotActions,
  routineText,
} from "../src/lib/codegen/routine";
import { fixtures, goldenPath, loadProject } from "./support/fixtures";

const fixture = (name: string) =>
  loadProject(fixtures.find((f) => f.name === name)!.text);

describe("send to robot routine", () => {
  it("matches the golden routine and robot actions", async () => {
    const doc = fixture("actions-biobuzz");
    await expect(routineText(buildRoutine(doc, "오토1"))).toMatchFileSnapshot(
      goldenPath("actions-biobuzz", "robot", "routine.json"),
    );
    await expect(
      generateRobotActions(doc.actions, doc.hardware),
    ).toMatchFileSnapshot(
      goldenPath("actions-biobuzz", "robot", "RobotActions.java"),
    );
  });

  it("runs steps in the same order as the sequential export", () => {
    for (const name of ["actions-biobuzz", "features-1.5", "default-1.5"]) {
      const doc = fixture(name);
      const java = generateSequentialCommandCode(
        doc.startPoint,
        doc.lines,
        "Auto",
        doc.sequence,
        { actions: doc.actions, hardware: doc.hardware },
      );
      const fromJava = [...java.matchAll(/follow\(follower, (\w+)\(\)\)/g)].map(
        (m) => m[1],
      );
      const routine = buildRoutine(doc, "x");
      const fromRoutine = routine.steps.flatMap((s) =>
        "path" in s ? [s.path] : [],
      );
      expect(fromRoutine).toEqual(fromJava);
      fromRoutine.forEach((p) => expect(routine.paths[p]).toBeDefined());
    }
  });

  it("names a robot action for every action step", () => {
    const doc = fixture("actions-biobuzz");
    const java = generateRobotActions(doc.actions, doc.hardware);
    for (const step of buildRoutine(doc, "x").steps) {
      if ("action" in step) {
        expect(java).toContain(`case "${step.action}/${step.phase}":`);
      }
    }
  });

  it("keeps the routine ASCII so any charset reads it", () => {
    const text = routineText(buildRoutine(fixture("actions-biobuzz"), "오토1"));
    expect(text).not.toMatch(/[^\x20-\x7e]/);
    expect(JSON.parse(text).name).toBe("오토1");
  });

  it("changes the hash when action code changes but not when a name does", () => {
    const doc = fixture("actions-biobuzz");
    const base = actionsHash(doc.actions, doc.hardware);
    const renamed = doc.actions!.map((a) => ({ ...a, name: "다른 이름" }));
    expect(actionsHash(renamed, doc.hardware)).toBe(base);
    expect(
      actionsHash(doc.actions, { ...doc.hardware!, init: "x();" }),
    ).not.toBe(base);
  });
});
