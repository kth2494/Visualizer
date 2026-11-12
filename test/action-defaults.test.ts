// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { createDefaultProject } from "../src/io";
import {
  saveActionDefaults,
  withActionDefaults,
} from "../src/lib/session/actionDefaults";
import type { ActionDef, HardwareCode } from "../src/types";
import { DEFAULT_ROBOT } from "./support/fixtures";

const fresh = () => createDefaultProject(DEFAULT_ROBOT, "decode.webp");
const actions: ActionDef[] = [
  { id: "intake", name: "흡입", kind: "during", start: "a();", stop: "b();" },
];
const hardware: HardwareCode = { imports: "", fields: "int x;", init: "" };

describe("action defaults for new projects", () => {
  beforeEach(() => localStorage.clear());

  it("fills a new project with the last edited actions and hardware", () => {
    saveActionDefaults({ actions, hardware });
    const doc = withActionDefaults(fresh());
    expect(doc.actions).toEqual(actions);
    expect(doc.hardware).toEqual(hardware);
  });

  it("leaves a new project empty when nothing was saved", () => {
    const doc = withActionDefaults(fresh());
    expect("actions" in doc).toBe(false);
    expect("hardware" in doc).toBe(false);
  });

  it("forgets actions the user deleted", () => {
    saveActionDefaults({ actions, hardware });
    saveActionDefaults({});
    expect("actions" in withActionDefaults(fresh())).toBe(false);
  });

  it("ignores corrupt storage", () => {
    localStorage.setItem("pedro_action_defaults_v1", "{not json");
    expect("actions" in withActionDefaults(fresh())).toBe(false);
  });
});
