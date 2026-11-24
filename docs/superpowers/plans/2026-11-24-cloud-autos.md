# Cloud Autos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Team members co-edit autos in real time (Google Docs style) and pick them from a cloud list.

**Architecture:** A JSON↔Yjs binding diffs each new immutable `ProjectDoc` into a `Y.Doc` and rebuilds the `ProjectDoc` on remote updates. Liveblocks hosts one room per auto. Two Vercel functions do the work that needs secrets: one checks the team password and issues tokens, the other manages the room list.

**Tech Stack:** Svelte 5, yjs 13.6.33, @liveblocks/client, @liveblocks/yjs and @liveblocks/node 3.25.0, Vercel Functions (Web `Request`/`Response`).

**Spec:** `docs/superpowers/specs/2026-11-24-cloud-autos-design.md`

## Global Constraints

- **Room ids:** room ids are `auto:<random>`. Tokens allow only `auto:*`.
- **Server env vars:** `LIVEBLOCKS_SECRET_KEY` and `TEAM_PASSWORD`. Neither ever reaches the browser bundle.
- **Browser storage:** the browser keeps the password and display name in localStorage, under `pedro_team_password` and `pedro_cloud_name`.
- **Undo:** undo in a cloud auto reverts only local edits.
- **Unset keys:** `undefined` keys are absent in Y and in the rebuilt doc.

## Review Focus

- **Drag interrupted by a remote edit:** a remote edit arrives mid-drag, then Esc cancels the drag. The remote edit must survive. Test this in Task 2.
- **Reordering:** reordering paths must not duplicate or drop any. Test this in Task 1.
- **Control points:** adding or removing control points must merge by index. Test this in Task 1.
- **Wrong password:** a wrong password returns 401 and the browser asks again. Test this in Task 3.
- **Missing auto:** opening `?auto=` for a deleted room shows an error instead of a blank field. Handle this in Task 4.

---

### Task 1: JSON↔Yjs binding

**Files:**
- Create: `src/cloud/binding.ts`
- Test: `test/cloud-binding.test.ts`

**Produces:**
- `ROOT = "doc"`
- `writeDoc(ydoc: Y.Doc, prev: ProjectDoc | null, next: ProjectDoc, origin?: unknown): void`
  - Diffs into `ydoc.getMap(ROOT)` in one transaction.
- `readDoc(ydoc: Y.Doc): ProjectDoc`
- `docUpdate(doc: ProjectDoc): Uint8Array`
  - A fresh Y.Doc written from `doc`, encoded as an update.

**Mapping rules (spec):**
- Objects become `Y.Map`.
- Arrays become `Y.Array`.
  - Arrays whose items are all objects with a string `id` are diffed by id.
  - All other arrays are diffed by index.
- Primitives are stored as values.

**Tests:**
- Every fixture round-trips: `readDoc` after `writeDoc(null → doc)` equals `doc`.
- Two synced docs: an edit on A appears on B.
- Two synced docs: concurrent edits to different paths both survive.
- Two synced docs: concurrent edits to different fields of the same path both survive.
- Reordering, adding and deleting paths gives the same ids, in the same order, on both sides.
- Inserting and removing a control point.
- `actions: undefined` stays absent.

### Task 2: ProjectStore cloud mode + session

**Files:**
- Modify: `src/state/project.svelte.ts`
- Create: `src/cloud/session.ts`
- Test: `test/cloud-session.test.ts`

**Produces:**
- `ProjectStore.history: { undo(): void; redo(): void; canUndo(): boolean; canRedo(): boolean; stop(): void } | null`
  - When set, `undo`, `redo` and `canUndo`/`canRedo` delegate to it.
  - `commit` and `cancel` call `stop()`.
- `ProjectStore.replace(doc: ProjectDoc)`: sets `doc` without touching history or the saved state.
- `bindProject(project: ProjectStore, ydoc: Y.Doc): () => void`
  - Writes local doc changes with `LOCAL` origin. A `$effect.root` tracks `project.doc`.
  - Applies remote updates with `replace`.
  - Installs a `Y.UndoManager` (tracked origin `LOCAL`, `captureTimeout` 1000) as `project.history`.
- **Cancel in cloud mode:** undo the capture since the drag began, then `replace(readDoc)`.

**Tests:**
- Undo reverts only the local edit, with a remote edit in between.
- A remote edit mid-drag, then cancel: the remote edit survives.

### Task 3: Vercel functions

**Files:**
- Create: `api/_team.ts` (password check, Liveblocks client)
- Create: `api/liveblocks-auth.ts` (POST)
- Create: `api/autos.ts` (GET, POST, PATCH, DELETE)
- Test: `test/cloud-api.test.ts` (Liveblocks mocked with `vi.mock("@liveblocks/node")`)

**`liveblocks-auth`:**
- Takes `{password, name}`.
- Runs `prepareSession(randomId, {userInfo:{name}})` with `.allow("auto:*", FULL_ACCESS)`.
- Returns the token body. Returns 401 on a bad password.

**`autos`:**
- Checks the `x-team-password` header. Returns 401 on a bad password.
- **GET:** returns `[{id, name, lastConnectionAt}]`.
  - Lists rooms with the query `roomId^"auto:"`.
- **POST `{name, doc}`:**
  - `createRoom(id, {defaultAccesses: [], metadata:{name}})`
  - Then `sendYjsBinaryUpdate(id, docUpdate(doc))`.
  - Returns `{id}`.
- **PATCH `{id, name}`:** `updateRoom`.
- **DELETE `{id}`:** `deleteRoom`.
- Rejects any id that doesn't start with `auto:` with 400.

**Tests:**
- 401 without a password.
- POST seeds the room.
- DELETE refuses a non-auto id.

### Task 4: UI

**Files:**
- Create: `src/cloud/client.ts`
  - API calls and the password prompt.
  - `openCloudAuto(id)` returns `{ leave }` and status/others stores.
- Create: `src/lib/components/CloudAutosDialog.svelte`
- Modify:
  - `src/state/dialogs.svelte.ts`
  - `src/view/actions.ts` (`file.cloud`, "Cloud autos…")
  - `src/view/TopBar.svelte` (cloud badge: name · status · others)
  - `src/view/AppDialogs.svelte`
  - `src/state/files.svelte.ts` (leave the room on New/Open)
  - `src/App.svelte` (open `?auto=` on load)
- Test: `e2e/cloud.spec.ts` (`/api/autos` mocked: list shows names, delete asks first, Upload current posts the doc)

**Behavior:**
- **Password:** when no password is stored, ask for it with `promptDialog`. On a 401, clear it and ask again.
- **Name:** ask for a display name once.
- **Opening an auto:**
  - Wait for the provider to finish syncing, then `project.load(readDoc)`, then bind.
  - Set `?auto=<id>` with `history.replaceState`.
  - If the room is missing or empty after sync: show a toast and leave the room.

### Task 5: Ship

- **Checks:** `pnpm check`, `pnpm lint` and `prettier`, unit tests, e2e.
- **README:** add a section on the setup steps (Liveblocks key, Vercel env).
- **Git:** commit, then push to `fork` feature/actions and main.
