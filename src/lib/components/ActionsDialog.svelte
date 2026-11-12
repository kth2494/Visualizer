<script lang="ts">
  import { Plus, Trash2, X } from "@lucide/svelte";
  import type { ActionDef, HardwareCode } from "../../types";
  import { setActions, setHardware } from "../../model/commands";
  import { useProject } from "../../state/project.svelte";
  import { saveActionDefaults } from "../session/actionDefaults";
  import type { Command } from "../../model/commands";
  import Modal from "./ui/Modal.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import {
    fieldClass,
    labelClass,
    sectionClass,
    sectionTitleClass,
  } from "./ui/styles";

  interface Props {
    isOpen?: boolean;
  }

  let { isOpen = $bindable(false) }: Props = $props();

  const project = useProject();
  const EMPTY_HARDWARE: HardwareCode = { imports: "", fields: "", init: "" };

  let actions = $derived(project.doc.actions ?? []);
  let hardware = $derived(project.doc.hardware ?? EMPTY_HARDWARE);

  const codeClass = [fieldClass, "font-mono text-xs"];
  const newId = () =>
    `action-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /** Every edit here also becomes what new projects start with. */
  function apply(command: Command, options?: { coalesce?: string }) {
    project.apply(command, options);
    saveActionDefaults(project.doc);
  }

  /** Typing into one field merges into one undo step. */
  function save(next: ActionDef[], field: string) {
    apply(setActions(next), { coalesce: `actions.${field}` });
  }

  function update(index: number, patch: Partial<ActionDef>, field: string) {
    save(
      actions.map((action, i) =>
        i === index ? ({ ...action, ...patch } as ActionDef) : action,
      ),
      `${index}.${field}`,
    );
  }

  function add(kind: ActionDef["kind"]) {
    const action: ActionDef =
      kind === "timed"
        ? {
            id: newId(),
            name: "",
            kind,
            durationMs: 1000,
            steps: [{ atMs: 0, code: "" }],
          }
        : { id: newId(), name: "", kind, start: "", stop: "" };
    apply(setActions([...actions, action]));
  }

  function remove(index: number) {
    apply(setActions(actions.filter((_, i) => i !== index)));
  }

  function editHardware(key: keyof HardwareCode, value: string) {
    apply(setHardware({ ...hardware, [key]: value }), {
      coalesce: `hardware.${key}`,
    });
  }

  const numberFrom = (input: HTMLInputElement) =>
    Math.max(0, Number(input.value) || 0);
</script>

<Modal
  {isOpen}
  titleId="actions-title"
  onClose={() => (isOpen = false)}
  panelClass="flex max-h-[90vh] w-full max-w-2xl flex-col mx-4"
>
  <div class="flex items-center gap-3 border-b border-border px-5 py-3">
    <h2 id="actions-title" class="mr-auto text-base font-semibold text-heading">
      Robot actions
    </h2>
    <IconButton label="Close" onclick={() => (isOpen = false)}><X /></IconButton
    >
  </div>

  <div class="flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-5">
    <p class="text-xs text-body">
      Java code here is pasted as-is into the sequential command export. Timed
      actions run after a path while the robot waits; while-driving actions
      start before a path and stop when it ends.
    </p>

    {#each actions as action, i (action.id)}
      <section class={[sectionClass, "flex flex-col gap-2"]}>
        <div class="flex items-end gap-2">
          <label class="flex min-w-0 flex-1 flex-col gap-1">
            <span class={labelClass}
              >Action name ({action.kind === "timed"
                ? "timed"
                : "while driving"})</span
            >
            <input
              class={fieldClass}
              aria-label="Action name"
              value={action.name}
              oninput={(event) =>
                update(i, { name: event.currentTarget.value }, "name")}
            />
          </label>
          <IconButton
            label="Delete action"
            class="hover:text-danger!"
            onclick={() => remove(i)}><Trash2 /></IconButton
          >
        </div>

        {#if action.kind === "timed"}
          {#each action.steps as step, s (s)}
            <div class="flex items-start gap-2">
              <label class="flex w-24 flex-col gap-1">
                <span class={labelClass}>At (ms)</span>
                <input
                  class={fieldClass}
                  type="number"
                  min="0"
                  step="100"
                  value={step.atMs}
                  oninput={(event) =>
                    update(
                      i,
                      {
                        steps: action.steps.map((other, j) =>
                          j === s
                            ? {
                                ...other,
                                atMs: numberFrom(event.currentTarget),
                              }
                            : other,
                        ),
                      },
                      `step${s}.at`,
                    )}
                />
              </label>
              <label class="flex min-w-0 flex-1 flex-col gap-1">
                <span class={labelClass}>Step {s + 1} code</span>
                <textarea
                  class={codeClass}
                  rows="2"
                  value={step.code}
                  oninput={(event) =>
                    update(
                      i,
                      {
                        steps: action.steps.map((other, j) =>
                          j === s
                            ? { ...other, code: event.currentTarget.value }
                            : other,
                        ),
                      },
                      `step${s}.code`,
                    )}></textarea>
              </label>
              <IconButton
                label="Delete step"
                class="mt-5 hover:text-danger!"
                onclick={() =>
                  update(
                    i,
                    { steps: action.steps.filter((_, j) => j !== s) },
                    "steps",
                  )}><Trash2 /></IconButton
              >
            </div>
          {/each}
          <div class="flex items-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              onclick={() =>
                update(
                  i,
                  {
                    steps: [
                      ...action.steps,
                      {
                        atMs: Math.max(
                          0,
                          ...action.steps.map((step) => step.atMs),
                        ),
                        code: "",
                      },
                    ],
                  },
                  "steps",
                )}><Plus class="size-4" /> Add step</Button
            >
            <label class="ml-auto flex w-32 flex-col gap-1">
              <span class={labelClass}>Total time (ms)</span>
              <input
                class={fieldClass}
                type="number"
                min="0"
                step="100"
                value={action.durationMs}
                oninput={(event) =>
                  update(
                    i,
                    { durationMs: numberFrom(event.currentTarget) },
                    "duration",
                  )}
              />
            </label>
          </div>
        {:else}
          {#each [["start", "Start code"], ["stop", "Stop code"]] as const as [key, label] (key)}
            <label class="flex flex-col gap-1">
              <span class={labelClass}>{label}</span>
              <textarea
                class={codeClass}
                rows="2"
                value={action[key]}
                oninput={(event) =>
                  update(i, { [key]: event.currentTarget.value }, key)}
              ></textarea>
            </label>
          {/each}
        {/if}
      </section>
    {/each}

    <div class="flex gap-2">
      <Button size="sm" onclick={() => add("timed")}
        ><Plus class="size-4" /> Add timed action</Button
      >
      <Button size="sm" onclick={() => add("during")}
        ><Plus class="size-4" /> Add while-driving action</Button
      >
    </div>

    <section class={[sectionClass, "flex flex-col gap-2"]}>
      <h3 class={sectionTitleClass}>Hardware code</h3>
      {#each [["imports", "Imports"], ["fields", "Fields"], ["init", "Init (before start)"]] as const as [key, label] (key)}
        <label class="flex flex-col gap-1">
          <span class={labelClass}>{label}</span>
          <textarea
            class={codeClass}
            rows="3"
            value={hardware[key]}
            oninput={(event) => editHardware(key, event.currentTarget.value)}
          ></textarea>
        </label>
      {/each}
    </section>
  </div>
</Modal>
