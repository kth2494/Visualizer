import { randomUUID } from "node:crypto";
import * as Y from "yjs";
import {
  docUpdate,
  joinedLibrary,
  readDoc,
  readTeam,
  TEAM_ROOM,
  withLibrary,
} from "../src/cloud/binding.js";
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

/** The list of autos, or with `?id=` that one auto's project as it is now. */
export async function GET(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (id !== null) {
    if (!isAutoId(id)) return json({ error: "Bad request" }, 400);
    const client = liveblocks();
    const load = async (room: string) => {
      const ydoc = new Y.Doc();
      Y.applyUpdate(
        ydoc,
        new Uint8Array(await client.getYjsDocumentAsBinaryUpdate(room)),
      );
      return ydoc;
    };
    const doc = readDoc(await load(id));
    // No library yet (nobody has opened an auto since): the auto's own actions stand.
    const team = await load(TEAM_ROOM).catch(() => null);
    return json({
      doc: team ? withLibrary(doc, joinedLibrary(readTeam(team), doc)) : doc,
    });
  }
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
      createdAt: new Date(room.createdAt).toISOString(),
      ...(typeof room.metadata.folder === "string"
        ? { folder: room.metadata.folder }
        : {}),
    })),
  );
}

/**
 * Make a room and put a project in it, so nobody opens it empty: the `doc`
 * sent, or a copy of the auto `copyOf`.
 */
export async function POST(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { name, doc, copyOf, folder } = await body(request);
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
    metadata: {
      name: clean,
      ...(cleanName(folder) ? { folder: cleanName(folder)! } : {}),
    },
  });
  await client.sendYjsBinaryUpdate(id, content);
  return json({ id });
}

export async function PATCH(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { id, name, folder } = await body(request);
  const clean = cleanName(name);
  if (!isAutoId(id) || (name !== undefined && !clean)) {
    return json({ error: "Bad request" }, 400);
  }
  // An empty folder takes the auto out of its folder.
  const metadata: Record<string, string | null> = {};
  if (clean) metadata.name = clean;
  if (folder !== undefined) metadata.folder = cleanName(folder);
  if (!Object.keys(metadata).length) return json({ error: "Bad request" }, 400);
  await liveblocks().updateRoom(id, { metadata });
  return json({ id });
}

export async function DELETE(request: Request): Promise<Response> {
  if (!allowed(request)) return unauthorized();
  const { id } = await body(request);
  if (!isAutoId(id)) return json({ error: "Bad request" }, 400);
  await liveblocks().deleteRoom(id);
  return json({ id });
}
