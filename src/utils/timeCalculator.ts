import type {
  ActionDef,
  BasePoint,
  Path,
  Settings,
  StartPose,
  TimePrediction,
  TimelineEvent,
  SequenceItem,
} from "../types";
import { motionProfile } from "../sim/motionProfile";
import { getAngularDifference } from "./math";
import { segmentHeadingAt } from "./headingInterpolation";
import { atomicSegments, flattenToAtomicSegments } from "./pathTraversal";

export function calculatePathTime(
  startPoint: StartPose,
  lines: Path[],
  settings: Settings,
  sequence?: SequenceItem[],
): TimePrediction {
  const msToSeconds = (value?: number | string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return 0;
    return numeric / 1000;
  };

  const segmentLengths: number[] = [];
  const segmentTimes: number[] = [];
  const timeline: TimelineEvent[] = [];

  let currentTime = 0;
  let currentHeading = startPoint.headingDeg;

  // Create map by order of segments
  const pathSegments = flattenToAtomicSegments(startPoint, lines);
  const segmentById = new Map(
    pathSegments.map((segment) => [segment.line.id, segment]),
  );

  // The default sequence drives every leaf, not every top-level entry: a group
  // is not itself drivable.
  const seq: SequenceItem[] =
    sequence && sequence.length
      ? sequence
      : atomicSegments(lines).map((ln) => ({ kind: "path", lineId: ln.id }));

  // Where the robot actually sits, which does follow execution order.
  let robotPoint: BasePoint = startPoint;

  seq.forEach((item, idx) => {
    if (item.kind === "wait") {
      const waitSeconds = msToSeconds(item.durationMs);
      if (waitSeconds > 0) {
        timeline.push({
          type: "wait",
          name: item.name,
          action: item.action,
          duration: waitSeconds,
          startTime: currentTime,
          endTime: currentTime + waitSeconds,
          startHeading: currentHeading,
          targetHeading: currentHeading,
          atPoint: robotPoint,
        });
        currentTime += waitSeconds;
      }
      return;
    }

    const segment = segmentById.get(item.lineId);
    if (!segment) {
      // Skip missing or malformed lines in sequence
      return;
    }
    const line = segment.line;
    const prevPoint = segment.start;

    // --- ROTATION CHECK ---
    const requiredStartHeading = segmentHeadingAt(
      pathSegments,
      segment.index,
      0,
    );
    if (idx === 0) currentHeading = requiredStartHeading;
    const diff = Math.abs(
      getAngularDifference(currentHeading, requiredStartHeading),
    );
    if (diff > 0.1) {
      const diffRad = diff * (Math.PI / 180);
      const rotTime = diffRad / settings.aVelocity;
      timeline.push({
        type: "wait",
        duration: rotTime,
        startTime: currentTime,
        endTime: currentTime + rotTime,
        startHeading: currentHeading,
        targetHeading: requiredStartHeading,
        atPoint: prevPoint,
      });
      currentTime += rotTime;
      currentHeading = requiredStartHeading;
    }

    // --- TRAVEL ---
    const length = segment.curve.length;
    segmentLengths.push(length);
    const segmentTime = motionProfile(length, settings).duration;
    segmentTimes.push(segmentTime);
    timeline.push({
      type: "travel",
      duration: segmentTime,
      startTime: currentTime,
      endTime: currentTime + segmentTime,
      lineId: line.id,
    });
    currentTime += segmentTime;
    currentHeading = segmentHeadingAt(pathSegments, segment.index, 1);
    robotPoint = line.endPoint;
  });

  const totalTime = currentTime;
  const totalDistance = segmentLengths.reduce((sum, length) => sum + length, 0);

  return {
    totalTime,
    segmentTimes,
    totalDistance,
    timeline,
  };
}

/**
 * Calculate playback timing with path-level visualization pauses.
 * These waits are intentionally kept out of calculatePathTime so exports keep
 * using the trajectory's actual timing.
 */
export function calculateVisualizationPathTime(
  startPoint: StartPose,
  lines: Path[],
  settings: Settings,
  sequence?: SequenceItem[],
  actions: ActionDef[] = [],
): TimePrediction {
  const waitAfterMs = new Map(
    flattenToAtomicSegments(startPoint, lines).map(({ line }) => [
      line.id,
      Math.max(0, Number(line.waitAfterMs) || 0),
    ]),
  );
  // Timed actions run while the robot stands still after the whole top-level
  // path, as the export runs them after the group's single follow().
  const actionById = new Map(actions.map((action) => [action.id, action]));
  const timedAfter = new Map<string, Extract<ActionDef, { kind: "timed" }>[]>();
  lines.forEach((node) => {
    const segments = atomicSegments([node]);
    const last = segments.at(-1);
    if (!last) return;
    timedAfter.set(
      last.id,
      segments
        .flatMap((segment) => segment.actionsAfter ?? [])
        .map((id) => actionById.get(id))
        .filter((action) => action?.kind === "timed"),
    );
  });
  const baseSequence =
    sequence && sequence.length
      ? sequence
      : atomicSegments(lines).map((line) => ({
          kind: "path" as const,
          lineId: line.id,
        }));
  const visualizationSequence: SequenceItem[] = [];

  baseSequence.forEach((item) => {
    visualizationSequence.push(item);
    if (item.kind === "path") {
      const durationMs = waitAfterMs.get(item.lineId) ?? 0;
      if (durationMs > 0) {
        visualizationSequence.push({
          kind: "wait",
          id: `visualization-wait-${item.lineId}`,
          name: "Path visualization wait",
          durationMs,
        });
      }
      timedAfter.get(item.lineId)?.forEach((action, index) => {
        if (action.durationMs <= 0) return;
        visualizationSequence.push({
          kind: "wait",
          id: `action-wait-${item.lineId}-${index}`,
          name: action.name,
          durationMs: action.durationMs,
          action: action.name,
        });
      });
    }
  });

  return calculatePathTime(startPoint, lines, settings, visualizationSequence);
}

export function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0.0s";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}s`;
  }
  return `${seconds.toFixed(1)}s`;
}

export function getAnimationDuration(
  totalTime: number,
  speedFactor: number = 1.0,
): number {
  return (totalTime * 1000) / speedFactor;
}
