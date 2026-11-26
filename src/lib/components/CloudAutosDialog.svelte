<script lang="ts">
  import { X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import type { CloudAutos } from "../../cloud/cloud.svelte";
  import {
    CloudCancelled,
    copyAuto,
    createAuto,
    fetchAuto,
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
  import { withActionDefaults } from "../session/actionDefaults";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";

  interface Props {
    isOpen?: boolean;
    cloud: CloudAutos;
    files: ProjectFiles;
    fieldMap: string;
  }

  let { isOpen = $bindable(false), cloud, files, fieldMap }: Props = $props();

  const project = useProject();
  let autos = $state<CloudAuto[] | null>(null);
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
      autos = (await listAutos()).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      );
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
      if (how === "copy") await copyAuto(auto.id, name);
      else await createAuto(name, mirrorProject(await fetchAuto(auto.id), how));
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
  panelClass="flex max-h-[90vh] w-full max-w-lg flex-col mx-4"
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
    </div>

    {#if error}
      <p role="alert" class="text-xs text-red-500">{error}</p>
    {/if}

    {#if autos === null}
      <p class="text-sm text-body">{busy ? "Loading…" : ""}</p>
    {:else if autos.length === 0}
      <p class="text-sm text-body">No cloud autos yet.</p>
    {:else}
      <ul class="flex flex-col divide-y divide-border" aria-label="Cloud autos">
        {#each autos as auto (auto.id)}
          <li class="flex items-center gap-2 py-2">
            <div class="mr-auto min-w-0">
              <p class="truncate text-sm font-medium text-heading">
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
            <Button size="sm" disabled={busy} onclick={() => rename(auto)}>
              Rename
            </Button>
            <Button size="sm" disabled={busy} onclick={() => remove(auto)}>
              Delete
            </Button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</Modal>
