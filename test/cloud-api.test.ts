import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { docUpdate, readDoc } from "../src/cloud/binding";
import { createDefaultProject } from "../src/io";
import { DEFAULT_ROBOT } from "./support/fixtures";

const calls = vi.hoisted(() => ({
  createRoom: vi.fn(),
  sendYjsBinaryUpdate: vi.fn(),
  deleteRoom: vi.fn(),
  getYjsDocumentAsBinaryUpdate: vi.fn(
    async () => new Uint8Array([1, 2, 3]).buffer,
  ),
  getRooms: vi.fn(async () => ({
    nextCursor: null,
    data: [
      {
        id: "auto:1",
        metadata: { name: "오토1" },
        createdAt: new Date("2026-11-01T00:00:00Z"),
      },
    ],
  })),
  allow: vi.fn(),
}));

vi.mock("@liveblocks/node", () => ({
  Liveblocks: class {
    createRoom = calls.createRoom;
    sendYjsBinaryUpdate = calls.sendYjsBinaryUpdate;
    deleteRoom = calls.deleteRoom;
    getYjsDocumentAsBinaryUpdate = calls.getYjsDocumentAsBinaryUpdate;
    getRooms = calls.getRooms;
    prepareSession = () => ({
      FULL_ACCESS: ["*:write"],
      allow: calls.allow,
      authorize: async () => ({ status: 200, body: '{"token":"t"}' }),
    });
  },
}));

const autos = await import("../api/autos");
const auth = await import("../api/liveblocks-auth");

const request = (method: string, body?: unknown, password = "bees") =>
  new Request("https://x/api/autos", {
    method,
    headers: { "x-team-password": password },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("cloud api", () => {
  beforeEach(() => {
    vi.stubEnv("TEAM_PASSWORD", "bees");
    Object.values(calls).forEach((call) => call.mockClear());
  });

  it("refuses a wrong password", async () => {
    expect((await autos.GET(request("GET", undefined, "wasps"))).status).toBe(
      401,
    );
    const denied = await auth.POST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ password: "wasps" }),
      }),
    );
    expect(denied.status).toBe(401);
  });

  it("gives a token for every auto room", async () => {
    const response = await auth.POST(
      new Request("https://x", {
        method: "POST",
        body: JSON.stringify({ password: "bees", name: "민수" }),
      }),
    );
    expect(await response.json()).toEqual({ token: "t" });
    expect(calls.allow).toHaveBeenCalledWith("auto:*", ["*:write"]);
  });

  it("lists autos by name", async () => {
    const response = await autos.GET(request("GET"));
    expect(await response.json()).toEqual([
      { id: "auto:1", name: "오토1", updatedAt: "2026-11-01T00:00:00.000Z" },
    ]);
  });

  it("starts a new auto with the project in it", async () => {
    const doc = createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp");
    const response = await autos.POST(
      request("POST", { name: " 오토2 ", doc }),
    );
    const { id } = await response.json();
    expect(id).toMatch(/^auto:/);
    expect(calls.createRoom).toHaveBeenCalledWith(id, {
      defaultAccesses: [],
      metadata: { name: "오토2" },
    });
    const seeded = new Y.Doc();
    Y.applyUpdate(seeded, calls.sendYjsBinaryUpdate.mock.calls[0][1]);
    expect(readDoc(seeded)).toEqual(JSON.parse(JSON.stringify(doc)));
  });

  it("copies an auto into a new room", async () => {
    const response = await autos.POST(
      request("POST", { name: "오토1 copy", copyOf: "auto:1" }),
    );
    const { id } = await response.json();
    expect(id).not.toBe("auto:1");
    expect(calls.getYjsDocumentAsBinaryUpdate).toHaveBeenCalledWith("auto:1");
    expect(calls.sendYjsBinaryUpdate).toHaveBeenCalledWith(
      id,
      new Uint8Array([1, 2, 3]),
    );
    const refused = await autos.POST(
      request("POST", { name: "x", copyOf: "other" }),
    );
    expect(refused.status).toBe(400);
  });

  it("hands back one auto's project", async () => {
    const doc = createDefaultProject(DEFAULT_ROBOT, "biobuzz.webp");
    calls.getYjsDocumentAsBinaryUpdate.mockResolvedValueOnce(
      docUpdate(doc).slice().buffer,
    );
    const response = await autos.GET(
      new Request("https://x/api/autos?id=auto:1", {
        headers: { "x-team-password": "bees" },
      }),
    );
    expect((await response.json()).doc).toEqual(
      JSON.parse(JSON.stringify(doc)),
    );
  });

  it("deletes only auto rooms", async () => {
    expect(
      (await autos.DELETE(request("DELETE", { id: "other" }))).status,
    ).toBe(400);
    expect(calls.deleteRoom).not.toHaveBeenCalled();
    await autos.DELETE(request("DELETE", { id: "auto:1" }));
    expect(calls.deleteRoom).toHaveBeenCalledWith("auto:1");
  });
});
