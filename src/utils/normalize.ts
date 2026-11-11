import type {
  ActionDef,
  BasePoint,
  ControlPoint,
  FieldPoint,
  Heading,
  HeadingType,
  HardwareCode,
  AtomicPath,
  Path,
  WaitSegment,
  PiecewiseHeadingInterpolation,
  Point,
  SequenceItem,
  Shape,
  TimedStep,
  StartPose,
} from "../types";
import { getRandomColor } from "./color";
import { headingAngleAt } from "./headingInterpolation";
import { atomicSegments } from "./pathTraversal";

import { makePathId, makeShapeId } from "./ids";

export { makePathId };

/** The heading a segment gets when none is recorded. */
export const DEFAULT_HEADING: Heading = { type: "tangential", reverse: false };

/**
 * Legacy heading fields that used to live on a point.
 */
interface LegacyHeadingFields {
  heading?: HeadingType;
  startDeg?: number;
  endDeg?: number;
  degrees?: number;
  reverse?: boolean;
  piecewiseHeading?: PiecewiseHeadingInterpolation;
}

type LegacyPoint = Point & LegacyHeadingFields;

/** Fields every stored path carries, whatever its kind. */
type StoredCommon = {
  /** Absent in files written before segments carried ids. */
  id?: string;
  color?: string;
  name?: string;
  locked?: boolean;
  waitBefore?: WaitSegment;
  waitAfter?: WaitSegment;
  waitBeforeMs?: number;
  waitAfterMs?: number;
  waitBeforeName?: string;
  waitAfterName?: string;
  actionsDuring?: unknown;
  actionsAfter?: unknown;
  /** Either the current object form or the pre-migration string. */
  heading?: Heading | HeadingType;
};

/**
 * A path as it may appear in a file.
 */
export type StoredPath = StoredCommon & {
  kind?: "atomic" | "compound";
  endPoint?: LegacyPoint;
  controlPoints?: ControlPoint[];
  throughPoints?: BasePoint[];
  segments?: StoredPath[];
};

/** A start point as it may appear in a file: `headingDeg`, or legacy fields. */
export type StoredStartPose = Point &
  LegacyHeadingFields & { headingDeg?: number };

function isHeading(value: unknown): value is Heading {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Heading).type === "string"
  );
}

/** Build a `Heading` from the legacy fields that used to live on a point. */
function headingFromLegacy(source: LegacyHeadingFields): Heading {
  switch (source.heading) {
    case "linear":
      return {
        type: "linear",
        startDeg: source.startDeg ?? 0,
        endDeg: source.endDeg ?? 0,
      };
    case "constant":
      return { type: "constant", degrees: source.degrees ?? 0 };
    case "tangential":
      return { type: "tangential", reverse: source.reverse ?? false };
    case "piecewise":
      return source.piecewiseHeading
        ? { type: "piecewise", piecewiseHeading: source.piecewiseHeading }
        : DEFAULT_HEADING;
    default:
      return DEFAULT_HEADING;
  }
}

/**
 * Resolve a line's heading, preferring the current path-level field and
 * falling back to the pre-migration copy stored on its endpoint.
 */
export function normalizeHeading(line: StoredPath): Heading {
  if (isHeading(line.heading)) return line.heading;
  if (typeof line.heading === "string") {
    return headingFromLegacy({ ...line.endPoint, heading: line.heading });
  }
  return headingFromLegacy(line.endPoint ?? {});
}

/** A new drivable segment ending at (x, y), with defaults matching normalizePaths. */
export function createSegment(
  x: number,
  y: number,
  options: { reverse?: boolean } = {},
): AtomicPath {
  return {
    kind: "atomic",
    id: makePathId(),
    endPoint: { x, y },
    controlPoints: [],
    heading: { type: "tangential", reverse: options.reverse ?? false },
    color: getRandomColor(),
    locked: false,
    waitBeforeMs: 0,
    waitAfterMs: 0,
    waitBeforeName: "",
    waitAfterName: "",
  };
}

/**
 * Migrate a start pose from the legacy format to the new one.
 */
export function normalizeStartPose(input: StoredStartPose): StartPose {
  const headingDeg =
    typeof input?.headingDeg === "number"
      ? input.headingDeg
      : headingAngleAt(headingFromLegacy(input ?? {}), "start");

  return {
    x: input?.x ?? 0,
    y: input?.y ?? 0,
    name: input?.name,
    locked: input?.locked,
    headingDeg,
  };
}

function normalizeCommon(path: StoredPath) {
  return {
    id: path.id || makePathId(),
    color: path.color || getRandomColor(),
    name: path.name || "",
    locked: path.locked,
    waitBefore: path.waitBefore,
    waitAfter: path.waitAfter,
    waitBeforeMs: Math.max(
      0,
      Number(path.waitBeforeMs ?? path.waitBefore?.durationMs ?? 0),
    ),
    waitAfterMs: Math.max(
      0,
      Number(path.waitAfterMs ?? path.waitAfter?.durationMs ?? 0),
    ),
    waitBeforeName: path.waitBeforeName ?? path.waitBefore?.name ?? "",
    waitAfterName: path.waitAfterName ?? path.waitAfter?.name ?? "",
    ...idList("actionsDuring", path.actionsDuring),
    ...idList("actionsAfter", path.actionsAfter),
  };
}

/** `{ [key]: ids }` for a non-empty string list, otherwise nothing. */
function idList<K extends string>(key: K, value: unknown) {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === "string")
    : [];
  return ids.length ? ({ [key]: ids } as Record<K, string[]>) : {};
}

const isString = (value: unknown): value is string => typeof value === "string";

function toAction(value: unknown): ActionDef | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!isString(raw.id) || !isString(raw.name)) return null;
  if (raw.kind === "during" && isString(raw.start) && isString(raw.stop)) {
    return {
      id: raw.id,
      name: raw.name,
      kind: "during",
      start: raw.start,
      stop: raw.stop,
    };
  }
  if (
    raw.kind === "timed" &&
    typeof raw.durationMs === "number" &&
    Array.isArray(raw.steps)
  ) {
    const steps = raw.steps.filter(
      (step): step is TimedStep =>
        typeof step?.atMs === "number" && isString(step?.code),
    );
    return {
      id: raw.id,
      name: raw.name,
      kind: "timed",
      durationMs: raw.durationMs,
      steps,
    };
  }
  return null;
}

export function normalizeActions(input: unknown): ActionDef[] | undefined {
  if (!Array.isArray(input)) return undefined;
  const actions = input.map(toAction).filter((a): a is ActionDef => Boolean(a));
  return actions.length ? actions : undefined;
}

export function normalizeHardware(input: unknown): HardwareCode | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const text = (key: string) => (isString(raw[key]) ? raw[key] : "");
  const hardware = {
    imports: text("imports"),
    fields: text("fields"),
    init: text("init"),
  };
  return hardware.imports || hardware.fields || hardware.init
    ? hardware
    : undefined;
}

export function normalizePaths(input: StoredPath[] = []): Path[] {
  return (input || []).map((path): Path => {
    const common = normalizeCommon(path);

    if (Array.isArray(path.segments)) {
      return {
        ...common,
        kind: "compound",
        segments: normalizePaths(path.segments),
        // A group's heading is optional: without one, each child keeps its own.
        heading: isHeading(path.heading) ? path.heading : undefined,
      };
    }

    return {
      ...common,
      kind: "atomic",
      endPoint: {
        x: path.endPoint?.x ?? 0,
        y: path.endPoint?.y ?? 0,
        name: path.endPoint?.name,
        locked: path.endPoint?.locked,
      },
      controlPoints: path.controlPoints || [],
      throughPoints: path.throughPoints?.map((point) => ({
        x: Number(point.x) || 0,
        y: Number(point.y) || 0,
        locked: point.locked,
      })),
      heading: normalizeHeading(path),
    };
  });
}

/** Obstacles with a vertex list, each with an id no other obstacle shares. */
export function normalizeShapes(input: unknown): Shape[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  return input
    .filter((shape): shape is Shape => Array.isArray(shape?.vertices))
    .map((shape) => {
      const id =
        typeof shape.id === "string" && !seen.has(shape.id)
          ? shape.id
          : makeShapeId();
      seen.add(id);
      return id === shape.id ? shape : { ...shape, id };
    });
}

function toFieldPoint(value: unknown): FieldPoint | null {
  if (!value) return null;

  if (Array.isArray(value)) {
    const [x, y, color, radius, opacity] = value;
    if (typeof x !== "number" || typeof y !== "number") return null;
    const point: FieldPoint = { x, y };
    if (typeof color === "string") point.color = color;
    if (typeof radius === "number") point.radius = radius;
    if (typeof opacity === "number") point.opacity = opacity;
    return point;
  }

  if (typeof value === "object") {
    const candidate = value as Partial<FieldPoint> & {
      x?: unknown;
      y?: unknown;
      color?: unknown;
      radius?: unknown;
      opacity?: unknown;
    };

    if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
      return null;
    }

    const point: FieldPoint = { x: candidate.x, y: candidate.y };
    if (typeof candidate.color === "string") point.color = candidate.color;
    if (typeof candidate.radius === "number") point.radius = candidate.radius;
    if (typeof candidate.opacity === "number")
      point.opacity = candidate.opacity;
    return point;
  }

  return null;
}

export function normalizeFieldPoints(input: unknown): FieldPoint[] {
  const container = input as {
    fieldPoints?: unknown;
    points?: unknown;
    dots?: unknown;
  } | null;
  const rawPoints = Array.isArray(input)
    ? input
    : input && typeof input === "object"
      ? (container?.fieldPoints ?? container?.points ?? container?.dots ?? [])
      : [];

  if (!Array.isArray(rawPoints)) return [];
  return rawPoints
    .map(toFieldPoint)
    .filter((point): point is FieldPoint => Boolean(point));
}

export function deriveSequence(
  data: { sequence?: unknown },
  normalizedLines: Path[],
): SequenceItem[] {
  if (Array.isArray(data.sequence) && data.sequence.length) {
    return data.sequence as SequenceItem[];
  }

  return atomicSegments(normalizedLines).map((ln) => ({
    kind: "path",
    lineId: ln.id,
  }));
}
