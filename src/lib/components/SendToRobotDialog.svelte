<script lang="ts">
  import { X } from "@lucide/svelte";
  import { useProject } from "../../state/project.svelte";
  import type { ProjectFiles } from "../../state/files.svelte";
  import { serializeProject } from "../../io";
  import { currentFilePath } from "../../stores";
  import { pathStem } from "../../utils/filename";
  import { downloadBlob } from "../../utils/download";
  import {
    buildRoutine,
    generateRobotActions,
    routineText,
  } from "../codegen/routine";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import { fieldClass, labelClass } from "./ui/styles";

  interface Props {
    isOpen?: boolean;
    files: ProjectFiles;
  }

  let { isOpen = $bindable(false), files }: Props = $props();

  const project = useProject();
  const ADDRESS_KEY = "pedro_robot_address";
  const DEFAULT_ADDRESS = "192.168.43.1:8080";

  let name = $state("");
  let address = $state(DEFAULT_ADDRESS);
  let status = $state<{ ok: boolean; text: string } | null>(null);
  let sending = $state(false);
  let onRobot = $state<
    { name: string; file?: string; savedAt: number }[] | null
  >(null);

  $effect(() => {
    if (!isOpen) return;
    name = pathStem($currentFilePath) || "auto";
    status = null;
    onRobot = null;
    try {
      address = localStorage.getItem(ADDRESS_KEY) || DEFAULT_ADDRESS;
    } catch {
      address = DEFAULT_ADDRESS;
    }
  });

  // The project rides along, so Load from robot opens it intact.
  const routine = () =>
    routineText({
      ...buildRoutine(project.doc, name.trim() || "auto"),
      project: JSON.parse(serializeProject(project.doc)),
    });

  function rememberAddress() {
    try {
      localStorage.setItem(ADDRESS_KEY, address.trim());
    } catch {
      // Private windows: the default address still works.
    }
  }

  const robotHost = () =>
    address
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/$/, "");

  /** A GET from the robot's own web server. */
  async function fromRobot(path: string) {
    const response = await fetch(`http://${robotHost()}${path}`, {
      signal: AbortSignal.timeout(5000),
      targetAddressSpace: "local",
    } as RequestInit);
    return response.text();
  }

  const unreachable = (error: unknown) =>
    `Could not reach the robot (${error instanceof Error ? error.message : error}). Join the robot Wi-Fi and check the address.`;

  async function listOnRobot() {
    rememberAddress();
    sending = true;
    status = null;
    try {
      onRobot = JSON.parse(await fromRobot("/pedro/routines"));
    } catch (error) {
      status = { ok: false, text: unreachable(error) };
    } finally {
      sending = false;
    }
  }

  async function openFromRobot(entry: { name: string; file?: string }) {
    if (!entry.file) {
      status = {
        ok: false,
        text: "The robot app is too old to send routines back. Copy the new PedroWeb.java into TeamCode and reinstall it once.",
      };
      return;
    }
    sending = true;
    status = null;
    try {
      const text = await fromRobot(
        `/pedro/routine?file=${encodeURIComponent(entry.file)}`,
      );
      const reply = JSON.parse(text);
      if (reply.ok === false) throw new Error(reply.error);
      isOpen = false;
      await files.openRoutine(text, entry.name);
    } catch (error) {
      status = { ok: false, text: unreachable(error) };
    } finally {
      sending = false;
    }
  }

  async function send() {
    rememberAddress();
    sending = true;
    status = null;
    const host = robotHost();
    try {
      const response = await fetch(`http://${host}/pedro/routine`, {
        method: "POST",
        // text/plain keeps this a simple request (no CORS preflight).
        headers: { "Content-Type": "text/plain" },
        body: routine(),
        signal: AbortSignal.timeout(5000),
        // Chrome's local network access: lets an https page reach the robot.
        targetAddressSpace: "local",
      } as RequestInit);
      const result = await response.json();
      if (!result.ok) throw new Error(result.error || "the robot refused it");
      status = {
        ok: true,
        text: `Sent "${result.name}". On the Driver Station run "Pedro Routine (sent)".`,
      };
    } catch (error) {
      status = {
        ok: false,
        text: `Could not reach the robot (${error instanceof Error ? error.message : error}). Join the robot Wi-Fi and check the address, or use Download routine and upload it at http://${host}/pedro.`,
      };
    } finally {
      sending = false;
    }
  }

  function download() {
    downloadBlob(
      new Blob([routine()], { type: "application/json" }),
      `${name.trim() || "auto"}.json`,
    );
  }

  function saveActions() {
    downloadBlob(
      new Blob([
        generateRobotActions(project.doc.actions, project.doc.hardware),
      ]),
      "RobotActions.java",
    );
  }
</script>

<Modal
  {isOpen}
  titleId="send-robot-title"
  onClose={() => (isOpen = false)}
  panelClass="flex max-h-[90vh] w-full max-w-lg flex-col mx-4"
>
  <div class="flex items-center gap-3 border-b border-border px-5 py-3">
    <h2
      id="send-robot-title"
      class="mr-auto text-base font-semibold text-heading"
    >
      Send to robot
    </h2>
    <IconButton label="Close" onclick={() => (isOpen = false)}><X /></IconButton
    >
  </div>

  <div class="flex flex-col gap-3 overflow-auto p-5">
    <p class="text-xs text-body">
      Puts this route on the robot without reinstalling the app. Paths, order,
      waits and which actions run where all go over Wi-Fi. Changing an action's
      code still needs <b>Save RobotActions.java</b> and a reinstall; the robot refuses
      to start until you do.
    </p>

    <label class="flex flex-col gap-1">
      <span class={labelClass}>Routine name</span>
      <input class={fieldClass} bind:value={name} />
    </label>
    <label class="flex flex-col gap-1">
      <span class={labelClass}>Robot address</span>
      <input
        class={fieldClass}
        bind:value={address}
        onchange={rememberAddress}
      />
    </label>

    {#if status}
      <p
        role="status"
        class={["text-xs", status.ok ? "text-heading" : "text-red-500"]}
      >
        {status.text}
      </p>
    {/if}

    <div class="flex flex-wrap gap-2">
      <Button variant="primary" size="sm" onclick={send} disabled={sending}>
        {sending ? "Sending…" : "Send"}
      </Button>
      <Button size="sm" onclick={download}>Download routine</Button>
      <Button size="sm" onclick={saveActions}>Save RobotActions.java</Button>
      <Button size="sm" onclick={listOnRobot} disabled={sending}>
        Load from robot
      </Button>
    </div>

    {#if onRobot}
      {#if onRobot.length === 0}
        <p class="text-xs text-body">No routines on the robot yet.</p>
      {:else}
        <ul
          class="flex flex-col divide-y divide-border"
          aria-label="Routines on the robot"
        >
          {#each onRobot as entry (entry.file ?? entry.name)}
            <li class="flex items-center gap-2 py-2">
              <div class="mr-auto min-w-0">
                <p class="truncate text-sm font-medium text-heading">
                  {entry.name}
                </p>
                <p class="text-xs text-body">
                  {new Date(entry.savedAt).toLocaleString()}
                </p>
              </div>
              <Button
                size="sm"
                disabled={sending}
                onclick={() => openFromRobot(entry)}
              >
                Open
              </Button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
</Modal>
