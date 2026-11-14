import { describe, expect, test } from "bun:test";
import { crc32, fileName, toCsv, zip } from "@/lib/reports/csv";

describe("toCsv", () => {
  test("starts with a BOM, quotes text, leaves numbers bare, ends each row with CRLF", () => {
    const out = toCsv(["Code", "Total"], [["DP-0001", 1200], ["DP-0002", -520]]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out.slice(1)).toBe('"Code","Total"\r\n"DP-0001",1200\r\n"DP-0002",-520\r\n');
  });
  test("a field that starts with = + - @ gets a ' so it can't run as a formula", () => {
    const out = toCsv(["Name"], [["=HYPERLINK(\"x\")"], ["+254700"], ["-1"], ["@sum"], ["Kamau’s 🍛"]]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain(`"'+254700"`);
    expect(out).toContain(`"'-1"`);
    expect(out).toContain(`"'@sum"`);
    expect(out).toContain('"Kamau’s 🍛"');
  });
  test("spaces or tabs before = + - @ don't get past the guard (RQA212-02)", () => {
    const out = toCsv(["Name"], [[" =1+2"], ["\t=cmd|' /C calc'!A0"], ["  +254700"], [" \t@sum"], ["\n-1"], ["  plain"]]);
    expect(out).toContain(`"' =1+2"`);
    expect(out).toContain(`"'\t=cmd|' /C calc'!A0"`);
    expect(out).toContain(`"'  +254700"`);
    expect(out).toContain(`"' \t@sum"`);
    expect(out).toContain(`"'\n-1"`);
    expect(out).toContain(`"  plain"`);
  });
  test("quotes inside text are doubled; blanks stay blank", () => {
    expect(toCsv(["a", "b", "c"], [['say "hi"', null, undefined]])).toContain('"say ""hi""",,');
  });
});

describe("zip", () => {
  test("crc32 of 'hello' is the known value", () => {
    expect(crc32(new TextEncoder().encode("hello")).toString(16)).toBe("3610a686");
  });
  test("has the zip signatures, both files and the right count", () => {
    const z = zip([{ name: "a.csv", content: "x" }, { name: "b.csv", content: "yy" }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    expect(dv.getUint32(z.length - 22, true)).toBe(0x06054b50);
    expect(dv.getUint16(z.length - 22 + 10, true)).toBe(2);
    expect(new TextDecoder().decode(z)).toContain("a.csv");
  });
  test("unzips with the system tool", async () => {
    const dir = `${process.env.TMPDIR ?? "/tmp"}/zip-test-${Date.now()}`;
    await Bun.write(`${dir}/t.zip`, zip([{ name: "a.csv", content: "﻿hello" }, { name: "b.csv", content: "world" }]));
    const p = Bun.spawnSync(["unzip", "-o", "-q", `${dir}/t.zip`, "-d", `${dir}/out`]);
    expect(p.exitCode).toBe(0);
    expect(await Bun.file(`${dir}/out/b.csv`).text()).toBe("world");
    expect([...new Uint8Array(await Bun.file(`${dir}/out/a.csv`).arrayBuffer())].slice(0, 3)).toEqual([0xef, 0xbb, 0xbf]);
  });
});

describe("fileName", () => {
  test("range and single day", () => {
    expect(fileName("orders", "2026-11-01", "2026-11-07")).toBe("dausis-plate-orders-2026-11-01-to-2026-11-07.csv");
    expect(fileName("dishes", "2026-11-07", "2026-11-07", "zip")).toBe("dausis-plate-dishes-2026-11-07.zip");
  });
});
