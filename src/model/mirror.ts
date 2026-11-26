import { FIELD_SIZE } from "../config/defaults";
import type { ProjectDoc } from "../io/project";
import type {
  BasePoint,
  Heading,
  Path,
  PiecewiseHeadingSegment,
} from "../types";

/**
 * Pedro's `PoseFactory.mirrorX(axis)` reflects across the vertical line
 * x = axis: x → 2·axis − x and heading → 180° − heading. Code export emits
 * that call, so mirroring a document here has to give the same poses.
 */
export const MIRROR_AXIS = FIELD_SIZE / 2;

/** Left ↔ right flips across the vertical center line, up ↔ down across the horizontal one. */
type Axis = "leftRight" | "upDown";
/** Both flips at once turn everything half a turn around the field's center. */
export type Flip = Axis | "both";

// Rounded so 13.22 flips to 128.28, not 128.27999999999997, and back exactly.
const across = (value: number) =>
  Math.round((2 * MIRROR_AXIS - value) * 1e6) / 1e6;

export function mirrorAngle(degrees: number, flip: Axis = "leftRight"): number {
  if (flip === "leftRight") return 180 - degrees;
  return degrees === 0 ? 0 : -degrees;
}

function mirrorPoint<T extends BasePoint>(point: T, flip: Axis): T {
  return flip === "leftRight"
    ? { ...point, x: across(point.x) }
    : { ...point, y: across(point.y) };
}

function mirrorPiecewiseSegment(
  segment: PiecewiseHeadingSegment,
  flip: Axis,
): PiecewiseHeadingSegment {
  const parameters = segment.parameters;
  if (!parameters) return segment;
  const mirrored = { ...parameters };
  if (mirrored.startDeg !== undefined) {
    mirrored.startDeg = mirrorAngle(mirrored.startDeg, flip);
  }
  if (mirrored.endDeg !== undefined) {
    mirrored.endDeg = mirrorAngle(mirrored.endDeg, flip);
  }
  if (mirrored.degrees !== undefined) {
    mirrored.degrees = mirrorAngle(mirrored.degrees, flip);
  }
  if (mirrored.point) mirrored.point = mirrorPoint(mirrored.point, flip);
  return { ...segment, parameters: mirrored };
}

export function mirrorHeading(
  heading: Heading,
  flip: Axis = "leftRight",
): Heading {
  switch (heading.type) {
    case "linear":
      return {
        ...heading,
        startDeg: mirrorAngle(heading.startDeg, flip),
        endDeg: mirrorAngle(heading.endDeg, flip),
      };
    case "constant":
      return { ...heading, degrees: mirrorAngle(heading.degrees, flip) };
    // The tangent is mirrored with the path, so facing along it still holds.
    case "tangential":
      return heading;
    case "piecewise":
      return {
        ...heading,
        piecewiseHeading: {
          ...heading.piecewiseHeading,
          segments: heading.piecewiseHeading.segments.map((segment) =>
            mirrorPiecewiseSegment(segment, flip),
          ),
        },
      };
  }
}

function mirrorPath(path: Path, flip: Axis): Path {
  const point = <T extends BasePoint>(p: T) => mirrorPoint(p, flip);
  if (path.kind === "compound") {
    return {
      ...path,
      ...(path.heading && { heading: mirrorHeading(path.heading, flip) }),
      segments: path.segments.map((segment) => mirrorPath(segment, flip)),
    };
  }
  return {
    ...path,
    heading: mirrorHeading(path.heading, flip),
    endPoint: point(path.endPoint),
    controlPoints: path.controlPoints.map(point),
    ...(path.throughPoints && {
      throughPoints: path.throughPoints.map(point),
    }),
  };
}

/** The document reflected across the field's vertical (or horizontal) center line. */
export function mirrorProject(
  doc: ProjectDoc,
  flip: Flip = "leftRight",
): ProjectDoc {
  if (flip === "both") {
    return mirrorProject(mirrorProject(doc, "leftRight"), "upDown");
  }
  const point = <T extends BasePoint>(p: T) => mirrorPoint(p, flip);
  return {
    ...doc,
    startPoint: {
      ...point(doc.startPoint),
      headingDeg: mirrorAngle(doc.startPoint.headingDeg, flip),
    },
    lines: doc.lines.map((line) => mirrorPath(line, flip)),
    shapes: doc.shapes.map((shape) => ({
      ...shape,
      vertices: shape.vertices.map(point),
    })),
    fieldPoints: doc.fieldPoints.map(point),
  };
}
