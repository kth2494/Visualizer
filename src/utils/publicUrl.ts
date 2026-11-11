/**
 * A file from `public/`, relative to the page, so the app also works when
 * deployed under a sub-path (GitHub Pages). Saved settings keep "/robot.png".
 */
export function publicUrl(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") ? `.${path}` : path;
}
