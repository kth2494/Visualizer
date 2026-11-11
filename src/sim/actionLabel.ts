import type { ActionDef, Path, TimelineEvent } from "../types";
import { atomicSegments } from "../utils/pathTraversal";

/** What the robot is doing at `seconds`, for the label beside it; null when idle. */
export function actionLabelAt(
  timeline: TimelineEvent[],
  seconds: number,
  lines: Path[],
  actions: ActionDef[] | undefined,
): string | null {
  const event = timeline.find(
    (e) => seconds >= e.startTime && seconds < e.endTime,
  );
  if (!event) return null;
  if (event.type === "wait") {
    if (!event.action) return null;
    const elapsed = (seconds - event.startTime).toFixed(1);
    return `${event.action} ${elapsed} / ${event.duration.toFixed(1)}s`;
  }
  const segment = atomicSegments(lines).find(
    (line) => line.id === event.lineId,
  );
  const names = (segment?.actionsDuring ?? [])
    .map((id) => actions?.find((action) => action.id === id))
    .filter((action) => action?.kind === "during")
    .map((action) => action!.name || "(unnamed)");
  return names.length ? names.join(", ") : null;
}
