import type { ProjectDoc } from "../../io";
import { normalizeActions, normalizeHardware } from "../../utils/normalize";

const ACTION_DEFAULTS_KEY = "pedro_action_defaults_v1";

type ActionDefaults = Pick<ProjectDoc, "actions" | "hardware">;

/** Remember the actions last edited, so new projects start with the same robot. */
export function saveActionDefaults({ actions, hardware }: ActionDefaults) {
  try {
    localStorage.setItem(
      ACTION_DEFAULTS_KEY,
      JSON.stringify({ actions, hardware }),
    );
  } catch (error) {
    console.error("Saving action defaults failed:", error);
  }
}

/** `doc` with the remembered actions and hardware code, if there are any. */
export function withActionDefaults(doc: ProjectDoc): ProjectDoc {
  try {
    const raw = JSON.parse(localStorage.getItem(ACTION_DEFAULTS_KEY) ?? "{}");
    const actions = normalizeActions(raw?.actions);
    const hardware = normalizeHardware(raw?.hardware);
    return {
      ...doc,
      ...(actions && { actions }),
      ...(hardware && { hardware }),
    };
  } catch {
    return doc;
  }
}
