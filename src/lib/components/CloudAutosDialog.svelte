<script lang="ts">
  import { X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import type { CloudAutos } from "../../cloud/cloud.svelte";
  import {
    CloudCancelled,
    copyAuto,
    createAuto,
    fetchAuto,
    moveAuto,
    deleteAuto,
    listAutos,
    renameAuto,
    type CloudAuto,
  } from "../../cloud/client";
  import { createDefaultProject, type ProjectDoc } from "../../io";
  import { useProject } from "../../state/project.svelte";
  import type { ProjectFiles } from "../../state/files.svelte";
  import { currentFilePath } from "../../stores";
  import { pathStem } from "../../utils/filename";
  import { chooseDialog, confirmDialog, promptDialog } from "../dialog";
  import { mirrorProject } from "../../model/mirror";
  import { javaFilesFor } from "../../cloud/exportJava";
  import { zipFiles } from "../../utils/zip";
  import { downloadBlob } from "../../utils/download";
  import { withActionDefaults } from "../session/actionDefaults";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import { fieldClass, labelClass } from "./ui/styles";

  interface Props {
    isOpen?: boolean;
    cloud: CloudAutos;
    files: ProjectFiles;
    fieldMap: string;
  }

  let { isOpen = $bindable(false), cloud, files, fieldMap }: Props = $props();

  const project = useProject();
  let autos = $state<CloudAuto[] | null>(null);

  const SORT_KEY = "pedro_cloud_sort";
  type Compare = (a: CloudAuto, b: CloudAuto) => number;
  const byName: Compare = (a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true });
  const byCreated: Compare = (a, b) =>
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  const SORTS = {
    recent: {
      label: "Recently opened",
      compare: ((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as Compare,
    },
    name: { label: "Name (A → Z)", compare: byName },
    nameDesc: {
      label: "Name (Z → A)",
      compare: ((a, b) => byName(b, a)) as Compare,
    },
    newest: {
      label: "Newest first",
      compare: ((a, b) => byCreated(b, a)) as Compare,
    },
    oldest: { label: "Oldest first", compare: byCreated },
  };
  type Sort = keyof typeof SORTS;
  let sort = $state<Sort>(
    (() => {
      try {
        const saved = localStorage.getItem(SORT_KEY);
        return saved && saved in SORTS ? (saved as Sort) : "recent";
      } catch {
        return "recent";
      }
    })(),
  );
  let sorted = $derived(autos ? [...autos].sort(SORTS[sort].compare) : null);
  const folderName = (auto: CloudAuto) => auto.folder ?? "";
  /** Folders A → Z, then the autos in no folder; each keeps the chosen sort. */
  let groups = $derived.by(() => {
    if (!sorted) return [];
    const folders = [...new Set(sorted.map(folderName))].sort((a, b) =>
      !a ? 1 : !b ? -1 : a.localeCompare(b, undefined, { numeric: true }),
    );
    return folders.map((folder) => ({
      folder,
      autos: sorted!.filter((auto) => folderName(auto) === folder),
    }));
  });
  let hasFolders = $derived(groups.some((group) => group.folder));

  function chooseSort(next: Sort) {
    sort = next;
    try {
      localStorage.setItem(SORT_KEY, next);
    } catch {
      // Private windows: back to the default next time.
    }
  }
  let error = $state("");
  let busy = $state(false);

  /** Run a cloud call, showing its failure here; a dismissed prompt is not one. */
  async function attempt(work: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await work();
    } catch (failure) {
      if (!(failure instanceof CloudCancelled)) {
        error = failure instanceof Error ? failure.message : String(failure);
      }
    } finally {
      busy = false;
    }
  }

  const refresh = () =>
    attempt(async () => {
      autos = await listAutos();
    });

  onMount(() => void refresh());

  async function leaveUnsavedWork() {
    return (
      cloud.current ||
      !project.dirty ||
      (await confirmDialog({
        title: "Open a cloud auto?",
        message: "Your unsaved changes here will be lost.",
        confirmLabel: "Discard changes",
        danger: true,
      }))
    );
  }

  const open = (auto: { id: string; name: string }) =>
    attempt(async () => {
      if (!(await leaveUnsavedWork())) return;
      await cloud.open(auto.id, auto.name, () => {
        currentFilePath.set(null);
        isOpen = false;
      });
    });

  const create = (doc: () => ProjectDoc, suggested: string) =>
    attempt(async () => {
      const name = await promptDialog({
        title: "New cloud auto",
        value: suggested,
        confirmLabel: "Create",
      });
      if (!name) return;
      const content = doc();
      const { id } = await createAuto(name, content);
      // The new room already holds this project, so nothing is lost by leaving it.
      project.markSaved();
      await cloud.open(id, name, () => {
        currentFilePath.set(null);
        isOpen = false;
      });
    });

  const duplicate = (auto: CloudAuto) =>
    attempt(async () => {
      const how = await chooseDialog({
        title: `Duplicate "${auto.name}"`,
        message: "Copy it as it is, or flipped?",
        choices: [
          { value: "copy", label: "As is" },
          { value: "leftRight", label: "Left ↔ right" },
          { value: "upDown", label: "Up ↕ down" },
          { value: "both", label: "Both" },
        ],
      });
      if (!how) return;
      const suffix = {
        copy: "copy",
        leftRight: "mirrored",
        upDown: "flipped",
        both: "rotated",
      };
      const name = await promptDialog({
        title: "Duplicate cloud auto",
        value: `${auto.name} ${suffix[how]}`,
        confirmLabel: "Duplicate",
      });
      if (!name) return;
      // The copy stays in the same folder.
      if (how === "copy") await copyAuto(auto.id, name, auto.folder);
      else
        await createAuto(
          name,
          mirrorProject(await fetchAuto(auto.id), how),
          auto.folder,
        );
      await refresh();
    });

  /** Every auto as its sequential command OpMode, in one zip for TeamCode/auto. */
  const exportAll = () =>
    attempt(async () => {
      if (!autos?.length) return;
      const list = autos;
      const docs = await Promise.all(list.map((auto) => fetchAuto(auto.id)));
      const files = javaFilesFor(
        list.map((auto, i) => ({ name: auto.name, doc: docs[i] })),
      );
      downloadBlob(zipFiles(files), "cloud-autos-java.zip");
    });

  const move = (auto: CloudAuto) =>
    attempt(async () => {
      const existing = groups.map((g) => g.folder).filter(Boolean);
      const folder = await promptDialog({
        title: "Move to folder",
        value: auto.folder ?? "",
        hint: existing.length
          ? `Folders: ${existing.join(", ")}. A new name makes a new folder; empty takes it out.`
          : "A new name makes a new folder; empty takes it out.",
        confirmLabel: "Move",
        allowEmpty: true,
      });
      if (folder === null || folder === (auto.folder ?? "")) return;
      await moveAuto(auto.id, folder);
      await refresh();
    });

  const rename = (auto: CloudAuto) =>
    attempt(async () => {
      const name = await promptDialog({
        title: "Rename cloud auto",
        value: auto.name,
        confirmLabel: "Rename",
      });
      if (!name || name === auto.name) return;
      await renameAuto(auto.id, name);
      if (cloud.current?.id === auto.id) cloud.rename(name);
      await refresh();
    });

  const remove = (auto: CloudAuto) =>
    attempt(async () => {
      const confirmed = await confirmDialog({
        title: `Delete "${auto.name}"?`,
        message:
          "It is deleted for the whole team and can't be brought back. Download it first if you might need it.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!confirmed) return;
      await deleteAuto(auto.id);
      if (cloud.current?.id === auto.id) cloud.leave();
      await refresh();
    });
</script>

<Modal
  {isOpen}
  titleId="cloud-autos-title"
  onClose={() => (isOpen = false)}
  panelClass="flex max-h-[90vh] w-full max-w-3xl flex-col mx-4"
>
  <div class="flex items-center gap-3 border-b border-border px-5 py-3">
    <h2
      id="cloud-autos-title"
      class="mr-auto text-base font-semibold text-heading"
    >
      Cloud autos
    </h2>
    <IconButton label="Close" onclick={() => (isOpen = false)}><X /></IconButton
    >
  </div>

  <div class="flex flex-col gap-3 overflow-auto p-5">
    <p class="text-xs text-body">
      Everyone with the team password sees these. Changes show up for everyone
      in the same auto as they happen.
    </p>

    <div class="flex flex-wrap gap-2">
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onclick={() =>
          create(() => files.current(), pathStem($currentFilePath) || "auto")}
      >
        Upload current
      </Button>
      <Button
        size="sm"
        disabled={busy}
        onclick={() =>
          create(
            () =>
              withActionDefaults(
                createDefaultProject(project.doc.robot, fieldMap),
              ),
            "auto",
          )}
      >
        New empty
      </Button>
      <Button size="sm" disabled={busy || !autos?.length} onclick={exportAll}>
        Export all as Java (.zip)
      </Button>
    </div>

    {#if error}
      <p role="alert" class="text-xs text-red-500">{error}</p>
    {/if}

    {#if autos?.length}
      <label class="flex items-center gap-2 self-end">
        <span class={[labelClass, "whitespace-nowrap"]}>Sort by</span>
        <select
          class={[fieldClass, "w-auto"]}
          value={sort}
          onchange={(event) => chooseSort(event.currentTarget.value as Sort)}
        >
          {#each Object.entries(SORTS) as [value, option] (value)}
            <option {value}>{option.label}</option>
          {/each}
        </select>
      </label>
    {/if}

    {#if autos === null || sorted === null}
      <p class="text-sm text-body">{busy ? "Loading…" : ""}</p>
    {:else if autos.length === 0}
      <p class="text-sm text-body">No cloud autos yet.</p>
    {:else}
      <ul class="flex flex-col divide-y divide-border" aria-label="Cloud autos">
        {#each groups as group (group.folder)}
          {#if hasFolders}
            <li class="pt-3 pb-1">
              <h3 class="text-xs font-semibold text-heading">
                {group.folder ? `📁 ${group.folder}` : "No folder"}
                <span class="font-normal text-body">({group.autos.length})</span
                >
              </h3>
            </li>
          {/if}
          {#each group.autos as auto (auto.id)}
            <li class="flex items-center gap-2 py-2">
              <div class="mr-auto min-w-0">
                <p class="text-sm font-medium break-words text-heading">
                  {auto.name}
                  {#if cloud.current?.id === auto.id}
                    <span class="text-xs font-normal text-primary">(open)</span>
                  {/if}
                </p>
                <p class="text-xs text-body">
                  {new Date(auto.updatedAt).toLocaleString()}
                </p>
              </div>
              <Button size="sm" disabled={busy} onclick={() => open(auto)}>
                Open
              </Button>
              <Button size="sm" disabled={busy} onclick={() => duplicate(auto)}>
                Duplicate
              </Button>
              <Button size="sm" disabled={busy} onclick={() => move(auto)}>
                Folder
              </Button>
              <Button size="sm" disabled={busy} onclick={() => rename(auto)}>
                Rename
              </Button>
              <Button size="sm" disabled={busy} onclick={() => remove(auto)}>
                Delete
              </Button>
            </li>
          {/each}
        {/each}
      </ul>
    {/if}
  </div>
</Modal>
