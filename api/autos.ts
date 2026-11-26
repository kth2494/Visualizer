import { randomUUID } from "node:crypto";
import { docUpdate } from "../src/cloud/binding.js";
import type { CloudAuto } from "../src/cloud/client";
import type { ProjectDoc } from "../src/io";
import {
  AUTO_PREFIX,
  cleanName,
  isAutoId,
  json,
  liveblocks,
  passwordOk,
  unauthorized,
} from "./_team.js";

const allowed = (request: Request) =>
  passwordOk(request.headers.get("x-team-password"));

const body = (request: Request) =>
  request.json().catch(() => ({})) as Promise<Record<string, unknown>>;

export async function GET(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  // ponytail: one page of 100 autos; page with nextCursor if the team ever has more.
  const rooms = await liveblocks().getRooms({
    limit: 100,
    query: { roomId: { startsWith: AUTO_PREFIX } },
  });
  return json(
    rooms.data.map((room): CloudAuto => ({
      id: room.id,
      name: String(room.metadata.name ?? room.id),
      updatedAt: new Date(
        room.lastConnectionAt ?? room.createdAt,
      ).toISOString(),
    })),
  );
}

/**
 * Make a room and put a project in it, so nobody opens it empty: the `doc`
 * sent, or a copy of the auto `copyOf`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { name, doc, copyOf } = await body(request);
  const clean = cleanName(name);
  const project = doc as ProjectDoc | undefined;
  const source = isAutoId(copyOf) ? copyOf : null;
  const valid =
    copyOf === undefined
      ? Boolean(project && Array.isArray(project.lines))
      : source !== null;
  if (!clean || !valid) {
    return json({ error: "A name and a project are required" }, 400);
  }
  const client = liveblocks();
  const content = source
    ? new Uint8Array(await client.getYjsDocumentAsBinaryUpdate(source))
    : docUpdate(project!);
  const id = `${AUTO_PREFIX}${randomUUID()}`;
  await client.createRoom(id, {
    defaultAccesses: [],
    metadata: { name: clean },
  });
  await client.sendYjsBinaryUpdate(id, content);
  return json({ id });
}

export async function PATCH(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { id, name } = await body(request);
  const clean = cleanName(name);
  if (!isAutoId(id) || !clean) return json({ error: "Bad request" }, 400);
  await liveblocks().updateRoom(id, { metadata: { name: clean } });
  return json({ id });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { id } = await body(request);
  if (!isAutoId(id)) return json({ error: "Bad request" }, 400);
  await liveblocks().deleteRoom(id);
  return json({ id });
}
