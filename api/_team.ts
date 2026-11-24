import { createHash, timingSafeEqual } from "node:crypto";
import { Liveblocks } from "@liveblocks/node";

/** Every cloud auto's room id starts with this; tokens reach nothing else. */
export const AUTO_PREFIX = "auto:";

export const liveblocks = () =>
  new Liveblocks({ secret: process.env.LIVEBLOCKS_SECRET_KEY ?? "" });

const digest = (text: string) => createHash("sha256").update(text).digest();

export function passwordOk(given: unknown): boolean {
  const wanted = process.env.TEAM_PASSWORD;
  if (!wanted || typeof given !== "string") return false;
  return timingSafeEqual(digest(given), digest(wanted));
}

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status });

export const unauthorized = () => json({ error: "Wrong team password" }, 401);

export const isAutoId = (id: unknown): id is string =>
  typeof id === "string" && id.startsWith(AUTO_PREFIX) && id.length < 128;

/** A room name Liveblocks accepts as metadata (at most 256 characters). */
export const cleanName = (name: unknown): string | null =>
  typeof name === "string" && name.trim() ? name.trim().slice(0, 100) : null;
