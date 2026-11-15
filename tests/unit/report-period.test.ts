import { describe, expect, test } from "bun:test";
import { changeText, compareLabel, comparePeriod, customRangeError, daysIn, grainFor, parseReportPeriod, periodLabel, periodQuery } from "@/lib/reports/period";

const TODAY = "2026-11-07"; // a Saturday

describe("compare periods", () => {
  test("Today is compared with the same weekday last week", () => {
    expect(comparePeriod("today", TODAY, TODAY)).toEqual({ from: "2026-10-31", to: "2026-10-31" });
  });
  test("This week: Mon–Wed against last Mon–Wed", () => {
    expect(comparePeriod("week", "2026-11-02", "2026-11-04")).toEqual({ from: "2026-10-26", to: "2026-10-28" });
  });
  test("This month: 1–8 Nov against 1–8 Oct", () => {
    expect(comparePeriod("month", "2026-11-01", "2026-11-08")).toEqual({ from: "2026-10-01", to: "2026-10-08" });
  });
  test("This month stops at the last day of a shorter last month", () => {
    expect(comparePeriod("month", "2026-03-01", "2026-03-30")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparePeriod("month", "2028-03-01", "2028-03-31")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(comparePeriod("month", "2026-01-01", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-15" });
  });
  test("Pick dates: the same number of days just before", () => {
    expect(comparePeriod("custom", "2026-11-01", "2026-11-07")).toEqual({ from: "2026-10-25", to: "2026-10-31" });
    expect(comparePeriod("custom", "2026-11-05", "2026-11-05")).toEqual({ from: "2026-11-04", to: "2026-11-04" });
  });
});

describe("parseReportPeriod", () => {
  test("the ranges", () => {
    expect(parseReportPeriod({}, TODAY)).toMatchObject({ range: "today", from: TODAY, to: TODAY });
    expect(parseReportPeriod({ range: "week" }, TODAY)).toMatchObject({ range: "week", from: "2026-11-02", to: TODAY });
    expect(parseReportPeriod({ range: "month" }, TODAY)).toMatchObject({ range: "month", from: "2026-11-01", to: TODAY });
    expect(parseReportPeriod({ from: "2026-10-01", to: "2026-10-31", tab: "dishes" }, TODAY)).toMatchObject({ range: "custom", from: "2026-10-01", to: "2026-10-31", tab: "dishes" });
  });
  test("a week starts on Monday even when today is Monday", () => {
    expect(parseReportPeriod({ range: "week" }, "2026-11-02")).toMatchObject({ from: "2026-11-02", to: "2026-11-02" });
  });
  test("bad input falls back to Today", () => {
    for (const bad of [
      { from: "banana", to: "2026-11-01" },
      { from: "2026-11-05", to: "2026-11-01" },
      { from: "2026-02-31", to: "2026-03-01" },
      { from: "2026-11-01", to: "2026-11-30" }, // after today
      { from: "2025-10-01", to: "2026-11-07" }, // over 366 days
      { from: "2026-11-01" },
      { range: "banana" },
    ]) {
      const p = parseReportPeriod(bad, TODAY);
      expect(p).toMatchObject({ range: "today", from: TODAY, to: TODAY });
    }
  });
  test("366 days is the longest, and nothing before the first order", () => {
    expect(parseReportPeriod({ from: "2025-11-07", to: TODAY }, TODAY).range).toBe("custom");
    expect(parseReportPeriod({ from: "2025-11-06", to: TODAY }, TODAY).range).toBe("today");
    expect(parseReportPeriod({ from: "2026-10-01", to: "2026-10-05" }, TODAY, "2026-10-03").range).toBe("today");
  });
  test("takes URLSearchParams as well, and an unknown tab is Sales", () => {
    expect(parseReportPeriod(new URLSearchParams("range=month&tab=zzz"), TODAY)).toMatchObject({ range: "month", tab: "sales" });
  });
  test("the query string round-trips", () => {
    const p = parseReportPeriod({ from: "2026-10-01", to: "2026-10-31", tab: "times" }, TODAY);
    expect(periodQuery(p)).toBe("from=2026-10-01&to=2026-10-31&tab=times");
    expect(periodQuery(parseReportPeriod({}, TODAY))).toBe("");
  });
});

describe("words", () => {
  test("the period read back", () => {
    expect(periodLabel({ range: "today", from: TODAY, to: TODAY }, TODAY)).toBe("Sat 7 Nov");
    expect(periodLabel({ range: "week", from: "2026-11-02", to: TODAY }, TODAY)).toBe("Mon 2 Nov – Sat 7 Nov");
    expect(periodLabel({ range: "month", from: "2026-11-01", to: TODAY }, TODAY)).toBe("1 – 7 Nov");
    expect(periodLabel({ range: "custom", from: "2026-10-01", to: TODAY }, TODAY)).toBe("1 Oct – 7 Nov");
    expect(periodLabel({ range: "custom", from: "2025-10-01", to: TODAY }, TODAY)).toBe("1 Oct 2025 – 7 Nov 2026");
    expect(periodLabel({ range: "custom", from: "2025-10-01", to: "2025-10-09" }, TODAY)).toBe("1 – 9 Oct 2025");
  });
  test("the compare line", () => {
    expect(compareLabel({ range: "today", compare: { from: "2026-10-31", to: "2026-10-31" } }, TODAY)).toBe("Compared with Sat 31 Oct");
  });
  test("change text: arrows in words, none without an earlier figure", () => {
    expect(changeText(108, 100, "last week")).toBe("↑ 8% on last week");
    expect(changeText(97, 100, "last Sat")).toBe("↓ 3% on last Sat");
    expect(changeText(100, 100, "last week")).toBe("No change on last week");
    expect(changeText(5, 0, "last week")).toBeNull();
    expect(changeText(5, null, "last week")).toBeNull();
  });
  test("grain follows the length", () => {
    expect(grainFor("2026-11-01", "2026-12-01")).toBe("day"); // 31
    expect(daysIn("2026-10-01", "2026-11-30")).toBe(61);
    expect(grainFor("2026-09-01", "2026-11-03")).toBe("week"); // 64
    expect(grainFor("2025-11-07", TODAY)).toBe("month");
  });
  test("the Pick dates line", () => {
    expect(customRangeError("2026-11-05", "2026-11-01", TODAY)).toBe("The end date is before the start date.");
    expect(customRangeError("2026-11-01", "2026-11-05", TODAY)).toBeNull();
    expect(customRangeError("2026-11-01", "2026-11-09", TODAY)).toMatch(/after today/);
  });
});
