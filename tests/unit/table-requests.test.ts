import { describe, expect, test } from "bun:test";
import { askRefusal, buttonState, COULDNT_SEND, requestAge } from "@/lib/table-requests";

const at = "2026-11-14T09:52:00Z"; // 12:52 Nairobi
const t0 = Date.parse(at);

describe("requestAge (spec-2.9 Age)", () => {
  test.each([
    [0, "just now", false],
    [59_000, "just now", false],
    [60_000, "1 min", false],
    [4 * 60_000 + 59_000, "4 min", false],
    [5 * 60_000, "5 min", true],
    [65 * 60_000, "1 h 5 min", true],
    [180 * 60_000, "3 h 0 min", true],
  ])("%p ms reads %p", (ms, text, amber) => {
    expect(requestAge(at, t0 + ms)).toEqual({ text, amber });
  });
  test("a tablet clock behind the server never shows a negative age", () => {
    expect(requestAge(at, t0 - 30_000).text).toBe("just now");
  });
});

describe("buttonState (spec-2.9 Customer: order status page)", () => {
  test("ready", () => {
    expect(buttonState("waiter", null)).toEqual({ open: false, label: "Call waiter", line: "" });
    expect(buttonState("bill", null)).toEqual({ open: false, label: "Request bill", line: "" });
  });
  test("sent by this order", () => {
    const r = { asked_at: at, answered_at: null, by_this_order: true };
    expect(buttonState("waiter", r)).toEqual({ open: true, label: "Waiter called", line: "Sent 12:52. Staff have been told." });
    expect(buttonState("bill", r)).toEqual({ open: true, label: "Bill asked for", line: "Sent 12:52. Staff will bring it." });
  });
  test("asked by another phone at the table", () => {
    const r = { asked_at: at, answered_at: null, by_this_order: false };
    expect(buttonState("waiter", r).line).toBe("Someone at your table asked at 12:52.");
  });
  test("answered: a waiter can be called again, a bill just says when", () => {
    const r = { asked_at: at, answered_at: "2026-11-14T09:54:00Z", by_this_order: true };
    expect(buttonState("waiter", r)).toEqual({ open: false, label: "Call waiter", line: "Answered 12:54. Tap to call again." });
    expect(buttonState("bill", r)).toEqual({ open: false, label: "Request bill", line: "Answered 12:54." });
  });
});

describe("askRefusal", () => {
  test("known code words get their line; stale-page ones ask for a refresh", () => {
    expect(askRefusal("request_limit")).toEqual({ ok: false, line: "You’ve asked a lot today. Please wave to a waiter.", refresh: false });
    expect(askRefusal("request_cancelled")).toMatchObject({ ok: false, refresh: true });
  });
  test("anything else is Couldn't send", () => {
    expect(askRefusal("boom")).toEqual({ ok: false, line: COULDNT_SEND });
    expect(askRefusal(undefined)).toEqual({ ok: false, line: COULDNT_SEND });
  });
});
