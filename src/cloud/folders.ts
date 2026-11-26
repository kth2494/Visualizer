/**
 * Cloud auto folders are paths like "Red/Left": each auto stores the path of
 * the folder it is in, and folders exist while some auto is inside them.
 */

/** "  Red / /Left " → "Red/Left"; "" is the top. */
export const cleanFolder = (path: string): string =>
  path
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean)
    .join("/");

/** Whether something filed in `path` is in `folder` or any folder below it. */
export const isWithin = (path: string, folder: string): boolean =>
  !folder || path === folder || path.startsWith(`${folder}/`);

/** The folders directly inside `folder`, as full paths, A → Z. */
export function subfolders(paths: string[], folder: string): string[] {
  const depth = folder ? folder.split("/").length : 0;
  const children = paths
    .filter((path) => path && path !== folder && isWithin(path, folder))
    .map((path) =>
      path
        .split("/")
        .slice(0, depth + 1)
        .join("/"),
    );
  return [...new Set(children)].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true }),
  );
}

/** The last part of a path, as a folder shows its name. */
export const folderName = (path: string): string =>
  path.split("/").at(-1) ?? "";
