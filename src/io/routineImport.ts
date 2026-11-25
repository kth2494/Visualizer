import type {
  ActionDef,
  AtomicPath,
  Heading,
  Path,
  PiecewiseHeadingSegment,
  SequenceItem,
} from "../types";
import {
  actionsHash,
  ROUTINE_FORMAT,
  type Routine,
  type RoutineHeading,
  type RoutineInterpolator,
  type RoutinePath,
  type RoutinePose,
} from "../lib/codegen/routine";
import { PATH_COLORS } from "../utils/color";
import { makePathId } from "../utils/ids";
import { atomicSegments } from "../utils/pathTraversal";
import { parseProject, type ProjectDoc } from "./project";

export type RoutineImportResult =
  | { ok: true; doc: ProjectDoc; name: string; warnings: string[] }
  | { ok: false; error: string };

/**
 * Open a routine sent to the robot. One that carries its project opens
 * exactly as it was; an older one is rebuilt from its paths and steps, with
 * default names and colors, and actions found by id among `base.actions`.
 */
export function importRoutine(
  text: string,
  base: ProjectDoc,
): RoutineImportResult {
  let routine: Routine;
  try {
    routine = JSON.parse(text);
  } catch {
    return { ok: false, error: "This file is not a routine (not JSON)." };
  }
  if (routine?.format !== ROUTINE_FORMAT || !routine.paths || !routine.steps) {
    return { ok: false, error: "This file is not a Pedro routine." };
  }
  const name = String(routine.name || "auto");

  if (routine.project) {
    const result = parseProject(JSON.stringify(routine.project), base.robot);
    return result.ok
      ? { ok: true, doc: result.doc, name, warnings: result.warnings }
      : result;
  }

  try {
    return { ok: true, name, ...rebuild(routine, base) };
  } catch (error) {
    return {
      ok: false,
      error: `This routine could not be read (${error instanceof Error ? error.message : error}).`,
    };
  }
}

const degreesOf = (pose: RoutinePose) => pose[2];
const pointOf = (pose: RoutinePose) => ({ x: pose[0], y: pose[1] });

function segmentOf(
  node: { until: number; reversed: boolean; interpolator: RoutineInterpolator },
  from: number,
): PiecewiseHeadingSegment {
  const segment = {
    startProgress: from,
    endProgress: node.until,
    reversed: node.reversed,
  };
  const i = node.interpolator;
  switch (i.type) {
    case "constant":
      return {
        ...segment,
        reversed: false,
        interpolationType: "constant",
        parameters: { degrees: degreesOf(i.pose) },
      };
    case "linear":
      return {
        ...segment,
        interpolationType: "linear",
        parameters: { startDeg: degreesOf(i.start), endDeg: degreesOf(i.end) },
      };
    case "tangent":
      return { ...segment, interpolationType: "tangential" };
    case "facingPoint":
      return {
        ...segment,
        interpolationType: "facing-point",
        parameters: { point: pointOf(i.pose) },
      };
  }
}

function headingOf(heading: RoutineHeading | undefined): Heading | undefined {
  if (!heading) return undefined;
  switch (heading.type) {
    case "constant":
      return { type: "constant", degrees: degreesOf(heading.pose) };
    case "linear":
      return {
        type: "linear",
        startDeg: degreesOf(heading.start),
        endDeg: degreesOf(heading.end),
      };
    case "tangent":
      return { type: "tangential", reverse: false };
    case "reverseTangent":
      return { type: "tangential", reverse: true };
    case "facingPoint":
      // Paths face a point only through a piecewise segment.
      return {
        type: "piecewise",
        piecewiseHeading: {
          segments: [
            segmentOf({ until: 1, reversed: false, interpolator: heading }, 0),
          ],
        },
      };
    case "piecewise": {
      let from = 0;
      const segments = heading.nodes.map((node) => {
        const segment = segmentOf(node, from);
        from = node.until;
        return segment;
      });
      return { type: "piecewise", piecewiseHeading: { segments } };
    }
  }
}

function rebuild(
  routine: Routine,
  base: ProjectDoc,
): { doc: ProjectDoc; warnings: string[] } {
  const warnings: string[] = [];
  let color = 0;
  const fields = () => ({
    id: makePathId(),
    color: PATH_COLORS[color++ % PATH_COLORS.length],
  });

  const pathOf = (node: RoutinePath): Path => {
    const heading = headingOf(node.heading);
    if (node.type === "group") {
      return {
        ...fields(),
        kind: "compound",
        segments: node.children.map(pathOf),
        ...(heading ? { heading } : {}),
      } as Path;
    }
    const end = node.poses[node.poses.length - 1];
    const middle = node.poses.slice(1, -1).map(pointOf);
    return {
      ...fields(),
      kind: "atomic",
      endPoint: pointOf(end),
      controlPoints: node.type === "curve" ? middle : [],
      ...(node.type === "through" ? { throughPoints: middle } : {}),
      // A grouped segment drives with the group's heading; its own end angle
      // still sets where the next one starts, which a constant reproduces.
      heading: heading ?? { type: "constant", degrees: degreesOf(end) },
    } as AtomicPath;
  };

  const lines: Path[] = [];
  const byMethod = new Map<string, Path>();
  for (const [method, node] of Object.entries(routine.paths)) {
    const path = pathOf(node);
    if (!/^path\d+$/.test(method)) path.name = method;
    lines.push(path);
    byMethod.set(method, path);
  }

  const known = new Map((base.actions ?? []).map((a) => [a.id, a]));
  const actions: ActionDef[] = [...(base.actions ?? [])];
  const missing = new Set<string>();
  const actionFor = (id: string) => {
    if (!known.has(id)) {
      // Kept under its id so the robot still refuses it until RobotActions matches.
      const stand: ActionDef = {
        id,
        name: `Unknown action ${missing.size + 1}`,
        kind: "timed",
        steps: [],
        durationMs: 0,
      };
      known.set(id, stand);
      actions.push(stand);
      missing.add(id);
    }
    return id;
  };

  const sequence: SequenceItem[] = [];
  let pendingDuring: string[] = [];
  let last: Path | null = null;
  let waits = 0;
  for (const step of routine.steps) {
    if ("path" in step) {
      const path = byMethod.get(step.path);
      if (!path) throw new Error(`unknown path ${step.path}`);
      const segments = atomicSegments([path]);
      segments.forEach((segment) => {
        sequence.push({ kind: "path", lineId: segment.id });
        if (pendingDuring.length) {
          segment.actionsDuring = [
            ...(segment.actionsDuring ?? []),
            ...pendingDuring,
          ];
        }
      });
      pendingDuring = [];
      last = path;
    } else if ("wait" in step) {
      waits++;
      sequence.push({
        kind: "wait",
        id: `wait-${waits}`,
        name: `Wait ${waits}`,
        durationMs: step.wait,
      });
    } else if (step.phase === "start") {
      pendingDuring.push(actionFor(step.action));
    } else if (step.phase === "after") {
      const segment = last && atomicSegments([last]).at(-1);
      if (!segment) {
        warnings.push("An action before the first path was left out.");
        continue;
      }
      segment.actionsAfter = [
        ...(segment.actionsAfter ?? []),
        actionFor(step.action),
      ];
    }
    // "stop" steps follow from the matching start.
  }

  if (missing.size) {
    warnings.push(
      `${missing.size} action(s) were made in another browser, so their code is not here. They show as "Unknown action". Open the original project or set them up again in Robot actions before sending.`,
    );
  } else if (routine.actionsHash !== actionsHash(actions, base.hardware)) {
    warnings.push(
      "Robot actions here differ from when this routine was sent. Check them before sending it again.",
    );
  }
  warnings.push(
    "This routine was sent before projects travelled with it, so path names, colors and obstacles are defaults.",
  );

  const [x, y, headingDeg] = routine.start;
  return {
    doc: {
      ...base,
      startPoint: { x, y, headingDeg },
      lines,
      sequence,
      ...(actions.length ? { actions } : {}),
    },
    warnings,
  };
}
