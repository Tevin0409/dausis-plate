import { describe, expect, test } from "bun:test";
import { TEMP_WORDS, makeTempPassword } from "@/lib/temp-password";

/** True when b is a one-letter change, insertion or deletion from a. */
function oneApart(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  if (a.length === b.length) return [...a].filter((c, i) => c !== b[i]).length <= 1;
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return [...l].some((_, i) => l.slice(0, i) + l.slice(i + 1) === s);
}

describe("temporary password words (spec-2.6 Build follow-ups)", () => {
  test("about 250 words, unique, short and lowercase a–z only", () => {
    expect(TEMP_WORDS.length).toBeGreaterThanOrEqual(240);
    expect(new Set(TEMP_WORDS).size).toBe(TEMP_WORDS.length);
    for (const w of TEMP_WORDS) expect(w).toMatch(/^[a-z]{3,9}$/);
  });

  test("no two words are lookalikes (one letter apart)", () => {
    const close: string[] = [];
    TEMP_WORDS.forEach((a, i) => TEMP_WORDS.slice(i + 1).forEach((b) => oneApart(a, b) && close.push(`${a}/${b}`)));
    expect(close).toEqual([]);
  });

  test("keeps the mango-4729 shape", () => {
    for (let i = 0; i < 200; i++) {
      const p = makeTempPassword();
      expect(p).toMatch(/^[a-z]{3,9}-\d{4}$/);
      expect(TEMP_WORDS).toContain(p.split("-")[0] as (typeof TEMP_WORDS)[number]);
      expect(p.length).toBeGreaterThanOrEqual(8);
    }
  });
});
