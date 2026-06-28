/**
 * zip — a tiny, dependency-free, STORE-ONLY ZIP writer (Slice 4 export bundle).
 *
 * The export handoff bundle is a few small text artifacts (HTML, markdown,
 * JSON-LD, meta.json) — no compression needed, so we emit a valid "stored"
 * (method 0) ZIP by hand rather than pulling a dependency into the client bundle.
 * The format is the standard PKZIP layout: per-entry [local header + data], then a
 * central directory, then the end-of-central-directory record. CRC-32 per entry.
 *
 * Pure + isomorphic: uses TextEncoder + Blob (present in the browser and in the
 * vitest/jsdom test env). No Node, no deps. Clean ASCII / UTF-8.
 */

/** Precomputed CRC-32 table (polynomial 0xEDB88320). */
const CRC_TABLE: number[] = (() => {
  const t: number[] = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  /** The entry path inside the archive (e.g. "article.html"). */
  name: string;
  /** The entry contents (UTF-8 string or raw bytes). */
  data: string | Uint8Array;
}

const enc = new TextEncoder();

function toBytes(d: string | Uint8Array): Uint8Array {
  return typeof d === "string" ? enc.encode(d) : d;
}

/**
 * Build a STORE-ONLY ZIP archive from the given entries and return it as a Blob
 * (`application/zip`). Filenames are stored UTF-8 (general-purpose bit 11 set).
 */
export function buildZip(entries: ZipEntry[]): Blob {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = toBytes(entry.data);
    const crc = crc32(data);
    const size = data.length;

    // Local file header (30 bytes) + name + data.
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); // signature
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // flags: bit 11 = UTF-8 names
    local.setUint16(8, 0, true); // method: 0 = store
    local.setUint16(10, 0, true); // mod time
    local.setUint16(12, 0, true); // mod date
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true); // compressed size
    local.setUint32(22, size, true); // uncompressed size
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true); // extra length
    const localHeader = new Uint8Array(local.buffer);
    chunks.push(localHeader, nameBytes, data);

    // Central directory record (46 bytes) + name.
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); // signature
    cd.setUint16(4, 20, true); // version made by
    cd.setUint16(6, 20, true); // version needed
    cd.setUint16(8, 0x0800, true); // flags
    cd.setUint16(10, 0, true); // method
    cd.setUint16(12, 0, true); // mod time
    cd.setUint16(14, 0, true); // mod date
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, nameBytes.length, true);
    cd.setUint16(30, 0, true); // extra length
    cd.setUint16(32, 0, true); // comment length
    cd.setUint16(34, 0, true); // disk number start
    cd.setUint16(36, 0, true); // internal attrs
    cd.setUint32(38, 0, true); // external attrs
    cd.setUint32(42, offset, true); // local header offset
    central.push(new Uint8Array(cd.buffer), nameBytes);

    offset += localHeader.length + nameBytes.length + data.length;
  }

  const centralStart = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  // End of central directory (22 bytes).
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true); // signature
  eocd.setUint16(4, 0, true); // disk number
  eocd.setUint16(6, 0, true); // disk with central dir
  eocd.setUint16(8, entries.length, true); // entries this disk
  eocd.setUint16(10, entries.length, true); // total entries
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, centralStart, true);
  eocd.setUint16(20, 0, true); // comment length

  // Concatenate every part into ONE fresh ArrayBuffer-backed array so the Blob
  // part is unambiguously `Uint8Array<ArrayBuffer>` (TextEncoder output is
  // `Uint8Array<ArrayBufferLike>`, which the Blob ctor type rejects directly).
  const parts = [...chunks, ...central, new Uint8Array(eocd.buffer)];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return new Blob([out], { type: "application/zip" });
}
