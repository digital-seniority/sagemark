/**
 * Slice 4 — store-only ZIP writer (node).
 *
 * Asserts the hand-rolled archive is structurally a valid ZIP: the local-file-header
 * magic, the end-of-central-directory signature, the recorded entry count, and that
 * the entry names + contents survive into the byte stream. (A round-trip unzip would
 * need a dependency; these structural checks prove the format without one.)
 */

import { describe, it, expect } from "vitest";

import { buildZip } from "@/lib/export/zip";

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

function indexOfSeq(hay: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

describe("buildZip — store-only archive", () => {
  it("emits a structurally valid zip with the entries and contents", async () => {
    const blob = buildZip([
      { name: "article.html", data: "<!DOCTYPE html><title>x</title>" },
      { name: "meta.json", data: '{"slug":"hello"}' },
    ]);
    expect(blob.type).toBe("application/zip");

    const b = await bytesOf(blob);
    // Local file header magic PK\x03\x04 at the very start.
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    // End-of-central-directory signature PK\x05\x06 present near the end.
    expect(indexOfSeq(b, [0x50, 0x4b, 0x05, 0x06])).toBeGreaterThan(0);

    // The EOCD records 2 total entries (offset 10 in the 22-byte EOCD record).
    const eocd = indexOfSeq(b, [0x50, 0x4b, 0x05, 0x06]);
    const totalEntries = b[eocd + 10]! | (b[eocd + 11]! << 8);
    expect(totalEntries).toBe(2);

    // The filenames + the JSON content survive into the stream.
    const text = new TextDecoder().decode(b);
    expect(text).toContain("article.html");
    expect(text).toContain("meta.json");
    expect(text).toContain('{"slug":"hello"}');
  });

  it("handles an empty archive", async () => {
    const b = await bytesOf(buildZip([]));
    // Just the 22-byte EOCD record.
    expect(b.length).toBe(22);
    expect([b[0], b[1], b[2], b[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });
});
