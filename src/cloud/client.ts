import { promptDialog } from "../lib/dialog";
import type { ProjectDoc } from "../io";

export interface CloudAuto {
  id: string;
  name: string;
  /** ISO time of the last connection, or of creation. */
  updatedAt: string;
}

const PASSWORD_KEY = "pedro_team_password";
const NAME_KEY = "pedro_cloud_name";

const stored = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const store = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Private windows: asked again next time.
  }
};

/** Thrown when the person dismissed the password or name prompt. */
export class CloudCancelled extends Error {}

async function remembered(key: string, ask: () => Promise<string | null>) {
  const known = stored(key);
  if (known) return known;
  const value = await ask();
  if (!value) throw new CloudCancelled();
  store(key, value);
  return value;
}

export const teamPassword = () =>
  remembered(PASSWORD_KEY, () =>
    promptDialog({
      title: "Team password",
      message: "Cloud autos are shared with everyone who has this password.",
      confirmLabel: "Continue",
    }),
  );

export const displayName = () =>
  remembered(NAME_KEY, () =>
    promptDialog({
      title: "Your name",
      message: "Teammates see it while you're in the same auto.",
      confirmLabel: "Continue",
    }),
  );

/** Forget a password the server refused, so the next call asks again. */
export function refused(response: Response) {
  if (response.status !== 401) return false;
  store(PASSWORD_KEY, null);
  return true;
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const response = await fetch("/api/autos", {
    method,
    headers: {
      "x-team-password": await teamPassword(),
      "content-type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (refused(response)) throw new Error("Wrong team password");
  if (!response.ok) {
    const { error } = await response.json().catch(() => ({}));
    throw new Error(error || `The server answered ${response.status}`);
  }
  return response.json();
}

export const listAutos = () => call<CloudAuto[]>("GET");
export const createAuto = (name: string, doc: ProjectDoc) =>
  call<{ id: string }>("POST", { name, doc });
export const renameAuto = (id: string, name: string) =>
  call("PATCH", { id, name });
export const deleteAuto = (id: string) => call("DELETE", { id });

const URL_PARAM = "auto";

/** The auto named in the address, for opening on load. */
export const autoInUrl = (): string | null =>
  new URL(location.href).searchParams.get(URL_PARAM);

/** Name the open auto in the address, so the link opens it for teammates. */
export function setUrl(id: string | null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set(URL_PARAM, id);
  else url.searchParams.delete(URL_PARAM);
  history.replaceState(history.state, "", url);
}
