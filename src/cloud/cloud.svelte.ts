import { createClient, type Client } from "@liveblocks/client";
import { LiveblocksYjsProvider } from "@liveblocks/yjs";
import * as Y from "yjs";
import { showToast } from "../lib/toast";
import type { ProjectStore } from "../state/project.svelte";
import {
  joinedLibrary,
  readDoc,
  readTeam,
  ROOT,
  TEAM_ROOM,
  withLibrary,
  writeDoc,
  writeTeam,
} from "./binding";
import { displayName, refused, setUrl, teamPassword } from "./client";
import { bindProject } from "./session";

export type CloudStatus =
  "initial" | "connecting" | "connected" | "reconnecting" | "disconnected";

const SYNC_TIMEOUT_MS = 15000;

/** The cloud auto open in this tab, if any, and who else is in it. */
export class CloudAutos {
  current = $state<{ id: string; name: string } | null>(null);
  status = $state<CloudStatus>("initial");
  others = $state<string[]>([]);

  #project: ProjectStore;
  #client: Client | null = null;
  #leave: (() => void) | null = null;

  constructor(project: ProjectStore) {
    this.#project = project;
  }

  #liveblocks(): Client {
    this.#client ??= createClient({
      authEndpoint: async () => {
        const response = await fetch("/api/liveblocks-auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            password: await teamPassword(),
            name: await displayName(),
          }),
        });
        if (refused(response)) throw new Error("Wrong team password");
        return response.json();
      },
    });
    return this.#client;
  }

  /**
   * Join an auto's room and show its document. `opened` runs once the
   * document is in, before this tab's edits start flowing.
   */
  async open(id: string, name = "", opened: () => void = () => {}) {
    this.leave();
    await teamPassword();
    await displayName();
    const { room, leave } = this.#liveblocks().enterRoom(id, {
      initialPresence: {},
    });
    const ydoc = new Y.Doc();
    const provider = new LiveblocksYjsProvider(room, ydoc);
    // The team's robot actions and hardware, shared by every auto.
    const library = this.#liveblocks().enterRoom(TEAM_ROOM, {
      initialPresence: {},
    });
    const team = new Y.Doc();
    const teamProvider = new LiveblocksYjsProvider(library.room, team);
    const unsubscribe = [
      room.subscribe("status", (status) => (this.status = status)),
      room.subscribe("others", (others) => {
        this.others = others.map((other) =>
          String((other.info as { name?: string } | undefined)?.name ?? "?"),
        );
      }),
    ];
    const close = () => {
      unsubscribe.forEach((stop) => stop());
      provider.destroy();
      teamProvider.destroy();
      leave();
      library.leave();
      ydoc.destroy();
      team.destroy();
    };
    this.#leave = close;
    this.current = { id, name: name || "Cloud auto" };

    const whenSynced = (p: LiveblocksYjsProvider) =>
      new Promise<boolean>((resolve) => {
        if (p.synced) return resolve(true);
        const timer = setTimeout(() => resolve(false), SYNC_TIMEOUT_MS);
        p.on("sync", (done: boolean) => {
          if (!done) return;
          clearTimeout(timer);
          resolve(true);
        });
      });
    const synced = (
      await Promise.all([whenSynced(provider), whenSynced(teamProvider)])
    ).every(Boolean);
    if (this.#leave !== close) return; // another open or leave won the race
    if (!synced || ydoc.getMap(ROOT).size === 0) {
      this.leave();
      showToast(
        synced
          ? "That auto is empty or was deleted."
          : "Couldn't reach the cloud. Check the connection and the team password.",
        "error",
      );
      return;
    }

    // Join the library: nothing this auto had is lost, and from now on its
    // actions live only there. Not undoable: it is setup, not an edit.
    const own = readDoc(ydoc);
    const joined = joinedLibrary(readTeam(team), own);
    writeTeam(team, joined, "join");
    writeDoc(ydoc, { ...own, actions: undefined, hardware: undefined }, "join");
    this.#project.load(withLibrary(own, joined));
    const unbind = bindProject(this.#project, ydoc, team);
    this.#leave = () => {
      unbind();
      close();
    };
    setUrl(id);
    opened();
  }

  rename(name: string) {
    if (this.current) this.current = { ...this.current, name };
  }

  leave() {
    const leave = this.#leave;
    this.#leave = null;
    leave?.();
    if (this.current) setUrl(null);
    this.current = null;
    this.others = [];
    this.status = "initial";
  }
}
