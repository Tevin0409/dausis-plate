import { describe, expect, test } from "bun:test";
import { normaliseCode } from "@/lib/order-code";

describe("normaliseCode", () => {
  test("the forms a customer types all become the stored code", () => {
    for (const typed of ["DP-0142", "dp-0142", "DP 0142", "dp0142", " 0142 ", "142"]) expect(normaliseCode(typed)).toBe("DP-0142");
  });
  test("codes past 9999 keep every digit", () => {
    expect(normaliseCode("dp-12345")).toBe("DP-12345");
  });
  test("no digits: left as typed, trimmed", () => {
    expect(normaliseCode("  dp-  ")).toBe("dp-");
  });
});
