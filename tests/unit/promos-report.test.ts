// Slice 2.11 in Reports: the "Ads, for invoicing" cells (spec-2.12 "Promos & ads").
import { describe, expect, test } from "bun:test";
import { runLabel, tapRate } from "@/lib/reports/promos";

describe("Ads, for invoicing", () => {
  test("tap rate: one decimal, and a dash under 50 views", () => {
    expect(tapRate(40567, 1284321)).toBe("3.2%");
    expect(tapRate(3, 49)).toBe("—");
    expect(tapRate(0, 50)).toBe("0.0%");
  });
  test("runs: the year only when the run isn't all in this year", () => {
    expect(runLabel("2026-11-01", "2026-12-01", "2026-11-15")).toBe("Sun 1 Nov – Tue 1 Dec");
    expect(runLabel("2025-10-11", "2025-10-31", "2026-11-15")).toBe("Sat 11 Oct 2025 – Fri 31 Oct 2025");
    expect(runLabel("2026-12-20", "2027-01-10", "2026-12-25")).toBe("Sun 20 Dec 2026 – Sun 10 Jan 2027");
  });
});
