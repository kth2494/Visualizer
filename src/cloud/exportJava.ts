import type { ProjectDoc } from "../io";
import { generateSequentialCommandCode } from "../lib/codegen";
import { toClassName } from "../lib/codegen/identifiers";

/**
 * One sequential command OpMode per auto, named after it. Java wants the file
 * named after its class, so two autos that clean up to the same name get 2, 3…
 */
export function javaFilesFor(
  autos: { name: string; doc: ProjectDoc }[],
): { name: string; text: string }[] {
  const taken = new Set<string>();
  return autos.map(({ name, doc }) => {
    const base = toClassName(name, "AutoPath");
    let className = base;
    for (let n = 2; taken.has(className.toLowerCase()); n++) {
      className = `${base}${n}`;
    }
    taken.add(className.toLowerCase());
    return {
      name: `${className}.java`,
      text: generateSequentialCommandCode(
        doc.startPoint,
        doc.lines,
        className,
        doc.sequence,
        { actions: doc.actions, hardware: doc.hardware },
      ),
    };
  });
}
