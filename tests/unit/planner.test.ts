// Slice 2.5: the planner's wording and day arithmetic (spec-2.5-menu-planner.md).
import { describe, expect, test } from "bun:test";
import {
  checkFields,
  clashMessage,
  closedLine,
  copyPriceLine,
  daysLabel,
  defaultHours,
  nextOpenDay,
  outsideHours,
  platesLabel,
  soldLine,
  statusLine,
  weekDays,
  weekLabel,
} from "@/lib/planner";

describe("week label", () => {
  test("inside a month, across a month, across a year", () => {
    expect(weekLabel("2026-11-02")).toBe("2–8 Nov");
    expect(weekLabel("2026-10-26")).toBe("26 Oct – 1 Nov");
    expect(weekLabel("2026-12-28")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});

describe("days label", () => {
  const week = weekDays("2026-11-02");
  test("every day, every day but one, runs", () => {
    expect(daysLabel(week, week)).toBe("Every day");
    expect(daysLabel(week.filter((d) => d !== "2026-11-04"), week)).toBe("Every day but Wed");
    expect(daysLabel(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-06"], week)).toBe("Mon–Wed, Fri");
    expect(daysLabel(["2026-11-02", "2026-11-05", "2026-11-07"], week)).toBe("Mon, Thu, Sat");
    expect(daysLabel(["2026-11-02", "2026-11-03"], week)).toBe("Mon, Tue");
  });
  test("every open day counts as every day when Sunday is closed", () => {
    const open = week.slice(0, 6);
    expect(daysLabel(open, open)).toBe("Every day");
  });
});

describe("sold line", () => {
  test("at the limit, marked, with and without a limit", () => {
    expect(soldLine(25, 25, false)).toEqual({ text: "Sold out · 25 of 25", out: true, atLimit: true });
    expect(soldLine(14, 10, false).text).toBe("Sold out · 14 of 10");
    expect(soldLine(3, 25, true)).toEqual({ text: "Marked sold out", out: true, atLimit: false });
    expect(soldLine(12, 25, false)).toEqual({ text: "12 of 25 sold", out: false, atLimit: false });
    expect(soldLine(12, null, false).text).toBe("12 sold");
    expect(soldLine(1000, 1000, false).text).toBe("Sold out · 1,000 of 1,000");
  });
});

describe("status line and plates", () => {
  test("past, today, later, unplanned", () => {
    expect(statusLine("2026-11-02", "2026-11-04", 4)).toEqual({ text: "Done · 4", unplanned: false });
    expect(statusLine("2026-11-02", "2026-11-04", 0).text).toBe("Done · 0");
    expect(statusLine("2026-11-04", "2026-11-04", 5).text).toBe("Live · 5");
    expect(statusLine("2026-11-05", "2026-11-04", 3).text).toBe("Planned · 3");
    expect(statusLine("2026-11-05", "2026-11-04", 0)).toEqual({ text: "Not planned", unplanned: true });
  });
  test("plates", () => {
    expect(platesLabel(25)).toBe("25 plates");
    expect(platesLabel(1)).toBe("1 plate");
    expect(platesLabel(25, true)).toBe("25 plates a day");
    expect(platesLabel(null)).toBe("No limit");
  });
});

describe("next open day", () => {
  test("skips closed days and dates", () => {
    // Sat 7 Nov: Sunday closed, Monday a closed date.
    const closed = new Set(["2026-11-08", "2026-11-09"]);
    expect(nextOpenDay("2026-11-07", (d) => !closed.has(d))).toBe("2026-11-10");
    expect(nextOpenDay("2026-11-07", () => false)).toBeNull();
  });
});

describe("default hours", () => {
  test("last hours kept inside opening hours", () => {
    expect(defaultHours({ from: "12:00:00", until: "15:00:00" }, { opens: "11:00:00", closes: "21:00:00" })).toEqual({ from: "12:00", until: "15:00" });
    expect(defaultHours({ from: "05:00:00", until: "23:59:00" }, { opens: "11:00:00", closes: "21:00:00" })).toEqual({ from: "11:00", until: "21:00" });
    expect(defaultHours(null, { opens: "11:00:00", closes: "21:00:00" })).toEqual({ from: "11:00", until: "21:00" });
    expect(defaultHours(null, { opens: "11:00:00", closes: "24:00:00" })).toEqual({ from: "11:00", until: "23:59" });
    expect(defaultHours(null, null)).toEqual({ from: "11:00", until: "20:00" });
  });
  test("outside hours", () => {
    expect(outsideHours("19:00", "22:00", { opens: "11:00:00", closes: "21:00:00" })).toBe(true);
    expect(outsideHours("12:00", "15:00", { opens: "11:00:00", closes: "21:00:00" })).toBe(false);
  });
});

describe("messages", () => {
  test("clash", () => {
    expect(clashMessage("Pilau", "2026-11-04", "day", "week")).toBe("Pilau is already on Wednesday’s menu.");
    expect(clashMessage("Pilau", "2026-11-04", "week", "day")).toBe("Pilau is already on Wednesday as a day dish. Untick Wednesday, or remove it there first.");
    expect(clashMessage("Pilau", "2026-11-04", "week", "week")).toBe("Pilau is already on Wednesday’s menu.");
  });
  test("field checks", () => {
    expect(checkFields({ from: "12:00", until: "12:00", plates: "", price: "" })).toEqual({ hours: "Serving must end after it starts." });
    expect(checkFields({ from: "12:00", until: "15:00", plates: "1001", price: "100001" })).toEqual({
      plates: "Plates a day can be 1 to 1,000. Leave it empty for no limit.",
      price: "Price is in whole shillings, up to 100,000.",
    });
    expect(checkFields({ from: "12:00", until: "15:00", plates: "0", price: "6.5" }).plates).toBeDefined();
    expect(checkFields({ from: "12:00", until: "15:00", plates: "1000", price: "100000" })).toEqual({});
  });
});

describe("copyPriceLine (RQA25-02, follow-ups item 6)", () => {
  const d = (...xs: [string, number][]) => xs.map(([name, price]) => ({ name, price }));
  test("no one-day prices: no line", () => expect(copyPriceLine({ kept: true, dishes: [] }, "Monday")).toBeNull());
  test("kept, by count, with the button's name in the possessive", () => {
    expect(copyPriceLine({ kept: true, dishes: d(["Pilau", 600]) }, "Monday")).toBe("Pilau keeps Monday\u2019s price, KSh\u00A0600.");
    expect(copyPriceLine({ kept: true, dishes: d(["Pilau", 600]) }, "last Tuesday")).toBe("Pilau keeps last Tuesday\u2019s price, KSh\u00A0600.");
    expect(copyPriceLine({ kept: true, dishes: d(["Pilau", 600], ["Chapati", 80]) }, "Monday")).toBe("Pilau and Chapati keep Monday\u2019s prices.");
    expect(copyPriceLine({ kept: true, dishes: d(["Pilau", 600], ["Chapati", 80], ["Beef stew", 700]) }, "Monday")).toBe("Pilau, Chapati and Beef stew keep Monday\u2019s prices.");
    expect(copyPriceLine({ kept: true, dishes: d(["Pilau", 1], ["Chapati", 1], ["A", 1], ["B", 1], ["C", 1]) }, "Monday")).toBe("Pilau, Chapati and 3 more dishes keep Monday\u2019s prices.");
  });
  test("usual prices, and never \"1 more\"", () => {
    expect(copyPriceLine({ kept: false, dishes: d(["Pilau", 650]) }, "Monday")).toBe("Pilau is at its usual price, KSh\u00A0650.");
    expect(copyPriceLine({ kept: false, dishes: d(["Pilau", 650], ["Chapati", 100]) }, "Monday")).toBe("Pilau and Chapati are at their usual prices.");
    expect(copyPriceLine({ kept: false, dishes: d(["Pilau", 1], ["Chapati", 1], ["Beef stew", 1]) }, "Monday")).toBe("Pilau, Chapati and Beef stew are at their usual prices.");
    expect(copyPriceLine({ kept: false, dishes: d(["Pilau", 1], ["Chapati", 1], ["A", 1], ["B", 1]) }, "Monday")).toBe("Pilau, Chapati and 2 more dishes are at their usual prices.");
  });
});

describe("closedLine (follow-ups item 2)", () => {
  test("day mode keeps the spec's line", () => expect(closedLine("day", ["2026-11-12"])).toBe("Customers won\u2019t see these while it\u2019s closed."));
  test("week mode names the closed day, and goes plural for two or more", () => {
    expect(closedLine("week", ["2026-11-12"])).toBe("Closed on Thursday. Customers won\u2019t see it while it\u2019s closed.");
    expect(closedLine("week", ["2026-11-12", "2026-11-14"])).toBe("Closed on Thursday and Saturday. Customers won\u2019t see it on those days.");
    expect(closedLine("week", ["2026-11-11", "2026-11-12", "2026-11-14"])).toBe("Closed on Wednesday, Thursday and Saturday. Customers won\u2019t see it on those days.");
  });
});
