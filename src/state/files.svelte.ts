import { fromStore, get } from "svelte/store";
import { debounce } from "lodash";
import {
  createDefaultProject,
  parseProject,
  serializeProject,
  type ProjectDoc,
} from "../io";
import {
  canPickExistingFile,
  canPickSaveFile,
  isPickerCancel,
  overwritePickedFile,
  saveToPickedFile,
} from "../lib/files/localFiles";
import { withActionDefaults } from "../lib/session/actionDefaults";
import { importSequentialJava } from "../io/javaImport";
import { importRoutine } from "../io/routineImport";
import {
  loadSessionSnapshot,
  saveSessionSnapshot,
} from "../lib/session/sessionSnapshot";
import { chooseDialog, confirmDialog } from "../lib/dialog";
import { askFileName } from "../lib/files/fileNames";
import { mirrorProject, type Flip } from "../model/mirror";
import { showToast } from "../lib/toast";
import { activePaths, currentFilePath } from "../stores";
import * as browserFileStore from "../utils/browserFileStore";
import {
  OPENABLE_EXTENSIONS,
  PROJECT_EXTENSION,
  basename,
  pathStem,
} from "../utils/filename";
import type { Overlays } from "./overlays.svelte";
import type { Prefs } from "./prefs.svelte";
import type { ProjectStore } from "./project.svelte";

/** Opening, saving and renaming the project, and recovering the last session. */
export class ProjectFiles {
  #filePath = fromStore(currentFilePath);
  #activePaths = fromStore(activePaths);
  /** False until startup has had the chance to restore the last session. */
  #started = $state(false);
  #project: ProjectStore;
  #prefs: Prefs;
  #overlays: Overlays;

  constructor(project: ProjectStore, prefs: Prefs, overlays: Overlays) {
    this.#project = project;
    this.#prefs = prefs;
    this.#overlays = overlays;
  }

  /** The open project as it would be saved, including which overlays are shown. */
  current(): ProjectDoc {
    return { ...this.#project.doc, activePaths: this.#activePaths.current };
  }

  /** Called before another document replaces the open one (leaves a cloud auto). */
  onOpen: () => void = () => {};

  /** Open a document, starting a fresh undo history. */
  open(doc: ProjectDoc, options: { saved?: boolean } = {}) {
    this.onOpen();
    this.#project.load(doc, options);
    activePaths.set(doc.activePaths);
  }

  /** Start a default project with the current robot, once confirmed. */
  async newProject() {
    if (
      this.#project.dirty &&
      !(await confirmDialog({
        title: "Start a new project?",
        message: "Your unsaved changes will be lost.",
        confirmLabel: "Discard changes",
        danger: true,
      }))
    ) {
      return;
    }
    this.open(
      withActionDefaults(
        createDefaultProject(
          this.#project.doc.robot,
          this.#prefs.settings.fieldMap,
        ),
      ),
    );
    currentFilePath.set(null);
  }

  /** Parse a project file, reporting a failure or any warnings. */
  read(text: string): ProjectDoc | null {
    const result = parseProject(text, this.#project.doc.robot);
    if (!result.ok) {
      showToast(result.error, "error");
      return null;
    }
    result.warnings.forEach((warning) => showToast(warning, "warning"));
    return result.doc;
  }

  /** Save into app storage under the open file's name, asking for one if it has none. */
  async save() {
    const name =
      get(currentFilePath) ??
      (await askFileName({
        title: "Save project",
        value: "my_path",
        confirmLabel: "Save",
      }));
    if (!name) return;
    try {
      await this.#overlays.saveAll();
      await browserFileStore.writeFile(name, serializeProject(this.current()));
      currentFilePath.set(name);
      this.#project.markSaved();
      showToast(`Saved ${name}`, "success");
    } catch (error) {
      console.error("Failed to save project to storage:", error);
      showToast("Couldn't save the project in the app.", "error");
    }
  }

  /** Save to a file on disk through the browser's file picker. */
  async saveAs() {
    await this.#overlays.saveAll();
    const content = serializeProject(this.current(), { pretty: true });

    if (!canPickSaveFile() && !canPickExistingFile()) {
      // Browsers without file pickers (e.g. Firefox) save into app storage.
      await this.save();
      showToast(
        "This browser can't save to your computer directly, so the project was saved in the app. Download it from the file manager.",
        "info",
      );
      return;
    }

    try {
      const name = canPickSaveFile()
        ? await saveToPickedFile(
            content,
            basename(get(currentFilePath)) || `path${PROJECT_EXTENSION}`,
          )
        : await overwritePickedFile(content);
      currentFilePath.set(name);
      this.#project.markSaved();
      showToast(`Saved to ${name}`, "success");
    } catch (error) {
      if (isPickerCancel(error)) return;
      console.error("Save As failed:", error);
      showToast("Couldn't save to that file.", "error");
    }
  }

  async rename() {
    const currentPath = get(currentFilePath);
    if (!currentPath) return;

    const newName = await askFileName({
      title: "Rename project",
      value: pathStem(currentPath),
      confirmLabel: "Rename",
    });
    if (!newName || newName === currentPath) return;

    try {
      if (await browserFileStore.fileExists(newName)) {
        showToast(`A file named "${newName}" already exists.`, "error");
        return;
      }
      await browserFileStore.writeFile(
        newName,
        serializeProject(this.current()),
      );
      await browserFileStore.deleteFile(currentPath);
      currentFilePath.set(newName);
      this.#project.markSaved();
      showToast(`Renamed to: ${newName}`, "success");
    } catch (error) {
      console.error("Failed to rename path file:", error);
      showToast("Failed to rename the path file.", "error");
    }
  }

  /** Save a copy flipped left ↔ right or up ↔ down as a new file, and open it. */
  async duplicateMirrored() {
    const flip = await chooseDialog<Flip>({
      title: "Duplicate mirrored",
      message: "Which way should the copy be flipped?",
      choices: [
        { value: "leftRight", label: "Left ↔ right" },
        { value: "upDown", label: "Up ↕ down" },
        { value: "both", label: "Both" },
      ],
    });
    if (!flip) return;
    const name = await askFileName({
      title: "Duplicate mirrored",
      value: `${pathStem(get(currentFilePath)) || "path"}_${{ leftRight: "mirrored", upDown: "flipped", both: "rotated" }[flip]}`,
      confirmLabel: "Create",
    });
    if (!name) return;
    try {
      if (
        (await browserFileStore.fileExists(name)) &&
        !(await confirmDialog({
          title: `Overwrite ${name}?`,
          message: "A file with this name already exists.",
          confirmLabel: "Overwrite",
          danger: true,
        }))
      ) {
        return;
      }
      const mirrored = mirrorProject(this.current(), flip);
      await browserFileStore.writeFile(name, serializeProject(mirrored));
      this.open(mirrored);
      currentFilePath.set(name);
      showToast(`Created ${name}`, "success");
    } catch (error) {
      console.error("Failed to save the mirrored project:", error);
      showToast("Couldn't save the mirrored project.", "error");
    }
  }

  /** Ask for a project file on disk and open it. */
  openFromDisk() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = OPENABLE_EXTENSIONS.join(",");
    input.onchange = () => void this.upload(input);
    input.click();
  }

  /** Open a sequential command OpMode the Visualizer exported, as a new unsaved project. */
  openJavaFromDisk() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".java";
    input.onchange = () => void this.openJava(input);
    input.click();
  }

  async openJava(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const text = await file.text();
    await this.#openConverted(file.name, (base) => {
      const result = importSequentialJava(text, base);
      // Named after the class, so exporting again suggests the same class name.
      return result.ok ? { ...result, name: result.className } : result;
    });
  }

  /** Open a routine file taken off the robot (or downloaded from Send to robot). */
  openRoutineFromDisk() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      input.value = "";
      if (file) await this.openRoutine(await file.text(), file.name);
    };
    input.click();
  }

  /** Open a routine's text, as a new unsaved project named after it. */
  async openRoutine(text: string, label: string) {
    await this.#openConverted(label, (base) => importRoutine(text, base));
  }

  /** Open something converted into a project, once unsaved work is let go. */
  async #openConverted(
    label: string,
    convert: (
      base: ProjectDoc,
    ) =>
      | { ok: true; doc: ProjectDoc; name: string; warnings: string[] }
      | { ok: false; error: string },
  ) {
    if (
      this.#project.dirty &&
      !(await confirmDialog({
        title: `Open ${label}?`,
        message: "Your unsaved changes will be lost.",
        confirmLabel: "Discard changes",
        danger: true,
      }))
    ) {
      return;
    }
    const result = convert(
      withActionDefaults(
        createDefaultProject(
          this.#project.doc.robot,
          this.#prefs.settings.fieldMap,
        ),
      ),
    );
    if (!result.ok) {
      showToast(result.error, "error");
      return;
    }
    this.open(result.doc, { saved: false });
    currentFilePath.set(`${result.name}${PROJECT_EXTENSION}`);
    // A dialog, not a toast: a missed warning here costs real work.
    if (result.warnings.length) {
      await confirmDialog({
        title: `Opened ${label} with warnings`,
        message: result.warnings.join("\n"),
        confirmLabel: "OK",
      });
    }
  }

  /** Open a file chosen from disk and keep a copy in app storage. */
  async upload(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    if (!OPENABLE_EXTENSIONS.some((ext) => lowerName.endsWith(ext))) {
      showToast(`Please select a ${PROJECT_EXTENSION} file`, "error");
      return;
    }

    const doc = this.read(await file.text());
    if (!doc) return;
    this.open(doc);
    try {
      await browserFileStore.writeFile(file.name, serializeProject(doc));
      currentFilePath.set(file.name);
    } catch (error) {
      console.warn("Failed to cache uploaded file to store:", error);
    }
  }

  /**
   * Reopen the last session if one was left unsaved; otherwise start the fresh
   * document from the robot the user last configured. Autosave starts after.
   */
  start() {
    const snapshot = loadSessionSnapshot();
    if (snapshot) {
      this.#prefs.value = snapshot.settings;
      this.open(snapshot.project, { saved: false });
      currentFilePath.set(snapshot.currentFilePath);
    } else {
      this.#project.load({
        ...this.#project.doc,
        robot: this.#prefs.fallbackRobot,
      });
    }
    this.#started = true;
  }

  /** Keep the session snapshot current. Call during component setup. */
  autosaveSession() {
    const save = debounce(saveSessionSnapshot, 750);
    $effect(() => {
      if (!this.#started) return;
      save({
        project: this.current(),
        settings: this.#prefs.settings,
        currentFilePath: this.#filePath.current,
      });
    });
    $effect(() => () => save.flush());
  }
}
