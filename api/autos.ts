import { randomUUID } from "node:crypto";
import { docUpdate } from "../src/cloud/binding";
import type { ProjectDoc } from "../src/io";
import {
  AUTO_PREFIX,
  cleanName,
  isAutoId,
  json,
  liveblocks,
  passwordOk,
  unauthorized,
} from "./_team";

export interface CloudAuto {
  id: string;
  name: string;
  /** ISO time of the last connection, or of creation. */
  updatedAt: string;
}

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

/** Make a room and put the project in it, so nobody opens it empty. */
export async function POST(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { name, doc } = await body(request);
  const clean = cleanName(name);
  const project = doc as ProjectDoc | undefined;
  if (!clean || !project || !Array.isArray(project.lines)) {
    return json({ error: "A name and a project are required" }, 400);
  }
  const id = `${AUTO_PREFIX}${randomUUID()}`;
  const client = liveblocks();
  await client.createRoom(id, {
    defaultAccesses: [],
    metadata: { name: clean },
  });
  await client.sendYjsBinaryUpdate(id, docUpdate(project));
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
