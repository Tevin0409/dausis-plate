// Slice 2.11 in Reports: the "Ads, for invoicing" cells (spec-2.12 "Promos & ads").
import { describe, expect, test } from "bun:test";
import { parseAdPrice, priceLabel } from "@/lib/promos";
import { amountSort, amountTotal, runLabel, tapRate } from "@/lib/reports/promos";

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

describe("Amount due", () => {
  const rows = [
    { counted_here: true, amount_due: 3000 },
    { counted_here: false, amount_due: null }, // "—": counted in the period the run started
    { counted_here: true, amount_due: null }, // "Not set"
    { counted_here: true, amount_due: 0 },
  ];
  test("the total leaves out — and Not set", () => expect(amountTotal(rows)).toBe(3000));
  test("— and Not set sort below 0", () => expect(rows.map(amountSort)).toEqual([3000, -1, -1, 0]));
});

describe("the price field and its label", () => {
  test("commas and spaces dropped; empty is no price; whole shillings to 10,000,000", () => {
    expect(parseAdPrice("3,000")).toEqual({ ok: true, value: 3000 });
    expect(parseAdPrice(" 3 500 ")).toEqual({ ok: true, value: 3500 });
    expect(parseAdPrice("")).toEqual({ ok: true, value: null });
    expect(parseAdPrice("0")).toEqual({ ok: true, value: 0 });
    expect(parseAdPrice("10000000")).toEqual({ ok: true, value: 10_000_000 });
    for (const bad of ["10000001", "-5", "2.5", "KSh 300", "3k"]) expect(parseAdPrice(bad).ok).toBe(false);
  });
  test("KSh 3,000, Free, No price yet", () => {
    expect(priceLabel(3000)).toBe("KSh\u00A03,000");
    expect(priceLabel(0)).toBe("Free");
    expect(priceLabel(null)).toBe("No price yet");
  });
});
