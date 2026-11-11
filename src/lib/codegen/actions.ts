import type { ActionDef } from "../../types";

type TimedAction = Extract<ActionDef, { kind: "timed" }>;

/** `instant(() -> { code })`, with each code line one level deeper than `indent`. */
export function instantExpression(code: string, indent: string): string {
  const body = code
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");
  if (body.length === 0) return "instant(() -> {})";
  const inner = body.map((line) => `${indent}    ${line}`).join("\n");
  return `instant(() -> {\n${inner}\n${indent}})`;
}

/** Run each step at its time, then wait out the rest of the action. */
export function timedExpression(action: TimedAction, indent: string): string {
  const inner = `${indent}    `;
  const parts: string[] = [];
  let now = 0;
  const waitUntil = (ms: number) => {
    if (ms > now) parts.push(`waitMs(${ms - now})`);
    now = Math.max(now, ms);
  };
  [...action.steps]
    .sort((a, b) => a.atMs - b.atMs)
    .forEach((step) => {
      waitUntil(step.atMs);
      parts.push(instantExpression(step.code, inner));
    });
  waitUntil(action.durationMs);
  return `sequential(\n${parts.map((part) => `${inner}${part}`).join(",\n")}\n${indent})`;
}
