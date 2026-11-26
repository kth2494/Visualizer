import type { ActionDef, Path, TimelineEvent } from "../types";
import { atomicSegments } from "../utils/pathTraversal";

const CM_PER_INCH = 2.54;

/**
 * How far the arms stick out in front at `seconds`, in inches. Timed actions
 * run once a top-level path ends, so each one that sets a reach takes effect
 * as its path finishes. A while-driving action's reach takes effect as its
 * segment starts. Either way it stays until another action changes it.
 */
export function reachAt(
  seconds: number,
  timeline: TimelineEvent[],
  lines: Path[],
  actions: ActionDef[] = [],
): number {
  const byId = new Map(actions.map((action) => [action.id, action]));
  const reachAfter = new Map<string, number>();
  const reachDuring = new Map<string, number>();
  for (const segment of atomicSegments(lines)) {
    for (const id of segment.actionsDuring ?? []) {
      const action = byId.get(id);
      if (action?.kind === "during" && action.reachCm !== undefined) {
        reachDuring.set(segment.id, action.reachCm);
      }
    }
  }
  for (const node of lines) {
    const segments = atomicSegments([node]);
    const last = segments.at(-1);
    if (!last) continue;
    for (const id of segments.flatMap((s) => s.actionsAfter ?? [])) {
      const action = byId.get(id);
      if (action?.kind === "timed" && action.reachCm !== undefined) {
        reachAfter.set(last.id, action.reachCm);
      }
    }
  }

  let reachCm = 0;
  for (const event of timeline) {
    if (event.startTime > seconds) break;
    const lineId = event.type === "travel" ? event.lineId : undefined;
    const driving = lineId ? reachDuring.get(lineId) : undefined;
    if (driving !== undefined) reachCm = driving;
    if (event.endTime > seconds) break;
    const after = lineId ? reachAfter.get(lineId) : undefined;
    if (after !== undefined) reachCm = after;
  }
  return Math.max(0, reachCm) / CM_PER_INCH;
}
