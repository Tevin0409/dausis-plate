// Fix round (QA 2.3, RQA23-04): a server file may render a "use client" file's components, but
// anything else it imports from there arrives as a client reference, not the function, and calling
// it crashes the page. Staff Settings did exactly that with closedDateLabel. This reads every
// server file under src and fails on any import from a client file that isn't a component
// (PascalCase) or a type.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SRC = resolve(import.meta.dir, "../../src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}

const isClient = (text: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(text);

function resolveImport(from: string, spec: string) {
  const base = spec.startsWith("@/") ? join(SRC, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const p of [base, `${base}.tsx`, `${base}.ts`, join(base, "index.tsx"), join(base, "index.ts")]) {
    if (existsSync(p) && statSync(p).isFile()) return p;
  }
  return null;
}

/** Value names a file imports from `spec`, without `type` imports. */
function valueNames(clause: string) {
  if (/^\s*type\s/.test(clause)) return [];
  const names: string[] = [];
  const braces = clause.match(/\{([^}]*)\}/);
  if (braces) {
    for (const part of braces[1]!.split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      names.push(p.split(/\s+as\s+/)[0]!.trim());
    }
  }
  const def = clause.replace(/\{[^}]*\}/, "").replace(/,/g, " ").trim();
  if (def && !def.startsWith("*")) names.push("default");
  if (def.startsWith("*")) names.push("*");
  return names;
}

describe("client boundary", () => {
  test("server files import only components and types from client files", () => {
    const bad: string[] = [];
    for (const file of files(SRC)) {
      const text = readFileSync(file, "utf8");
      if (isClient(text)) continue;
      for (const m of text.matchAll(/import\s+([^;]+?)\s+from\s+["']([^"']+)["']/g)) {
        const target = resolveImport(file, m[2]!);
        if (!target || !isClient(readFileSync(target, "utf8"))) continue;
        for (const name of valueNames(m[1]!)) {
          if (name === "default" || /^[A-Z][a-z]/.test(name)) continue; // a component (not a CONSTANT)
          bad.push(`${file.slice(SRC.length + 1)} imports ${name} from ${m[2]}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  test("the check would have caught RQA23-04", () => {
    expect(valueNames("{ ClosedDates, closedDateLabel }")).toEqual(["ClosedDates", "closedDateLabel"]);
    expect(valueNames("{ HoursForm, type Day }")).toEqual(["HoursForm"]);
    expect(valueNames("type { Day }")).toEqual([]);
  });
});
