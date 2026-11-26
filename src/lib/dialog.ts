import { writable } from "svelte/store";

interface BaseRequest {
  title: string;
  message?: string;
  confirmLabel?: string;
}

export interface ConfirmRequest extends BaseRequest {
  kind: "confirm";
  /** Styles the confirm button as destructive. */
  danger?: boolean;
  resolve: (confirmed: boolean) => void;
}

export interface PromptRequest extends BaseRequest {
  kind: "prompt";
  value: string;
  placeholder?: string;
  /** Shown under the field, e.g. what gets added to the name. */
  hint?: string;
  /** A reason the value can't be used, or null when it can. */
  validate?: (value: string) => string | null;
  /** Accept an empty answer (resolves to ""). */
  allowEmpty?: boolean;
  resolve: (value: string | null) => void;
}

export interface ChoiceRequest extends BaseRequest {
  kind: "choice";
  /** One button each; the first is the default. */
  choices: { value: string; label: string }[];
  resolve: (value: string | null) => void;
}

export type DialogRequest = ConfirmRequest | PromptRequest | ChoiceRequest;

/** The open confirm or prompt dialog; the host renders it. */
export const dialogRequest = writable<DialogRequest | null>(null);

/** Ask a yes/no question. Resolves false if dismissed. */
export function confirmDialog(
  options: Omit<ConfirmRequest, "kind" | "resolve">,
): Promise<boolean> {
  return new Promise((resolve) =>
    dialogRequest.set({ ...options, kind: "confirm", resolve }),
  );
}

/** Ask for a line of text. Resolves to the trimmed value, or null if dismissed. */
export function promptDialog(
  options: Omit<PromptRequest, "kind" | "resolve" | "value"> & {
    value?: string;
  },
): Promise<string | null> {
  return new Promise((resolve) =>
    dialogRequest.set({ value: "", ...options, kind: "prompt", resolve }),
  );
}

/** Pick one of a few options. Resolves to its value, or null if dismissed. */
export function chooseDialog<T extends string>(
  options: Omit<ChoiceRequest, "kind" | "resolve" | "choices"> & {
    choices: { value: T; label: string }[];
  },
): Promise<T | null> {
  return new Promise((resolve) =>
    dialogRequest.set({
      ...options,
      kind: "choice",
      resolve: resolve as (value: string | null) => void,
    }),
  );
}
