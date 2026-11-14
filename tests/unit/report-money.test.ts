import { describe, expect, test } from "bun:test";
import { creditAmountError, creditNoteAmount, creditReasonError, defaultCreditReason, drawerLine, kesSigned, netOf, plainSigned, type MoneyRow } from "@/lib/reports/money";

const row = (o: Partial<MoneyRow>): MoneyRow => ({
  bucket: "2026-11-07", cash: 0, mpesa: 0, mpesa_online: 0, card: 0, not_recorded: 0, cash_n: 0, mpesa_n: 0, credit_notes: 0, cn_cash: 0, cn_mpesa: 0,
  credit_notes_voided: 0, cnv_cash: 0, cnv_mpesa: 0, net: 0, legacy_n: 0, ...o,
});

describe("net money in", () => {
  test("payments − credit notes + voided notes (the spec's example)", () => {
    expect(netOf(row({ cash: 3300, mpesa: 12100, credit_notes: 520 }))).toBe(14880);
    expect(netOf(row({ cash: 3300, mpesa: 12100, credit_notes: 0, credit_notes_voided: 520 }))).toBe(15920);
  });
  test("can be below zero, shown as −KSh 520", () => {
    expect(netOf(row({ credit_notes: 520 }))).toBe(-520);
    expect(kesSigned(-520)).toBe("−KSh 520");
    expect(kesSigned(1200)).toBe("KSh 1,200");
  });
  test("table cells: −520 for a note, +520 for a void, blank for none", () => {
    expect(plainSigned(520, "-")).toBe("−520");
    expect(plainSigned(520, "+")).toBe("+520");
    expect(plainSigned(0, "-")).toBe("");
    expect(plainSigned(-1520)).toBe("−1,520");
  });
});

describe("the drawer line", () => {
  const nb = (s: string) => s.replace(/ /g, " ");
  test("plain day", () => {
    expect(nb(drawerLine(row({ cash: 3300, cash_n: 12, mpesa: 12100, mpesa_n: 30 })))).toBe("Cash taken today: KSh 3,300 from 12 orders. M-Pesa: KSh 12,100 from 30.");
  });
  test("a cash refund comes off the cash figure", () => {
    expect(nb(drawerLine(row({ cash: 3300, cash_n: 12, cn_cash: 520, mpesa: 12100, mpesa_n: 30 })))).toBe(
      "Cash taken today: KSh 3,300 from 12 orders, less KSh 520 refunded in cash: KSh 2,780. M-Pesa: KSh 12,100 from 30.",
    );
  });
  test("a voided cash note adds back", () => {
    expect(nb(drawerLine(row({ cash: 2780, cash_n: 12, cnv_cash: 520, mpesa: 100, mpesa_n: 1 })))).toBe(
      "Cash taken today: KSh 2,780 from 12 orders, plus KSh 520 from a voided credit note: KSh 3,300. M-Pesa: KSh 100 from 1.",
    );
  });
  test("an M-Pesa refund comes off the M-Pesa figure", () => {
    expect(nb(drawerLine(row({ mpesa: 1000, mpesa_n: 2, cn_mpesa: 400 })))).toContain("M-Pesa: KSh 1,000 from 2, less KSh 400 refunded by M-Pesa: KSh 600.");
  });
  test("a day with nothing", () => {
    expect(nb(drawerLine(undefined))).toBe("Cash taken today: KSh 0 from 0 orders. M-Pesa: KSh 0 from 0.");
  });
});

describe("credit note forms", () => {
  test("the amount: at least KSh 1, never above what was paid", () => {
    expect(creditAmountError("0", 670)).toBe("Enter at least KSh 1.");
    expect(creditAmountError("", 670)).toBe("Enter at least KSh 1.");
    expect(creditAmountError("12.5", 670)).toBe("Enter at least KSh 1.");
    expect(creditAmountError("671", 670)?.replace(/ /g, " ")).toBe("The credit note can’t be more than was paid, KSh 670.");
    expect(creditAmountError("670", 670)).toBeNull();
    expect(creditAmountError("1", 670)).toBeNull();
  });
  test("the reason is 3 to 120 characters", () => {
    expect(creditReasonError("ab")).toBe("Write a reason of 3 to 120 characters.");
    expect(creditReasonError("  ab  ")).toBe("Write a reason of 3 to 120 characters.");
    expect(creditReasonError("abc")).toBeNull();
    expect(creditReasonError("x".repeat(121))).not.toBeNull();
  });
  test("prefilled reason follows the cancel reason", () => {
    expect(defaultCreditReason("no_show")).toBe("Refund: customer didn’t come");
    expect(defaultCreditReason("other")).toBe("Refund");
    expect(defaultCreditReason(null)).toBe("Refund");
  });
  test("lowered amounts say what was kept", () => {
    expect(creditNoteAmount(520, 670).replace(/ /g, " ")).toBe("KSh 520 of 670 · 150 kept");
    expect(creditNoteAmount(670, 670).replace(/ /g, " ")).toBe("KSh 670");
  });
});
