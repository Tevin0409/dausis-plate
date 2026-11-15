import { describe, expect, test } from "bun:test";
import { parseDates, ratingsHref } from "@/lib/ratings";

describe("parseDates (Ratings screen ?from&to, RW2B-05)", () => {
  test("a real range is kept", () => {
    expect(parseDates("2026-10-05", "2026-11-15")).toEqual({ from: "2026-10-05", to: "2026-11-15" });
    expect(parseDates("2026-11-15", "2026-11-15")).toEqual({ from: "2026-11-15", to: "2026-11-15" });
  });
  test("a malformed or impossible day falls back to all dates, without throwing", () => {
    expect(() => parseDates("2026-99-01", "2026-12-31")).not.toThrow();
    expect(parseDates("2026-99-01", "2026-12-31")).toBeNull();
    expect(parseDates("2026-01-01", "2026-13-40")).toBeNull();
    expect(parseDates("2026-02-31", "2026-03-01")).toBeNull();
    expect(parseDates("2026-1-1", "2026-01-02")).toBeNull();
  });
  test("missing, repeated or reversed dates fall back to all dates", () => {
    expect(parseDates(undefined, "2026-11-15")).toBeNull();
    expect(parseDates(["2026-11-01", "2026-11-02"], "2026-11-15")).toBeNull();
    expect(parseDates("2026-11-15", "2026-11-01")).toBeNull();
  });
  test("ratingsHref keeps the filter and the dates", () => {
    expect(ratingsHref("all", null)).toBe("/dashboard/ratings");
    expect(ratingsHref("low", { from: "2026-10-05", to: "2026-11-15" })).toBe(
      "/dashboard/ratings?show=low&from=2026-10-05&to=2026-11-15",
    );
  });
});
