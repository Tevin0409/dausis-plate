// CSV and zip files for the Reports downloads (spec-2.12 "CSV"). No dependencies.

export type Cell = string | number | null | undefined;

const FORMULA = /^[=+\-@\t\r]/;

/**
 * One text field: quoted, with a leading ' when a spreadsheet could run it as a formula. Spreadsheets
 * skip leading spaces and tabs before a formula, so the check runs on the text after them too.
 */
export function textCell(v: string): string {
  const safe = FORMULA.test(v) || FORMULA.test(v.replace(/^\s+/, "")) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Numbers are plain (whole shillings, a leading minus for money out); text is quoted and guarded. */
export function cell(v: Cell): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return textCell(v);
}

/** A CSV file as text: UTF-8 BOM first so Excel reads "Kamau’s" and emoji, CRLF line ends. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const lines = [header.map(textCell).join(","), ...rows.map((r) => r.map(cell).join(","))];
  return `﻿${lines.join("\r\n")}\r\n`;
}

// ───────── zip (store only; the files are small text) ─────────
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip with each file stored uncompressed. Opens in Excel, Finder and every unzip tool. */
export function zip(files: { name: string; content: string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // 1 Jan 2026, 00:00 in DOS time: a fixed stamp keeps the file the same for the same data.
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.content);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);

    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true);
    c.setUint16(10, 0, true);
    c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** `dausis-plate-<section>-2026-11-01-to-2026-11-07.csv`, or `…-2026-11-07.csv` for one day. */
export function fileName(section: string, from: string, to: string, ext: "csv" | "zip" = "csv"): string {
  return `dausis-plate-${section}-${from === to ? from : `${from}-to-${to}`}.${ext}`;
}
