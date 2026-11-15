// Slice 2.8: customer menu wording (spec-2.8-menu-on-a-computer.md).
import { describe, expect, test } from "bun:test";
import {
  addLabel, addedAnnounce, buyButton, buyHint, cantAddReason, capNote, loweredAnnounce,
  loweredNote, notOnMenuNote, notOnMenuPill, plates, platesPill, soldOutAnnounce, soldOutNote,
} from "@/lib/menu-words";

const nb = (s: string) => s.replace(/ /g, " ");
const pill = (o: Partial<Parameters<typeof platesPill>[0]>) =>
  platesPill({ open: true, limit: 30, left: 18, soldOut: false, day: "Friday", ...o });

describe("plates", () => {
  test("singular and plural", () => {
    expect(plates(1)).toBe("1 plate");
    expect(plates(7)).toBe("7 plates");
    expect(plates(0)).toBe("0 plates");
  });
});

describe("platesPill", () => {
  test("over 10 is teal", () => expect(pill({ left: 18 })).toEqual({ text: "18 plates left", tone: "teal" }));
  test("10 is amber", () => expect(pill({ left: 10 })).toEqual({ text: "10 plates left", tone: "amber" }));
  test("2 is amber", () => expect(pill({ left: 2 })?.tone).toBe("amber"));
  test("1 is Last plate", () => expect(pill({ left: 1 })).toEqual({ text: "Last plate", tone: "amber" }));
  test("sold out", () => expect(pill({ soldOut: true })).toEqual({ text: "Sold out today", tone: "sand" }));
  test("sold out with no limit still shows", () =>
    expect(pill({ soldOut: true, limit: null })?.text).toBe("Sold out today"));
  test("no limit, no pill", () => expect(pill({ limit: null, left: null })).toBeNull());
  test("closed shows the fresh count", () =>
    expect(pill({ open: false, left: 2 })).toEqual({ text: "30 plates for Friday", tone: "teal" }));
  test("closed singular", () => expect(pill({ open: false, limit: 1 })?.text).toBe("1 plate for Friday"));
});

describe("notes", () => {
  test("cap notes", () => {
    expect(capNote({ open: true, cap: 7, day: "Friday" })).toBe("That’s all 7 plates left.");
    expect(capNote({ open: true, cap: 1, day: "Friday" })).toBe("That’s the only plate left.");
    expect(capNote({ open: false, cap: 30, day: "Friday" })).toBe("That’s all 30 plates for Friday.");
  });
  test("recheck notes", () => {
    expect(loweredNote(1)).toBe("Only 1 plate left, so we changed this to 1.");
    expect(loweredNote(3)).toBe("Only 3 plates left, so we changed this to 3.");
    expect(soldOutNote).toBe("Sold out, so it’s not in your total.");
    expect(notOnMenuPill("Friday")).toBe("Not on Friday’s menu");
    expect(notOnMenuNote).toBe("Not in your total. Keep it for another day, or remove it.");
  });
  test("announcements", () => {
    expect(soldOutAnnounce("Fish Curry")).toBe("Fish Curry has sold out.");
    expect(loweredAnnounce("Fish Curry", 1)).toBe("Fish Curry: only 1 plate left, changed to 1.");
    expect(nb(addedAnnounce("Fish Curry", 3, 1950))).toBe("Fish Curry added. 3 plates, KSh 1,950.");
  });
});

describe("addLabel", () => {
  const base = { name: "Pilau", open: true, hasOptions: false, allInOrder: false, left: 7 };
  test("open", () => expect(addLabel(base)).toEqual({ label: "Add Pilau to your order", disabled: false }));
  test("closed", () => expect(addLabel({ ...base, open: false }).label).toBe("Add Pilau to your saved order"));
  test("options", () => expect(addLabel({ ...base, hasOptions: true }).label).toBe("Choose options for Pilau"));
  test("all in order", () =>
    expect(addLabel({ ...base, allInOrder: true })).toEqual({
      label: "All 7 plates of Pilau are in your order", disabled: true, title: "That’s every plate left",
    }));
  test("last in order", () =>
    expect(addLabel({ ...base, allInOrder: true, left: 1 }).label).toBe("The last plate of Pilau is in your order"));
});

describe("dish page", () => {
  const h = { open: true, limit: 30, left: 7, inOrder: 0, day: "Friday" };
  test("hints", () => {
    expect(buyHint(h)).toBe("7 plates left today.");
    expect(buyHint({ ...h, left: 1 })).toBe("The last plate today.");
    expect(buyHint({ ...h, open: false })).toBe("30 plates for Friday.");
    expect(buyHint({ ...h, inOrder: 2 })).toBe("7 plates left today. 2 already in your order.");
    expect(buyHint({ ...h, limit: null, left: null })).toBeNull();
    expect(buyHint({ ...h, limit: null, left: null, inOrder: 2 })).toBe("2 already in your order.");
  });
  const r = { open: true, soldOut: false, onMenuDay: true, hoursText: null, allInOrder: false, left: 7, day: "Friday" };
  test("reason priority", () => {
    expect(cantAddReason(r)).toBeNull();
    expect(cantAddReason({ ...r, soldOut: true, hoursText: "From 12:00", allInOrder: true })).toBe("Sold out today");
    expect(cantAddReason({ ...r, open: false, onMenuDay: false, hoursText: "x" })).toBe("Not on Friday’s menu");
    expect(cantAddReason({ ...r, hoursText: "Served from 12:00", allInOrder: true })).toBe("Served from 12:00");
    expect(cantAddReason({ ...r, allInOrder: true })).toBe("All 7 plates are in your order");
    expect(cantAddReason({ ...r, allInOrder: true, left: 1 })).toBe("The last plate is in your order");
  });
  test("button", () => {
    expect(nb(buyButton(true, 650))).toBe("Add to order · KSh 650");
    expect(nb(buyButton(false, 650))).toBe("Save to order · KSh 650");
  });
});
