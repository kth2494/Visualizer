import type {
  ActionDef,
  AtomicPath,
  BasePoint,
  HardwareCode,
  Heading,
  Path,
  PiecewiseHeadingSegment,
  SequenceItem,
  StartPose,
} from "../types";
import { generateSequentialCommandCode } from "../lib/codegen";
import { timedExpression } from "../lib/codegen/actions";
import { round } from "../lib/codegen/numbers";
import { PATH_COLORS } from "../utils/color";
import { makePathId } from "../utils/ids";
import { atomicSegments } from "../utils/pathTraversal";
import type { ProjectDoc } from "./project";

/**
 * Reads a sequential command OpMode the Visualizer exported, including small
 * edits to its numbers, order and waits. Hand-written OpModes are out of scope.
 */
export type JavaImportResult =
  | { ok: true; doc: ProjectDoc; className: string; warnings: string[] }
  | { ok: false; error: string };

type Pose = { x: number; y: number; h: number };

class ImportError extends Error {}

/** The index just past the parenthesis that closes the one at `open`. */
function closingParen(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(" || text[i] === "{") depth++;
    else if (text[i] === ")" || text[i] === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  throw new ImportError("unbalanced parentheses");
}

/** Splits `a, f(b, c), d` at its top-level commas. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "{") depth++;
    else if (c === ")" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      args.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const last = text.slice(start).trim();
  if (last) args.push(last);
  return args;
}

/** `name(args)rest` -> the args text and what follows the call. */
function call(text: string, name: string): { args: string; rest: string } {
  if (!text.startsWith(`${name}(`)) {
    throw new ImportError(`expected ${name}(...) in ${text.slice(0, 60)}`);
  }
  const end = closingParen(text, name.length);
  return { args: text.slice(name.length + 1, end - 1), rest: text.slice(end) };
}

/** Plain arithmetic on numbers only: `56`, `-1.5`, `(56 + 2) * 0.5`. */
export function evaluateNumber(text: string): number {
  const tokens =
    text.match(/\d+\.?\d*(?:[eE][-+]?\d+)?|\.\d+|[-+*/()]|\S/g) ?? [];
  let i = 0;
  const fail = () => {
    throw new ImportError(`not a number: ${text}`);
  };
  const primary = (): number => {
    const t = tokens[i++];
    if (t === "-") return -primary();
    if (t === "+") return primary();
    if (t === "(") {
      const value = sum();
      if (tokens[i++] !== ")") fail();
      return value;
    }
    const value = Number(t);
    if (t === undefined || !Number.isFinite(value)) fail();
    return value;
  };
  const product = (): number => {
    let value = primary();
    while (tokens[i] === "*" || tokens[i] === "/") {
      value = tokens[i++] === "*" ? value * primary() : value / primary();
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (tokens[i] === "+" || tokens[i] === "-") {
      value = tokens[i++] === "+" ? value + product() : value - product();
    }
    return value;
  };
  const value = sum();
  if (i !== tokens.length) fail();
  return value;
}

/** Removes the indentation every line shares, keeping relative indents. */
function dedent(lines: string[]): string {
  const kept = lines.filter((line) => line.trim() !== "");
  const indent = Math.min(
    ...kept.map((line) => line.length - line.trimStart().length),
  );
  return kept.map((line) => line.slice(indent).trimEnd()).join("\n");
}

/** Code inside `instant(() -> { ... })`. */
function instantCode(expression: string): string {
  const { args } = call(expression, "instant");
  const open = args.indexOf("{");
  if (!args.trimStart().startsWith("()") || open < 0) {
    throw new ImportError("instant(...) without a code block");
  }
  const body = args.slice(open + 1, args.lastIndexOf("}"));
  return dedent(body.split("\n"));
}

const squash = (text: string) => text.replace(/\s+/g, "");

export function importSequentialJava(
  text: string,
  base: ProjectDoc,
): JavaImportResult {
  try {
    return parse(text.replace(/\r\n?/g, "\n"), base);
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof ImportError
          ? `This is not a Visualizer sequential export (${error.message}).`
          : String(error),
    };
  }
}

function parse(text: string, base: ProjectDoc): JavaImportResult {
  const warnings: string[] = [];
  const className = text.match(/public\s+class\s+(\w+)/)?.[1];
  if (!className || !text.includes("autoRoutine()")) {
    throw new ImportError("no autoRoutine() found");
  }

  const poses = new Map<string, Pose>();
  for (const m of text.matchAll(
    /Pose\s+(\w+)\s*=\s*poseFactory\.of\(([^;]*)\)\s*;/g,
  )) {
    const [x, y, h] = splitArgs(m[2]).map(evaluateNumber);
    poses.set(m[1], { x, y, h });
  }
  const pose = (name: string): Pose => {
    const found = poses.get(name.trim());
    if (!found) throw new ImportError(`unknown pose ${name}`);
    return found;
  };

  const startVar = text.match(/follower\.setPose\((\w+)\)/)?.[1] ?? "start";
  const start = pose(startVar);
  const startPoint: StartPose = {
    x: start.x,
    y: start.y,
    headingDeg: start.h,
    ...(startVar !== "start" ? { name: startVar } : {}),
  };

  let color = 0;
  const pathFields = () => ({
    id: makePathId(),
    color: PATH_COLORS[color++ % PATH_COLORS.length],
  });
  const point = (p: Pose): BasePoint => ({ x: p.x, y: p.y });
  // A default name ("point3", "path3") came from no name at all.
  const named = (name: string, fallback: RegExp) =>
    fallback.test(name) ? {} : { name };

  function interpolator(
    text: string,
    from: number,
    until: number,
  ): PiecewiseHeadingSegment {
    let expression = text.trim();
    const reversed = expression.endsWith(".reverse()");
    if (reversed) expression = expression.slice(0, -".reverse()".length);
    const segment = { startProgress: from, endProgress: until, reversed };
    if (expression === "Interpolator.tangent") {
      return { ...segment, interpolationType: "tangential" };
    }
    const kind = expression.match(/^Interpolator\.(\w+)/)?.[1] ?? "";
    const args = splitArgs(call(expression, `Interpolator.${kind}`).args);
    switch (kind) {
      case "constant":
        return {
          ...segment,
          reversed: false,
          interpolationType: "constant",
          parameters: { degrees: pose(args[0]).h },
        };
      case "linear":
        return {
          ...segment,
          interpolationType: "linear",
          parameters: { startDeg: pose(args[0]).h, endDeg: pose(args[1]).h },
        };
      case "facingPoint":
        return {
          ...segment,
          interpolationType: "facing-point",
          parameters: { point: point(pose(args[0])) },
        };
    }
    throw new ImportError(`unknown interpolator ${expression}`);
  }

  function heading(suffix: string): Heading | undefined {
    if (!suffix) return undefined;
    const kind = suffix.match(/^\.(\w+)\(/)?.[1] ?? "";
    const { args, rest } = call(suffix.slice(1), kind);
    if (rest.trim()) throw new ImportError(`unexpected ${rest.trim()}`);
    const list = splitArgs(args);
    switch (kind) {
      case "constant":
        return { type: "constant", degrees: pose(list[0]).h };
      case "linear":
        return {
          type: "linear",
          startDeg: pose(list[0]).h,
          endDeg: pose(list[1]).h,
        };
      case "tangent":
        return { type: "tangential", reverse: false };
      case "reverseTangent":
        return { type: "tangential", reverse: true };
      case "heading": {
        let chain = args.trim();
        const head = "Interpolator.piecewise()";
        if (!chain.startsWith(head)) throw new ImportError("unknown heading");
        chain = chain.slice(head.length);
        const segments: PiecewiseHeadingSegment[] = [];
        let from = 0;
        while (chain.trim()) {
          const node = call(chain.trim().slice(1), "until");
          const [t, expression] = splitArgs(node.args);
          const until = evaluateNumber(t);
          segments.push(interpolator(expression, from, until));
          from = until;
          chain = node.rest;
        }
        return { type: "piecewise", piecewiseHeading: { segments } };
      }
    }
    throw new ImportError(`unknown heading .${kind}(...)`);
  }

  /** Rebuilds a path method's expression (whitespace removed). */
  function path(expression: string): Path {
    const kind = expression.match(/^Paths\.(\w+)\(/)?.[1] ?? "";
    const { args, rest } = call(expression, `Paths.${kind}`);
    const list = splitArgs(args);
    const h = heading(rest.trim());
    if (kind === "path") {
      // The group's own heading poses are named after it: "<Group>Start".
      const groupName =
        rest.match(/\(\s*(\w+)Start\s*,/)?.[1] ??
        rest.match(/\(\s*(\w+)End\s*\)/)?.[1];
      return {
        ...pathFields(),
        kind: "compound",
        ...(groupName ? { name: groupName } : {}),
        segments: list.map(path),
        ...(h ? { heading: h } : {}),
      };
    }
    if (kind !== "line" && kind !== "curve" && kind !== "through") {
      throw new ImportError(`unknown path Paths.${kind}`);
    }
    const endVar = list[list.length - 1];
    const middle = list.slice(1, -1).map((v) => point(pose(v)));
    const end = pose(endVar);
    return {
      ...pathFields(),
      kind: "atomic",
      ...named(endVar, /^point\d+$/),
      endPoint: point(end),
      controlPoints: kind === "curve" ? middle : [],
      ...(kind === "through" ? { throughPoints: middle } : {}),
      // A grouped segment drives with the group's heading; the export still
      // writes its own end angle, which a constant heading reproduces.
      heading: h ?? { type: "constant", degrees: end.h },
    } as AtomicPath;
  }

  const lines: Path[] = [];
  const pathByMethod = new Map<string, Path>();
  for (const m of text.matchAll(
    /public\s+Path\s+(\w+)\s*\(\s*\)\s*\{\s*return\s+([\s\S]*?);\s*\}/g,
  )) {
    const [, method, expression] = m;
    const index = lines.length + 1;
    const built = path(squash(expression));
    // The method name is the path's name unless it is the default "pathN".
    if (!built.name && method !== `path${index}`) built.name = method;
    lines.push(built);
    pathByMethod.set(method, built);
  }
  if (lines.length === 0) throw new ImportError("no path methods found");

  // --- the routine: follows, waits and actions in order
  const routineAt = text.indexOf("autoRoutine()");
  const seqAt = text.indexOf("sequential(", routineAt);
  const items = splitArgs(call(text.slice(seqAt), "sequential").args).map(
    (item) => item.trim(),
  );

  const actions: ActionDef[] = [...(base.actions ?? [])];
  let imported = 0;
  const findOrAdd = (
    matches: (action: ActionDef) => boolean,
    make: () => ActionDef,
  ): ActionDef => {
    const found = actions.find(matches);
    if (found) return found;
    const action = make();
    actions.push(action);
    return action;
  };
  const newId = () =>
    `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}-${imported}`;

  const timedFrom = (expression: string): ActionDef => {
    const steps: { atMs: number; code: string }[] = [];
    let now = 0;
    for (const part of splitArgs(call(expression, "sequential").args)) {
      if (part.startsWith("waitMs("))
        now += evaluateNumber(call(part, "waitMs").args);
      else steps.push({ atMs: now, code: instantCode(part) });
    }
    imported++;
    return {
      id: newId(),
      name: `Imported ${imported}`,
      kind: "timed",
      steps,
      durationMs: now,
    };
  };

  const sequence: SequenceItem[] = [];
  let lastFollowed: Path | null = null;
  let pendingStarts: string[] = [];
  let waitNumber = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.startsWith("follow(")) {
      const method = splitArgs(call(item, "follow").args)[1]?.replace(
        /\(\s*\)$/,
        "",
      );
      const followed = method ? pathByMethod.get(method) : undefined;
      if (!followed) throw new ImportError(`follow of unknown path ${method}`);
      const segments = atomicSegments([followed]);
      segments.forEach((segment) =>
        sequence.push({ kind: "path", lineId: segment.id }),
      );
      // Instants right before a path started its while-driving actions, and
      // as many right after it stop them, in the same order.
      const starts = pendingStarts;
      pendingStarts = [];
      starts.forEach((start) => {
        const next = items[i + 1];
        if (!next?.startsWith("instant(")) {
          warnings.push(
            "An action before a path has no matching stop after it; it was left out.",
          );
          return;
        }
        i++;
        const stop = instantCode(next);
        const action = findOrAdd(
          (a) =>
            a.kind === "during" &&
            squash(a.start) === squash(start) &&
            squash(a.stop) === squash(stop),
          () => {
            imported++;
            return {
              id: newId(),
              name: `Imported ${imported}`,
              kind: "during",
              start,
              stop,
            };
          },
        );
        segments.forEach((segment) => {
          segment.actionsDuring = [...(segment.actionsDuring ?? []), action.id];
        });
      });
      lastFollowed = followed;
    } else if (item.startsWith("waitMs(")) {
      waitNumber++;
      sequence.push({
        kind: "wait",
        id: `wait-${waitNumber}`,
        name: `Wait ${waitNumber}`,
        durationMs: evaluateNumber(call(item, "waitMs").args),
      });
    } else if (item.startsWith("instant(")) {
      pendingStarts.push(instantCode(item));
    } else if (item.startsWith("sequential(")) {
      const last = lastFollowed && atomicSegments([lastFollowed]).at(-1);
      if (!last) {
        warnings.push("A timed action before the first path was left out.");
        continue;
      }
      const action = findOrAdd(
        (a) =>
          a.kind === "timed" && squash(timedExpression(a, "")) === squash(item),
        () => timedFrom(item),
      );
      last.actionsAfter = [...(last.actionsAfter ?? []), action.id];
    } else {
      warnings.push(
        `Skipped a routine step it cannot read: ${item.slice(0, 60)}`,
      );
    }
  }
  if (pendingStarts.length) {
    warnings.push("An action after the last path was left out.");
  }

  // --- hardware code pasted around the generated OpMode
  const linesOf = text.split("\n");
  const between = (from: RegExp, to: RegExp) => {
    const a = linesOf.findIndex((line) => from.test(line));
    const b = linesOf.findIndex((line, index) => index > a && to.test(line));
    return a < 0 || b < 0 ? [] : linesOf.slice(a + 1, b);
  };
  const doc: ProjectDoc = {
    ...base,
    startPoint,
    lines,
    sequence,
    ...(actions.length ? { actions } : {}),
  };
  delete doc.hardware;
  const standardImports = new Set(
    generateSequentialCommandCode(startPoint, lines, className, sequence, {
      actions,
    })
      .split("\n")
      .filter((line) => line.startsWith("import "))
      .map((line) => line.trim()),
  );
  const hardware: HardwareCode = {
    imports: linesOf
      .filter(
        (line) =>
          line.startsWith("import ") && !standardImports.has(line.trim()),
      )
      .join("\n"),
    fields: dedentOrEmpty(
      between(/private\s+Follower\s+follower;/, /PoseFactory\s+poseFactory/),
    ),
    init: dedentOrEmpty(
      between(/Constants\.create\(hardwareMap\)/, /follower\.setPose\(/),
    ),
  };
  if (hardware.imports || hardware.fields || hardware.init)
    doc.hardware = hardware;

  // Anything the rebuilt export lacks would be lost on the next export.
  const rebuilt = generateSequentialCommandCode(
    startPoint,
    lines,
    className,
    sequence,
    { actions: doc.actions, hardware: doc.hardware },
  );
  const lost = firstDifference(sameNumbers(text), rebuilt);
  if (lost !== null) {
    warnings.push(
      `Line ${lost} has code the Visualizer does not keep. Exporting again would drop it, so save under a new name.`,
    );
  }

  return { ok: true, doc, className, warnings };
}

/** `of(100 + 2, ...)` reads back as `of(102, ...)`; that is no loss. */
function sameNumbers(text: string): string {
  return text.replace(
    /(poseFactory\.of|waitMs)\(([^;\n]*?)\)(?=[;,\s)])/g,
    (whole, name: string, args: string) => {
      try {
        const values = splitArgs(args).map((a) => round(evaluateNumber(a)));
        return `${name}(${values.join(", ")})`;
      } catch {
        return whole;
      }
    },
  );
}

function dedentOrEmpty(lines: string[]): string {
  return lines.some((line) => line.trim()) ? dedent(lines) : "";
}

/**
 * The 1-based line in `original` where it first differs from `rebuilt`,
 * ignoring whitespace, package and imports (added ones are kept as hardware
 * imports, removed unused ones come back harmlessly); null when they match.
 */
function firstDifference(original: string, rebuilt: string): number | null {
  const chars: { c: string; line: number }[] = [];
  original.split("\n").forEach((line, index) => {
    if (/^\s*(package|import)\s/.test(line)) return;
    for (const c of line) if (!/\s/.test(c)) chars.push({ c, line: index + 1 });
  });
  const other = rebuilt
    .split("\n")
    .filter((line) => !/^\s*(package|import)\s/.test(line))
    .join("")
    .replace(/\s+/g, "");
  for (let i = 0; i < chars.length; i++) {
    if (chars[i].c !== other[i]) return chars[i].line;
  }
  return other.length > chars.length ? (chars.at(-1)?.line ?? 1) : null;
}
