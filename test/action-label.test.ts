import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/config/defaults";
import { actionLabelAt } from "../src/sim/actionLabel";
import { calculateVisualizationPathTime } from "../src/utils/timeCalculator";
import { fixtures, loadProject } from "./support/fixtures";

const doc = loadProject(
  fixtures.find((f) => f.name === "actions-biobuzz")!.text,
);
const { timeline } = calculateVisualizationPathTime(
  doc.startPoint,
  doc.lines,
  { ...DEFAULT_SETTINGS, ...doc.robot },
  doc.sequence,
  doc.actions,
);
const label = (seconds: number) =>
  actionLabelAt(timeline, seconds, doc.lines, doc.actions);
const travel = (lineId: string) =>
  timeline.find((e) => e.type === "travel" && e.lineId === lineId)!;

describe("action label during playback", () => {
  it("names a timed action with its progress while the robot waits", () => {
    const shot = timeline.find((e) => e.action === "발사")!;
    expect(label(shot.startTime + 1)).toBe("발사 1.0 / 4.0s");
  });

  it("names the while-driving actions on the path being driven", () => {
    const intake = travel("line-3");
    expect(label((intake.startTime + intake.endTime) / 2)).toBe("흡입");
  });

  it("shows nothing on a path without actions", () => {
    const plain = travel("line-2");
    expect(label((plain.startTime + plain.endTime) / 2)).toBeNull();
  });

  it("shows nothing when the project has no actions", () => {
    const intake = travel("line-3");
    expect(
      actionLabelAt(timeline, intake.startTime + 0.01, doc.lines, undefined),
    ).toBeNull();
  });
});

describe("timed actions in a group", () => {
  it("pause after the whole group, matching the export", () => {
    const features = loadProject(
      fixtures.find((f) => f.name === "features-1.5")!.text,
    );
    features.lines = features.lines.map((node) =>
      node.kind === "compound"
        ? {
            ...node,
            segments: node.segments.map((segment) =>
              segment.id === "line-quadratic"
                ? { ...segment, actionsAfter: ["shoot"] }
                : segment,
            ),
          }
        : node,
    );
    const { timeline } = calculateVisualizationPathTime(
      features.startPoint,
      features.lines,
      { ...DEFAULT_SETTINGS, ...features.robot },
      features.sequence,
      [
        {
          id: "shoot",
          name: "발사",
          kind: "timed",
          durationMs: 1000,
          steps: [],
        },
      ],
    );
    const shot = timeline.findIndex((e) => e.action === "발사");
    const cubic = timeline.findIndex((e) => e.lineId === "line-cubic");
    expect(shot).toBeGreaterThan(cubic);
  });
});
