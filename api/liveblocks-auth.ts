import { randomUUID } from "node:crypto";
import { TEAM_ROOM } from "../src/cloud/binding.js";
import { AUTO_PREFIX, liveblocks, passwordOk, unauthorized } from "./_team.js";

/** Trade the team password for a token to every cloud auto's room. */
export async function POST(request: Request): Promise<Response> {
  const { password, name } = await request.json().catch(() => ({}));
  if (!passwordOk(password)) return unauthorized();
  const session = liveblocks().prepareSession(randomUUID(), {
    userInfo: { name: typeof name === "string" ? name.slice(0, 40) : "" },
  });
  session.allow(`${AUTO_PREFIX}*`, session.FULL_ACCESS);
  session.allow(TEAM_ROOM, session.FULL_ACCESS);
  const { status, body } = await session.authorize();
  return new Response(body, {
    status,
    headers: { "content-type": "application/json" },
  });
}
