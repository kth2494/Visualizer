import type {
  ActionDef,
  HardwareCode,
  Path,
  SequenceItem,
  StartPose,
} from "../../types";
import { instantExpression, timedExpression } from "./actions";
import { buildExportModel } from "./model";
import { round } from "./numbers";
import type {
  ActionPhase,
  HeadingCall,
  InterpolatorRef,
  PathExpr,
} from "./types";

/**
 * The file "Send to robot" puts on the robot. PedroRoutine.java rebuilds it
 * with the same Pedro calls the sequential export writes, from the same model.
 */
export const ROUTINE_FORMAT = "pedro-routine";
export const ROUTINE_VERSION = 1;

type RoutinePose = [x: number, y: number, headingDeg: number];

type RoutineInterpolator =
  | { type: "constant"; pose: RoutinePose }
  | { type: "linear"; start: RoutinePose; end: RoutinePose }
  | { type: "tangent" }
  | { type: "facingPoint"; pose: RoutinePose };

type RoutineHeading =
  | RoutineInterpolator
  | { type: "reverseTangent" }
  | {
      type: "piecewise";
      nodes: {
        until: number;
        reversed: boolean;
        interpolator: RoutineInterpolator;
      }[];
    };

export type RoutinePath =
  | {
      type: "line" | "curve" | "through";
      poses: RoutinePose[];
      heading?: RoutineHeading;
    }
  | { type: "group"; children: RoutinePath[]; heading?: RoutineHeading };

export type RoutineStep =
  { path: string } | { wait: number } | { action: string; phase: ActionPhase };

export interface Routine {
  format: typeof ROUTINE_FORMAT;
  version: typeof ROUTINE_VERSION;
  name: string;
  /** Must match RobotActions.HASH, or the robot runs stale action code. */
  actionsHash: string;
  start: RoutinePose;
  paths: Record<string, RoutinePath>;
  steps: RoutineStep[];
}

export interface RoutineSource {
  startPoint: StartPose;
  lines: Path[];
  sequence?: SequenceItem[];
  actions?: ActionDef[];
  hardware?: HardwareCode;
}

export function buildRoutine(doc: RoutineSource, name: string): Routine {
  const model = buildExportModel({
    startPoint: doc.startPoint,
    lines: doc.lines,
    sequence: doc.sequence,
    actions: doc.actions,
  });
  const poses = new Map(
    // Rounded like the Java export's literals, so both build identical paths.
    model.poses.map((p) => [
      p.varName,
      [round(p.x), round(p.y), round(p.headingDeg)] as RoutinePose,
    ]),
  );
  const pose = (varName: string) => poses.get(varName)!;

  const interpolator = (ref: InterpolatorRef): RoutineInterpolator => {
    switch (ref.kind) {
      case "constant":
        return { type: "constant", pose: pose(ref.poseVar) };
      case "linear":
        return {
          type: "linear",
          start: pose(ref.startPoseVar),
          end: pose(ref.endPoseVar),
        };
      case "tangent":
        return { type: "tangent" };
      case "facingPoint":
        return { type: "facingPoint", pose: pose(ref.poseVar) };
    }
  };

  const heading = (call: HeadingCall | null): RoutineHeading | undefined => {
    if (!call) return undefined;
    switch (call.kind) {
      case "constant":
        return { type: "constant", pose: pose(call.poseVar) };
      case "linear":
        return {
          type: "linear",
          start: pose(call.startPoseVar),
          end: pose(call.endPoseVar),
        };
      case "tangential":
        return { type: call.reversed ? "reverseTangent" : "tangent" };
      case "facingPoint":
        return { type: "facingPoint", pose: pose(call.poseVar) };
      case "piecewise":
        return {
          type: "piecewise",
          nodes: call.nodes.map((node) => ({
            until: round(node.untilT),
            reversed: node.reversed,
            interpolator: interpolator(node.interpolator),
          })),
        };
      case "unsupported":
        // Same fallback as the Java export: a path needs some interpolator.
        return { type: "tangent" };
    }
  };

  const path = (expr: PathExpr): RoutinePath => {
    const h = heading(expr.heading);
    const withHeading = h ? { heading: h } : {};
    if (expr.kind === "group") {
      return {
        type: "group",
        children: expr.children.map(path),
        ...withHeading,
      };
    }
    const middle =
      expr.throughPoseVars.length > 0
        ? expr.throughPoseVars
        : expr.controlPoseVars;
    return {
      type:
        expr.throughPoseVars.length > 0
          ? "through"
          : expr.controlPoseVars.length > 0
            ? "curve"
            : "line",
      poses: [expr.startPoseVar, ...middle, expr.endPoseVar].map(pose),
      ...withHeading,
    };
  };

  return {
    format: ROUTINE_FORMAT,
    version: ROUTINE_VERSION,
    name,
    actionsHash: actionsHash(doc.actions, doc.hardware),
    start: pose(model.startPoseVar),
    paths: Object.fromEntries(
      model.paths.map((p) => [p.methodName, path(p.expression)]),
    ),
    steps: model.sequence.flatMap((step): RoutineStep[] => {
      if (step.kind === "path") return [{ path: step.methodName }];
      if (step.kind === "wait") return [{ wait: step.durationMs }];
      return step.action
        ? [{ action: step.action.id, phase: step.action.phase }]
        : [];
    }),
  };
}

/** JSON with non-ASCII escaped, so the robot reads it the same in any charset. */
export function routineText(routine: Routine): string {
  return JSON.stringify(routine).replace(
    /[\u007f-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** FNV-1a over everything that ends up in RobotActions.java; names don't. */
export function actionsHash(
  actions: ActionDef[] = [],
  hardware?: HardwareCode,
): string {
  const text = JSON.stringify([
    actions.map((a) =>
      a.kind === "timed"
        ? [a.id, a.kind, a.durationMs, a.steps.map((s) => [s.atMs, s.code])]
        : [a.id, a.kind, a.start, a.stop],
    ),
    [hardware?.imports ?? "", hardware?.fields ?? "", hardware?.init ?? ""],
  ]);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

const indentLines = (code: string, indent: string) =>
  code
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => indent + line.trimEnd())
    .join("\n");

/** The robot half of the actions: installed once, re-installed when they change. */
export function generateRobotActions(
  actions: ActionDef[] = [],
  hardware?: HardwareCode,
): string {
  const cases = actions.flatMap((action) => {
    const kase = (phase: ActionPhase, expression: string) =>
      `            case ${JSON.stringify(`${action.id}/${phase}`)}:\n                return ${expression};`;
    const indent = "                ";
    return action.kind === "timed"
      ? [kase("after", timedExpression(action, indent))]
      : [
          kase("start", instantExpression(action.start, indent)),
          kase("stop", instantExpression(action.stop, indent)),
        ];
  });
  const imports = indentLines(hardware?.imports ?? "", "");
  const fields = indentLines(hardware?.fields ?? "", "    ");
  const init = indentLines(hardware?.init ?? "", "        ");

  return `package org.firstinspires.ftc.teamcode;

import com.pedropathing.ivy.Command;
import static com.pedropathing.ivy.commands.Commands.*;
import static com.pedropathing.ivy.groups.Groups.sequential;
import com.qualcomm.robotcore.hardware.HardwareMap;
${imports ? `${imports}\n` : ""}
/**
 * Generated by the Pedro Pathing Visualizer for Send to robot.
 * Save it again and reinstall the app whenever you change robot actions;
 * PedroRoutineRun refuses routines whose actions do not match HASH.
 */
public class RobotActions {
    public static final String HASH = "${actionsHash(actions, hardware)}";
${fields ? `\n${fields}\n` : ""}
    private final HardwareMap hardwareMap;

    public RobotActions(HardwareMap hardwareMap) {
        this.hardwareMap = hardwareMap;${init ? `\n${init}` : ""}
    }

    /** The command for an action's phase (start, stop or after), or null. */
    public Command command(String id, String phase) {
        switch (id + "/" + phase) {
${cases.length ? `${cases.join("\n")}\n` : ""}            default:
                return null;
        }
    }
}
`;
}
