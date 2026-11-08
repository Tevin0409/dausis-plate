// Slice 2.6: pure helpers (spec-2.6-owner-screens.md).
import { describe, expect, test } from "bun:test";
import { KITCHEN_PHONE_ERROR, formatKenyanPhone, normaliseKitchenPhone } from "@/lib/kitchen-phone";
import { cartLineKey, extrasLine, readStoredLine, unitPriceWithExtras } from "@/lib/cart-lines";
import { safeNext } from "@/lib/safe-next";
import { TEMP_WORDS, isTempPassword, makeTempPassword } from "@/lib/temp-password";
import { addsLine, nextTableLabels, readKes, zoneLine, zoneProblem, ZONE_MESSAGES } from "@/lib/tables";
import { foodSubtotal, minimumBlockLine, minimumShortfall, zoneOptionLabel } from "@/lib/zone-minimum";

describe("kitchen phone (Settings: phone)", () => {
  test.each([
    ["0712 345 678", "+254712345678"],
    ["0712-345-678", "+254712345678"],
    ["(0712) 345.678", "+254712345678"],
    ["0110 123 456", "+254110123456"],
    ["020 123 4567", "+254201234567"],
    ["041 222 3333", "+254412223333"],
    ["057 202 0000", "+254572020000"],
    ["254712345678", "+254712345678"],
    ["+254 712 345 678", "+254712345678"],
    ["+254 20 123 4567", "+254201234567"],
  ])("accepts %p", (input, out) => expect(normaliseKitchenPhone(input)).toBe(out));

  test.each([
    ["0800 123 456"], // toll-free
    ["0900 123 456"], // premium
    ["+254800123456"],
    ["712345678"], // no 0 or 254
    ["0712 345 67"], // 8 digits
    ["0712 345 6789"], // 10 digits
    ["+255712345678"], // Tanzania
    ["0012345678"],
    ["call me"],
  ])("refuses %p", (input) => expect(normaliseKitchenPhone(input)).toBeNull());

  test("empty means no phone", () => {
    expect(normaliseKitchenPhone("")).toBe("");
    expect(normaliseKitchenPhone("   ")).toBe("");
  });

  test("every accepted number matches the database check", () => {
    for (const n of ["0712345678", "0110123456", "0201234567", "0612345678"]) {
      expect(normaliseKitchenPhone(n)!).toMatch(/^\+254[1-7][0-9]{8}$/);
    }
  });

  test("display: mobiles 4-3-3, landlines area code then 3 and 4", () => {
    expect(formatKenyanPhone("+254712345678")).toBe("0712 345 678");
    expect(formatKenyanPhone("+254110123456")).toBe("0110 123 456");
    expect(formatKenyanPhone("+254201234567")).toBe("020 123 4567");
    expect(formatKenyanPhone("+254412223333")).toBe("041 222 3333");
    expect(formatKenyanPhone("not stored right")).toBe("not stored right");
  });

  test("error line", () => {
    expect(KITCHEN_PHONE_ERROR).toBe("Enter a Kenyan number, like 0712 345 678 or 020 123 4567.");
  });
});

describe("cart lines with extras (Customer side of options)", () => {
  const base = { dishId: "d1", menuEntryId: null, optionId: "o1", note: "" };
  test("extras are part of the key, in any order", () => {
    const a = cartLineKey({ ...base, extras: [{ id: "x2" }, { id: "x1" }] });
    const b = cartLineKey({ ...base, extras: [{ id: "x1" }, { id: "x2" }] });
    expect(a).toBe(b);
    expect(a).not.toBe(cartLineKey({ ...base, extras: [{ id: "x1" }] }));
  });
  test("a line without extras keeps the key it had before 2.6", () => {
    expect(cartLineKey({ ...base, extras: [] })).toBe("d1|-|o1|");
  });
  test("a cart saved before the release loads with no extras", () => {
    const old = { key: "d1|-|o1|", dishId: "d1", menuEntryId: null, optionId: "o1", name: "Fish curry", optionLabel: "Chapati", unitPriceKes: 650, quantity: 2, note: "", rotating: false };
    expect(readStoredLine(old)).toEqual({ ...old, extras: [] });
  });
  test("bad stored extras are dropped, not trusted", () => {
    const line = { key: "k", dishId: "d1", quantity: 1, extras: [{ id: "x1", label: "Avocado", priceKes: 50 }, { id: 3 }, "junk"] };
    expect(readStoredLine(line)?.extras).toEqual([{ id: "x1", label: "Avocado", priceKes: 50 }]);
    expect(readStoredLine({ key: "k", dishId: "d1", quantity: 1, extras: "nope" })?.extras).toEqual([]);
    expect(readStoredLine({ dishId: "d1" })).toBeNull();
  });
  test("display price includes ticked extras", () => {
    expect(unitPriceWithExtras(650, [{ priceKes: 50 }, { priceKes: 30 }])).toBe(730);
    expect(unitPriceWithExtras(650, [])).toBe(650);
  });
  test("cart line wording", () => {
    expect(extrasLine("Chapati", [{ label: "Avocado" }, { label: "Extra egg" }])).toBe("With chapati · + Avocado, + Extra egg");
    expect(extrasLine("Chapati", [])).toBe("With chapati");
    expect(extrasLine(null, [{ label: "Avocado" }])).toBe("+ Avocado");
    expect(extrasLine(null, [])).toBeNull();
    expect(extrasLine("BBQ sauce", [])).toBe("With BBQ sauce");
  });
});

describe("safe next (/auth/callback)", () => {
  test.each([
    ["/account/set-password", "/account/set-password"],
    ["/dashboard/team?x=1", "/dashboard/team?x=1"],
    [null, "/dashboard"],
    ["", "/dashboard"],
    ["https://evil.example", "/dashboard"],
    ["//evil.example", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["/%2F%2Fevil.example", "/%2F%2Fevil.example"],
    ["dashboard", "/dashboard"],
    ["/\tevil", "/dashboard"],
  ])("%p → %p", (input, out) => expect(safeNext(input)).toBe(out));
});

describe("temporary password (Reset password)", () => {
  test("readable word-4digits, at least 8 characters", () => {
    for (let i = 0; i < 200; i++) {
      const p = makeTempPassword();
      expect(p).toMatch(/^[a-z]+-\d{4}$/);
      expect(p.length).toBeGreaterThanOrEqual(8);
      expect(TEMP_WORDS as readonly string[]).toContain(p.split("-")[0]!);
      expect(isTempPassword(p)).toBe(true);
    }
  });
  test("varies", () => {
    expect(new Set(Array.from({ length: 50 }, makeTempPassword)).size).toBeGreaterThan(40);
  });
  test("a typed temporary password needs 8 characters", () => {
    expect(isTempPassword("short")).toBe(false);
    expect(isTempPassword("longenough")).toBe(true);
  });
});

describe("delivery minimum (Q1 A, food only)", () => {
  const zone = { name: "Kilimani", feeKes: 150, minOrderKes: 800 };
  test("food subtotal counts choices and extras, not the fee", () => {
    expect(foodSubtotal([{ unitPriceKes: 730, quantity: 1 }, { unitPriceKes: 100, quantity: 2 }])).toBe(930);
  });
  test("shortfall", () => {
    expect(minimumShortfall(550, zone)).toBe(250);
    expect(minimumShortfall(800, zone)).toBe(0);
    expect(minimumShortfall(100, { ...zone, minOrderKes: 0 })).toBe(0);
  });
  test("checkout line and zone label", () => {
    expect(minimumBlockLine(250, "Kilimani")).toBe("Add KSh 250 more for delivery to Kilimani, or choose pickup.");
    expect(zoneOptionLabel(zone)).toBe("Kilimani · KSh 150 delivery · KSh 800 minimum");
    expect(zoneOptionLabel({ ...zone, minOrderKes: 0 })).toBe("Kilimani · KSh 150 delivery");
    expect(zoneOptionLabel({ ...zone, feeKes: 0, minOrderKes: 0 })).toBe("Kilimani · Free delivery");
  });
});

describe("tables and zones (Tables & delivery)", () => {
  test("numbers after the highest Table N, skipping taken ones", () => {
    expect(nextTableLabels(["Table 1", "Table 12", "Bar", "table 14"], 3)).toEqual(["Table 15", "Table 16", "Table 17"]);
    expect(nextTableLabels([], 2)).toEqual(["Table 1", "Table 2"]);
  });
  test("adds line", () => {
    expect(addsLine(["Table 12"], 3)).toBe("Adds Table 13 to Table 15");
    expect(addsLine(["Table 12"], 1)).toBe("Adds Table 13");
  });
  test("reads KSh as typed", () => {
    expect(readKes("")).toBeNull();
    expect(readKes(" 1,800 ")).toBe(1800);
    expect(readKes("15.5")).toBeNaN();
    expect(readKes("-5")).toBeNaN();
  });
  test("zone limits and wording", () => {
    const ok = { name: "Kilimani", fee: 150, minimum: null, active: true };
    expect(zoneProblem(ok)).toBeNull();
    expect(zoneProblem({ ...ok, name: "  " })?.field).toBe("name");
    expect(zoneProblem({ ...ok, fee: 5001 })?.message).toBe(ZONE_MESSAGES.fee);
    expect(zoneProblem({ ...ok, fee: null })?.field).toBe("fee");
    expect(zoneProblem({ ...ok, minimum: 20001 })?.message).toBe(ZONE_MESSAGES.minimum);
    expect(zoneProblem({ ...ok, minimum: Number.NaN })?.field).toBe("minimum");
    expect(zoneProblem({ ...ok, fee: 5000, minimum: 20000 })).toBeNull();
    expect(zoneLine(150, 800).replace(/\u00a0/g, " ")).toBe("KSh 150 delivery · KSh 800 minimum");
    expect(zoneLine(0, 0)).toBe("Free delivery · No minimum");
  });
});
