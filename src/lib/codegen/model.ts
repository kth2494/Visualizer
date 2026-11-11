import type {
  ActionDef,
  AtomicPath,
  HardwareCode,
  Path,
  SequenceItem,
  StartPose,
} from "../../types";
import { instantExpression, timedExpression } from "./actions";
import { curveOf, type Curve } from "../../model/curve";
import { atomicSegments } from "../../utils/pathTraversal";
import {
  headingAngleAt,
  headingGeometryAt,
} from "../../utils/headingInterpolation";
import { headingCall } from "./heading";
import { IdentifierAllocator, toClassName } from "./identifiers";
import { PEDRO_API } from "./pedroApi";
import type {
  ExportModel,
  ExportOptions,
  PathDecl,
  PathExpr,
  PoseDecl,
  SequenceStep,
} from "./types";

export interface BuildModelInput {
  startPoint: StartPose;
  lines: Path[];
  sequence?: SequenceItem[];
  mirrorHorizontally?: boolean;
  className?: string | null;
  packageName?: string;
  actions?: ActionDef[];
  hardware?: HardwareCode;
}

/** Steps sit inside `sequential(` at this depth in the emitted routine. */
const STEP_INDENT = "            ";

const DEFAULT_PACKAGE = "org.firstinspires.ftc.teamcode";

export function lineId(line: AtomicPath, index: number): string {
  return line.id || `line-${index + 1}`;
}

export function buildExportModel(input: BuildModelInput): ExportModel {
  const { startPoint } = input;
  const lines = atomicSegments(input.lines);

  const options: ExportOptions = {
    mirrorHorizontally: !!input.mirrorHorizontally,
    className: toClassName(input.className, "AutoPath"),
    packageName: input.packageName || DEFAULT_PACKAGE,
  };

  const poseNames = new IdentifierAllocator([PEDRO_API.factoryVar]);
  const methodNames = new IdentifierAllocator();

  const poses: PoseDecl[] = [];
  const paths: PathDecl[] = [];
  const warnings: string[] = [];
  let usesInterpolator = false;

  const startPoseVar = poseNames.allocate(startPoint.name, "start");
  poses.push({
    varName: startPoseVar,
    x: startPoint.x,
    y: startPoint.y,
    headingDeg: startPoint.headingDeg,
  });

  let previous = {
    varName: startPoseVar,
    x: startPoint.x,
    y: startPoint.y,
    headingDeg: startPoint.headingDeg,
  };

  const methodNameByLineId = new Map<string, string>();
  let segmentNumber = 0;
  let groupNumber = 0;

  function definePose(
    nameHint: string,
    x: number,
    y: number,
    headingDeg: number,
  ): string {
    const varName = poseNames.allocateExact(nameHint);
    poses.push({ varName, x, y, headingDeg });
    return varName;
  }

  function buildSegment(
    line: AtomicPath,
    label: string,
    notes: string[],
    /** True when an enclosing group supplies the heading instead. */
    overridden: boolean,
  ): PathExpr {
    const endPoint = line.endPoint;
    segmentNumber += 1;
    const endPoseVar = poseNames.allocate(line.name, `point${segmentNumber}`);
    const curve = curveOf({ x: previous.x, y: previous.y }, line);
    const endHeadingDeg = headingAngleAt(
      line.heading,
      "end",
      headingGeometryAt(curve, 1),
    );

    let segmentStartPoseVar = previous.varName;
    if (!overridden && line.heading.type === "linear") {
      const startHeadingDeg = headingAngleAt(line.heading, "start");
      if (segmentNumber === 1) {
        poses[0].headingDeg = startHeadingDeg;
        previous.headingDeg = startHeadingDeg;
      } else {
        segmentStartPoseVar = poseNames.allocateExact(`${endPoseVar}Start`);
        poses.push({
          varName: segmentStartPoseVar,
          x: previous.x,
          y: previous.y,
          headingDeg: startHeadingDeg,
        });
      }
    }

    poses.push({
      varName: endPoseVar,
      x: endPoint.x,
      y: endPoint.y,
      headingDeg: endHeadingDeg,
    });

    const controlPoseVars = line.controlPoints.map((controlPoint, cpIndex) => {
      const varName = poseNames.allocateExact(
        `${endPoseVar}Control${cpIndex + 1}`,
      );
      poses.push({
        varName,
        x: controlPoint.x,
        y: controlPoint.y,
        headingDeg: 0,
      });
      return varName;
    });
    const throughPoseVars = (line.throughPoints ?? []).map(
      (throughPoint, pointIndex) => {
        const varName = poseNames.allocateExact(
          `${endPoseVar}Through${pointIndex + 1}`,
        );
        poses.push({
          varName,
          x: throughPoint.x,
          y: throughPoint.y,
          headingDeg: 0,
        });
        return varName;
      },
    );

    // A group's interpolator replaces its children's, so emitting the child's
    // own heading here would be dead weight the reader has to discount.
    const heading = overridden
      ? null
      : resolveHeading(line.heading, {
          startPoseVar: segmentStartPoseVar,
          endPoseVar,
          endX: endPoint.x,
          endY: endPoint.y,
          curve,
          label,
          notes,
        });

    previous = {
      varName: endPoseVar,
      x: endPoint.x,
      y: endPoint.y,
      headingDeg: endHeadingDeg,
    };

    return {
      kind: "segment",
      startPoseVar: segmentStartPoseVar,
      controlPoseVars,
      throughPoseVars,
      endPoseVar,
      heading,
    };
  }

  function resolveHeading(
    source: AtomicPath["heading"],
    ctx: {
      startPoseVar: string;
      endPoseVar: string;
      endX: number;
      endY: number;
      curve?: Curve;
      label: string;
      notes: string[];
    },
  ) {
    const heading = headingCall(source, {
      startPoseVar: ctx.startPoseVar,
      endPoseVar: ctx.endPoseVar,
      endX: ctx.endX,
      endY: ctx.endY,
      curve: ctx.curve,
      definePose,
      warn(message) {
        ctx.notes.push(message);
        warnings.push(`${ctx.label}: ${message}`);
      },
    });

    if (heading.kind === "unsupported") {
      ctx.notes.unshift(heading.reason);
      warnings.push(`${ctx.label}: ${heading.reason}`);
    }
    if (heading.kind === "piecewise") usesInterpolator = true;
    return heading;
  }

  function buildNode(
    node: Path,
    label: string,
    notes: string[],
    overridden: boolean,
  ): PathExpr {
    if (node.kind !== "compound") {
      return buildSegment(node, label, notes, overridden);
    }

    groupNumber += 1;
    const groupLabel = node.name || `group${groupNumber}`;
    const overridesChildren = Boolean(node.heading) && !overridden;
    const groupStart = previous;

    const children = node.segments.map((child) =>
      buildNode(child, label, notes, overridden || Boolean(node.heading)),
    );

    let heading = null;
    if (overridesChildren && node.heading) {
      // The group's interpolator spans the whole group, so its poses sit at
      // the group's own ends rather than any child's.
      heading = resolveHeading(node.heading, {
        startPoseVar: definePose(
          `${groupLabel}Start`,
          groupStart.x,
          groupStart.y,
          headingAngleAt(node.heading, "start"),
        ),
        endPoseVar: definePose(
          `${groupLabel}End`,
          previous.x,
          previous.y,
          headingAngleAt(node.heading, "end"),
        ),
        endX: previous.x,
        endY: previous.y,
        label,
        notes,
      });
    }

    return { kind: "group", children, heading };
  }

  input.lines.forEach((node, index) => {
    const methodName = methodNames.allocate(node.name, `path${index + 1}`);
    const notes: string[] = [];
    const expression = buildNode(node, methodName, notes, false);

    // Every segment the method drives maps to it, so a sequence written in
    // terms of segments still resolves once groups exist.
    for (const segment of atomicSegments([node])) {
      methodNameByLineId.set(segment.id, methodName);
    }

    paths.push({
      methodName,
      expression,
      note: notes.length ? `TODO: ${notes.join("; ")}` : undefined,
    });
  });

  return {
    options,
    startPoseVar,
    poses,
    paths,
    sequence: buildSequence(
      lines,
      paths,
      methodNameByLineId,
      input.sequence,
      input.actions ?? [],
    ),
    hardware: input.hardware,
    warnings,
    usesInterpolator,
  };
}

function buildSequence(
  lines: AtomicPath[],
  paths: PathDecl[],
  methodNameByLineId: Map<string, string>,
  sequence: SequenceItem[] | undefined,
  actions: ActionDef[],
): SequenceStep[] {
  // Fall back to running every path in declaration order.
  const allPaths = (): SequenceStep[] =>
    paths.map((path) => ({
      kind: "path" as const,
      methodName: path.methodName,
    }));

  const hasSequence = !!sequence && sequence.length > 0;
  if (!hasSequence && actions.length === 0) return allPaths();
  const items: SequenceItem[] = hasSequence
    ? sequence
    : lines.map((line) => ({ kind: "path", lineId: line.id }));

  const segmentById = new Map(lines.map((line) => [line.id, line]));
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const resolve = <K extends ActionDef["kind"]>(ids: string[] = [], kind: K) =>
    ids
      .map((id) => actionById.get(id))
      .filter(
        (action): action is Extract<ActionDef, { kind: K }> =>
          action?.kind === kind,
      );
  const command = (expression: string): SequenceStep => ({
    kind: "command",
    expression,
  });

  // One path call per run of segments with the same method (a group).
  type Run = { methodName: string; segments: AtomicPath[] };
  const runs: (Run | { wait: number })[] = [];
  items.forEach((item) => {
    if (item.kind === "wait") {
      runs.push({ wait: item.durationMs });
      return;
    }
    const methodName = methodNameByLineId.get(item.lineId);
    if (!methodName) return;
    const segment = segmentById.get(item.lineId);
    const last = runs[runs.length - 1];
    if (last && "methodName" in last && last.methodName === methodName) {
      if (segment) last.segments.push(segment);
      return;
    }
    runs.push({ methodName, segments: segment ? [segment] : [] });
  });

  const steps: SequenceStep[] = [];
  runs.forEach((run) => {
    if ("wait" in run) {
      steps.push({ kind: "wait", durationMs: run.wait });
      return;
    }
    const during = [
      ...new Set(
        run.segments.flatMap((segment) => segment.actionsDuring ?? []),
      ),
    ];
    const whileDriving = resolve(during, "during");
    const after = resolve(run.segments.at(-1)?.actionsAfter, "timed");
    whileDriving.forEach((action) =>
      steps.push(command(instantExpression(action.start, STEP_INDENT))),
    );
    steps.push({ kind: "path", methodName: run.methodName });
    whileDriving.forEach((action) =>
      steps.push(command(instantExpression(action.stop, STEP_INDENT))),
    );
    after.forEach((action) =>
      steps.push(command(timedExpression(action, STEP_INDENT))),
    );
  });

  if (steps.length === 0 && lines.length > 0) return allPaths();
  return steps;
}
