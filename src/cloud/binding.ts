import * as Y from "yjs";
import type { ProjectDoc } from "../io";

/**
 * A project as a Yjs document, so people editing it at once merge field by
 * field. Objects are Y.Maps and arrays Y.Arrays; writing diffs the new plain
 * document into the Y one, touching only what changed.
 */
export const ROOT = "doc";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Plain = Record<string, unknown>;

const isObject = (value: unknown): value is Plain =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toY(value: unknown): unknown {
  if (Array.isArray(value)) {
    const array = new Y.Array();
    array.push(value.map(toY));
    return array;
  }
  if (isObject(value)) {
    const map = new Y.Map();
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) map.set(key, toY(item));
    }
    return map;
  }
  return value;
}

/** Whether `current` can be updated in place to hold `value`. */
function sameKind(current: unknown, value: unknown): boolean {
  if (Array.isArray(value)) return current instanceof Y.Array;
  if (isObject(value)) return current instanceof Y.Map;
  return !(current instanceof Y.AbstractType);
}

function syncMap(map: Y.Map<unknown>, value: Plain) {
  for (const key of [...map.keys()]) {
    if (value[key] === undefined) map.delete(key);
  }
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) continue;
    const current = map.get(key);
    if (!map.has(key) || !sameKind(current, item)) map.set(key, toY(item));
    else if (current instanceof Y.Map) syncMap(current, item as Plain);
    else if (current instanceof Y.Array) syncArray(current, item as unknown[]);
    else if (current !== item) map.set(key, item);
  }
}

const idOf = (item: unknown): string | undefined =>
  item instanceof Y.Map
    ? (item.get("id") as string | undefined)
    : isObject(item) && typeof item.id === "string"
      ? item.id
      : undefined;

function syncArray(array: Y.Array<unknown>, value: unknown[]) {
  const keyed =
    value.length > 0 && value.every((item) => idOf(item) !== undefined);
  if (keyed) syncById(array, value as Plain[]);
  else syncByIndex(array, value);
}

/** Paths, obstacles, actions: matched by id, so concurrent edits land on the right item. */
function syncById(array: Y.Array<unknown>, value: Plain[]) {
  const wanted = new Set(value.map(idOf));
  for (let i = array.length - 1; i >= 0; i--) {
    if (!wanted.has(idOf(array.get(i)))) array.delete(i, 1);
  }
  value.forEach((item, i) => {
    const current = i < array.length ? array.get(i) : undefined;
    if (current instanceof Y.Map && idOf(current) === item.id) {
      syncMap(current, item);
      return;
    }
    // Moved or new: drop any later copy, then put it here.
    for (let j = array.length - 1; j > i; j--) {
      if (idOf(array.get(j)) === item.id) array.delete(j, 1);
    }
    array.insert(i, [toY(item)]);
  });
  if (array.length > value.length) {
    array.delete(value.length, array.length - value.length);
  }
}

/** Control points and other id-less lists: matched by position. */
function syncByIndex(array: Y.Array<unknown>, value: unknown[]) {
  if (array.length > value.length) {
    array.delete(value.length, array.length - value.length);
  }
  value.forEach((item, i) => {
    if (i >= array.length) {
      array.push([toY(item)]);
      return;
    }
    const current = array.get(i);
    if (!sameKind(current, item)) {
      array.delete(i, 1);
      array.insert(i, [toY(item)]);
    } else if (current instanceof Y.Map) syncMap(current, item as Plain);
    else if (current instanceof Y.Array) syncArray(current, item as unknown[]);
    else if (current !== item) {
      array.delete(i, 1);
      array.insert(i, [item]);
    }
  });
}

/** Make the Y document hold `doc`, changing only what differs. */
export function writeDoc(ydoc: Y.Doc, doc: ProjectDoc, origin?: unknown) {
  ydoc.transact(() => {
    syncMap(ydoc.getMap(ROOT), doc as unknown as Plain);
  }, origin);
}

export function readDoc(ydoc: Y.Doc): ProjectDoc {
  return ydoc.getMap(ROOT).toJSON() as Json as unknown as ProjectDoc;
}

/** A whole project as one Yjs update, to start a new room with. */
export function docUpdate(doc: ProjectDoc): Uint8Array {
  const ydoc = new Y.Doc();
  writeDoc(ydoc, doc);
  return Y.encodeStateAsUpdate(ydoc);
}
