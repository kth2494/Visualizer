import { pathStem } from "../../utils/filename";

const RESERVED = new Set([
  // Java
  "abstract",
  "assert",
  "boolean",
  "break",
  "byte",
  "case",
  "catch",
  "char",
  "class",
  "const",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extends",
  "final",
  "finally",
  "float",
  "for",
  "goto",
  "if",
  "implements",
  "import",
  "instanceof",
  "int",
  "interface",
  "long",
  "native",
  "new",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "short",
  "static",
  "strictfp",
  "super",
  "switch",
  "synchronized",
  "this",
  "throw",
  "throws",
  "transient",
  "try",
  "void",
  "volatile",
  "while",
  "var",
  "record",
  "yield",
  "sealed",
  "permits",
  // Kotlin
  "as",
  "fun",
  "in",
  "is",
  "object",
  "typealias",
  "val",
  "when",
  // Literals
  "true",
  "false",
  "null",
]);

// Java and Kotlin take any Unicode letter, so 한글 names stay.
const NOT_IDENTIFIER = /[^\p{L}\p{Nd}]/gu;
const STARTS_WITH_DIGIT = /^\p{Nd}/u;

/** Strips everything that cannot appear in an identifier. */
export function sanitizeIdentifier(
  input: string | undefined,
  fallback: string,
): string {
  const cleaned = (input || "").replace(NOT_IDENTIFIER, "");
  if (!cleaned) return fallback;
  if (STARTS_WITH_DIGIT.test(cleaned)) return `${fallback}${cleaned}`;
  return cleaned;
}

export function camelCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toLowerCase() + str.slice(1);
}

export function pascalCase(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function toClassName(
  input: string | null | undefined,
  fallback: string,
): string {
  const cleaned = pathStem(input).replace(NOT_IDENTIFIER, "");
  if (!cleaned) return fallback;
  // A class name cannot start with a digit, so "2024Auto.pp.json" -> "Path2024Auto".
  const name = pascalCase(
    STARTS_WITH_DIGIT.test(cleaned) ? `Path${cleaned}` : cleaned,
  );
  return RESERVED.has(name.toLowerCase()) ? `${name}Path` : name;
}

export class IdentifierAllocator {
  private readonly used = new Set<string>();

  constructor(reserved: string[] = []) {
    reserved.forEach((name) => this.used.add(name));
  }

  allocate(preferred: string | undefined, fallback: string): string {
    return this.take(camelCase(sanitizeIdentifier(preferred, fallback)));
  }

  allocateExact(name: string): string {
    return this.take(name);
  }

  private take(candidate: string): string {
    let base = candidate || "value";
    if (RESERVED.has(base)) base = `${base}Pose`;
    if (!this.used.has(base)) {
      this.used.add(base);
      return base;
    }
    let counter = 2;
    while (this.used.has(`${base}_${counter}`)) counter += 1;
    const name = `${base}_${counter}`;
    this.used.add(name);
    return name;
  }
}
