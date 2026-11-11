import { describe, expect, it } from "vitest";
import { generateSequentialCommandCode } from "../src/lib/codegen";
import { instantExpression, timedExpression } from "../src/lib/codegen/actions";
import { setPathActions } from "../src/model/commands";
import type { ActionDef } from "../src/types";
import { fixtures, goldenPath, loadProject } from "./support/fixtures";

const fixture = (name: string) =>
  loadProject(fixtures.find((f) => f.name === name)!.text);

const intake: ActionDef = {
  id: "intake",
  name: "흡입",
  kind: "during",
  start: "intake.setPower(1);",
  stop: "intake.setPower(0);",
};

describe("action expressions", () => {
  it("sorts timed steps and never emits a negative or zero wait", () => {
    const src = timedExpression(
      {
        id: "s",
        name: "발사",
        kind: "timed",
        durationMs: 1000,
        steps: [
          { atMs: 1500, code: "b();" },
          { atMs: 500, code: "a();" },
        ],
      },
      "",
    );
    expect(src.indexOf("a();")).toBeLessThan(src.indexOf("b();"));
    expect(src).toContain("waitMs(500)");
    expect(src).toContain("waitMs(1000)");
    expect(src).not.toMatch(/waitMs\((0|-)/);
  });

  it("emits an empty lambda for empty code", () => {
    expect(instantExpression("", "")).toBe("instant(() -> {})");
  });

  it("indents every line of multi-line code inside the lambda", () => {
    expect(instantExpression("a();\nb();", "    ")).toBe(
      "instant(() -> {\n        a();\n        b();\n    })",
    );
  });
});

describe("sequential export with actions", () => {
  it("skips action ids that no longer exist", () => {
    const doc = fixture("actions-biobuzz");
    const src = generateSequentialCommandCode(
      doc.startPoint,
      doc.lines,
      "Auto",
      doc.sequence,
      { hardware: doc.hardware },
    );
    expect(src).not.toContain("undefined");
    expect(src).not.toContain("instant(");
  });

  it("wraps a whole group once for a during action on its segments", () => {
    let doc = fixture("features-1.5");
    doc = setPathActions("line-quadratic", "actionsDuring", ["intake"])(doc);
    doc = setPathActions("line-cubic", "actionsDuring", ["intake"])(doc);
    const src = generateSequentialCommandCode(
      doc.startPoint,
      doc.lines,
      "Auto",
      doc.sequence,
      { actions: [intake] },
    );
    expect(src.match(/intake\.setPower\(1\)/g)).toHaveLength(1);
    expect(src.match(/intake\.setPower\(0\)/g)).toHaveLength(1);
  });

  it("runs a timed action ticked on a segment inside a group after the group", () => {
    const shoot: ActionDef = {
      id: "shoot",
      name: "발사",
      kind: "timed",
      durationMs: 1000,
      steps: [{ atMs: 0, code: "shoot();" }],
    };
    const doc = setPathActions("line-quadratic", "actionsAfter", ["shoot"])(
      fixture("features-1.5"),
    );
    const src = generateSequentialCommandCode(
      doc.startPoint,
      doc.lines,
      "Auto",
      doc.sequence,
      { actions: [shoot] },
    );
    expect(src.match(/shoot\(\);/g)).toHaveLength(1);
  });

  it("emits nothing new when there are no actions or hardware", async () => {
    const doc = fixture("features-1.5");
    const src = generateSequentialCommandCode(
      doc.startPoint,
      doc.lines,
      "Auto",
      doc.sequence,
      {},
    );
    await expect(src).toMatchFileSnapshot(
      goldenPath("features-1.5", "codegen", "sequential-command.java"),
    );
  });
});
