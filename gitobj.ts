import { createHash } from "node:crypto";
import { inflateSync, deflateSync } from "node:zlib";
import type { GitObject } from "./store.ts";

export type ObjType = "blob" | "tree" | "commit" | "tag";

export function objectTypeName(code: number): ObjType {
  switch (code) {
    case 1:
      return "commit";
    case 2:
      return "tree";
    case 3:
      return "blob";
    case 4:
      return "tag";
    default:
      throw new Error(`Unknown object type code: ${code}`);
  }
}

export function hashObject(type: ObjType, data: Uint8Array): string {
  const header = `${type} ${data.length}\0`;
  const headerBytes = new TextEncoder().encode(header);
  const full = new Uint8Array(headerBytes.length + data.length);
  full.set(headerBytes, 0);
  full.set(data, headerBytes.length);
  return createHash("sha1").update(full).digest("hex");
}

export function parseTree(data: Uint8Array):
  Array<{ mode: string; name: string; oid: string }> {
  const entries: Array<{ mode: string; name: string; oid: string }> = [];
  let offset = 0;
  while (offset < data.length) {
    const spaceIdx = data.indexOf(32, offset);
    if (spaceIdx === -1) break;
    const mode = new TextDecoder().decode(data.subarray(offset, spaceIdx));

    const nullIdx = data.indexOf(0, spaceIdx);
    if (nullIdx === -1) break;
    const name = new TextDecoder().decode(data.subarray(spaceIdx + 1, nullIdx));

    if (nullIdx + 20 > data.length) break;
    const oidBytes = data.subarray(nullIdx + 1, nullIdx + 21);
    const oid = Buffer.from(oidBytes).toString("hex");

    entries.push({ mode, name, oid });
    offset = nullIdx + 21;
  }
  return entries;
}

export function buildTree(
  entries: Array<{ mode: string; name: string; oid: string }>
): Uint8Array {
  const sorted = [...entries].sort((a, b) => {
    const aName = a.mode === "40000" ? a.name + "/" : a.name;
    const bName = b.mode === "40000" ? b.name + "/" : b.name;
    const aBuf = new TextEncoder().encode(aName);
    const bBuf = new TextEncoder().encode(bName);
    const len = Math.min(aBuf.length, bBuf.length);
    for (let i = 0; i < len; i++) {
      if (aBuf[i] !== bBuf[i]) {
        return aBuf[i] - bBuf[i];
      }
    }
    return aBuf.length - bBuf.length;
  });

  const parts: Uint8Array[] = [];
  let totalLen = 0;
  for (const entry of sorted) {
    const header = `${entry.mode} ${entry.name}\0`;
    const headerBytes = new TextEncoder().encode(header);
    const oidBytes = Buffer.from(entry.oid, "hex");
    const part = new Uint8Array(headerBytes.length + oidBytes.length);
    part.set(headerBytes, 0);
    part.set(oidBytes, headerBytes.length);
    parts.push(part);
    totalLen += part.length;
  }

  const result = new Uint8Array(totalLen);
  let pos = 0;
  for (const part of parts) {
    result.set(part, pos);
    pos += part.length;
  }
  return result;
}

export function parseCommit(data: Uint8Array): {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
} {
  const text = new TextDecoder().decode(data);
  const blankIdx = text.indexOf("\n\n");
  const headerPart = blankIdx === -1 ? text : text.slice(0, blankIdx);
  const message = blankIdx === -1 ? "" : text.slice(blankIdx + 2);

  let tree = "";
  const parents: string[] = [];
  let author = "";
  let committer = "";

  const lines = headerPart.split("\n");
  for (const line of lines) {
    if (line.startsWith("tree ")) {
      tree = line.slice(5);
    } else if (line.startsWith("parent ")) {
      parents.push(line.slice(7));
    } else if (line.startsWith("author ")) {
      author = line.slice(7);
    } else if (line.startsWith("committer ")) {
      committer = line.slice(10);
    }
  }

  return { tree, parents, author, committer, message };
}

export function buildCommit(f: {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
}): Uint8Array {
  let str = `tree ${f.tree}\n`;
  for (const p of f.parents) {
    str += `parent ${p}\n`;
  }
  str += `author ${f.author}\n`;
  str += `committer ${f.committer}\n\n`;
  str += f.message;
  return new TextEncoder().encode(str);
}

export function parseTag(data: Uint8Array): {
  object: string;
  type: ObjType;
  tag: string;
  tagger: string;
  message: string;
} {
  const text = new TextDecoder().decode(data);
  const blankIdx = text.indexOf("\n\n");
  const headerPart = blankIdx === -1 ? text : text.slice(0, blankIdx);
  const message = blankIdx === -1 ? "" : text.slice(blankIdx + 2);

  let object = "";
  let type: ObjType = "blob";
  let tag = "";
  let tagger = "";

  for (const line of headerPart.split("\n")) {
    if (line.startsWith("object ")) {
      object = line.slice(7);
    } else if (line.startsWith("type ")) {
      type = line.slice(5) as ObjType;
    } else if (line.startsWith("tag ")) {
      tag = line.slice(4);
    } else if (line.startsWith("tagger ")) {
      tagger = line.slice(7);
    }
  }

  return { object, type, tag, tagger, message };
}

export function buildTag(f: {
  object: string;
  type: ObjType;
  tag: string;
  tagger: string;
  message: string;
}): Uint8Array {
  let str = `object ${f.object}\n`;
  str += `type ${f.type}\n`;
  str += `tag ${f.tag}\n`;
  str += `tagger ${f.tagger}\n\n`;
  str += f.message;
  return new TextEncoder().encode(str);
}

export function applyDelta(base: Uint8Array, delta: Uint8Array): Uint8Array {
  let pos = 0;

  function readVarint(): number {
    let shift = 0;
    let val = 0;
    while (pos < delta.length) {
      const b = delta[pos++];
      val |= (b & 0x7f) << shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return val;
  }

  const sourceSize = readVarint();
  if (sourceSize !== base.length) {
    // Some git deltas might mismatch if base is truncated, but we strictly follow spec or allow it.
    // Spec check: source size should match base length.
  }
  const targetSize = readVarint();
  const target = new Uint8Array(targetSize);
  let targetPos = 0;

  while (pos < delta.length) {
    const cmd = delta[pos++];
    if (cmd & 0x80) {
      // Copy instruction
      let offset = 0;
      let size = 0;
      if (cmd & 0x01) offset |= delta[pos++];
      if (cmd & 0x02) offset |= delta[pos++] << 8;
      if (cmd & 0x04) offset |= delta[pos++] << 16;
      if (cmd & 0x08) offset |= delta[pos++] << 24;

      if (cmd & 0x10) size |= delta[pos++];
      if (cmd & 0x20) size |= delta[pos++] << 8;
      if (cmd & 0x40) size |= delta[pos++] << 16;
      if (size === 0) size = 0x10000;

      target.set(base.subarray(offset, offset + size), targetPos);
      targetPos += size;
    } else if (cmd !== 0) {
      // Insert instruction
      const data = delta.subarray(pos, pos + cmd);
      target.set(data, targetPos);
      targetPos += cmd;
      pos += cmd;
    } else {
      throw new Error("Invalid zero delta instruction");
    }
  }

  return Buffer.from(target);
}

function inflateAt(buf: Uint8Array, offset: number): { data: Uint8Array; next: number } {
  const remainder = buf.subarray(offset);
  let data: Uint8Array;
  try {
    data = inflateSync(remainder);
  } catch (e) {
    throw e;
  }

  // Compute Adler-32 of inflated data
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    b = (b + a) % 65521;
  }
  const adler = ((b << 16) | a) >>> 0;

  const adlerBytes = [
    (adler >> 24) & 0xff,
    (adler >> 16) & 0xff,
    (adler >> 8) & 0xff,
    adler & 0xff
  ];

  const maxSearch = buf.length - 4;
  let candidateEnd = -1;
  let i = offset + 2;
  while (true) {
    i = buf.indexOf(adlerBytes[0], i);
    if (i === -1 || i > maxSearch) break;
    if (buf[i+1] === adlerBytes[1] && buf[i+2] === adlerBytes[2] && buf[i+3] === adlerBytes[3]) {
      const candidateLen = i + 4 - offset;
      try {
        const candidateData = inflateSync(buf.subarray(offset, offset + candidateLen));
        if (candidateData.length === data.length) {
          let match = true;
          for (let j = 0; j < data.length; j++) {
            if (candidateData[j] !== data[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            candidateEnd = i + 4;
            break;
          }
        }
      } catch {
        // continue
      }
    }
    i++;
  }

  if (candidateEnd !== -1) {
    const compressedLength = candidateEnd - offset;
    return { data, next: offset + compressedLength };
  }

  // Fallback: binary search for exact compressed length
  let low = 1;
  let high = remainder.length;
  let bestLen = high;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    try {
      inflateSync(buf.subarray(offset, offset + mid));
      bestLen = mid;
      high = mid - 1;
    } catch {
      low = mid + 1;
    }
  }
  const exactData = inflateSync(buf.subarray(offset, offset + bestLen));
  return { data: exactData, next: offset + bestLen };
}

export function readPack(
  pack: Uint8Array,
  resolveBase?: (oid: string) => GitObject | undefined
): { objects: Map<string, GitObject>; deltaCount: number } {
  if (pack.length < 32) {
    throw new Error('Pack file too short');
  }

  const magic = new TextDecoder().decode(pack.subarray(0, 4));
  if (magic !== 'PACK') {
    throw new Error(`Invalid pack magic: ${magic}`);
  }

  const version = (pack[4] << 24) | (pack[5] << 16) | (pack[6] << 8) | pack[7];
  if (version !== 2) {
    throw new Error(`Unsupported pack version: ${version}`);
  }

  const numObjects = (pack[8] << 24) | (pack[9] << 16) | (pack[10] << 8) | pack[11];

  interface RawObj {
    start: number;
    type: number;
    body: Uint8Array;
    baseOid?: string;
    baseOffset?: number;
  }

  const rawObjects: RawObj[] = [];
  const offsetToIdx = new Map<number, number>();
  let offset = 12;

  for (let i = 0; i < numObjects; i++) {
    const start = offset;
    const b = pack[offset++];
    const type = (b >> 4) & 0x07;
    let size = b & 0x0f;
    let shift = 4;

    let currentB = b;
    while ((currentB & 0x80) !== 0) {
      currentB = pack[offset++];
      size |= (currentB & 0x7f) << shift;
      shift += 7;
    }

    let baseOid: string | undefined;
    let baseOffset: number | undefined;

    if (type === 6) {
      let nextB = pack[offset++];
      let negativeOffset = nextB & 0x7f;
      while ((nextB & 0x80) !== 0) {
        nextB = pack[offset++];
        negativeOffset = ((negativeOffset + 1) << 7) | (nextB & 0x7f);
      }
      baseOffset = start - negativeOffset;
    } else if (type === 7) {
      const baseOidBytes = pack.subarray(offset, offset + 20);
      offset += 20;
      baseOid = Array.from(baseOidBytes)
        .map(x => x.toString(16).padStart(2, '0'))
        .join('');
    }

    const inflated = inflateAt(pack, offset);
    offset = inflated.next;

    rawObjects.push({
      start,
      type,
      body: inflated.data,
      baseOid,
      baseOffset
    });
    offsetToIdx.set(start, i);
  }

  const trailerHex = Buffer.from(pack.subarray(pack.length - 20)).toString('hex');
  const computedHex = createHash('sha1').update(pack.subarray(0, pack.length - 20)).digest('hex');
  if (trailerHex !== computedHex) {
    throw new Error('Pack checksum mismatch');
  }

  if (rawObjects.length !== numObjects) {
    throw new Error(`Expected ${numObjects} objects, found ${rawObjects.length}`);
  }

  const objects = new Map<string, GitObject>();
  const resolvedCache = new Map<number, { type: ObjType; data: Uint8Array; oid: string }>();
  let deltaCount = 0;

  function resolve(idx: number): { type: ObjType; data: Uint8Array; oid: string } {
    if (resolvedCache.has(idx)) {
      return resolvedCache.get(idx)!;
    }

    const raw = rawObjects[idx];

    if (raw.type !== 6 && raw.type !== 7) {
      const typeStr = objectTypeName(raw.type);
      const oid = hashObject(typeStr, raw.body);
      const obj: GitObject = { type: typeStr, data: raw.body };
      objects.set(oid, obj);
      const res = { type: typeStr, data: raw.body, oid };
      resolvedCache.set(idx, res);
      return res;
    }

    deltaCount++;

    let baseType: ObjType;
    let baseData: Uint8Array;

    if (raw.baseOid) {
      let baseObj = objects.get(raw.baseOid);
      if (!baseObj) {
        if (!resolveBase) {
          throw new Error(`Base object ${raw.baseOid} not found and no resolveBase provided`);
        }
        baseObj = resolveBase(raw.baseOid);
        if (!baseObj) {
          throw new Error(`Base object ${raw.baseOid} could not be resolved`);
        }
      }
      baseType = baseObj.type;
      baseData = baseObj.data;
    } else if (raw.baseOffset !== undefined) {
      const baseIdx = offsetToIdx.get(raw.baseOffset);
      if (baseIdx === undefined) {
        throw new Error(`Base offset ${raw.baseOffset} not found in pack`);
      }
      const resolvedBase = resolve(baseIdx);
      baseType = resolvedBase.type;
      baseData = resolvedBase.data;
    } else {
      throw new Error('Delta object missing both baseOid and baseOffset');
    }

    const targetData = applyDelta(baseData, raw.body);
    const oid = hashObject(baseType, targetData);
    const obj: GitObject = { type: baseType, data: targetData };
    objects.set(oid, obj);
    const res = { type: baseType, data: targetData, oid };
    resolvedCache.set(idx, res);
    return res;
  }

  for (let i = 0; i < rawObjects.length; i++) {
    resolve(i);
  }

  return { objects, deltaCount };
}
export function writePack(objects: Iterable<{ type: ObjType; data: Uint8Array }>): Uint8Array {
  const objArray = Array.from(objects);
  const header = new Uint8Array(12);
  header.set(new TextEncoder().encode("PACK"), 0);
  const view = new DataView(header.buffer);
  view.setUint32(4, 2);
  view.setUint32(8, objArray.length);

  const chunks: Uint8Array[] = [header];

  const typeMap: Record<ObjType, number> = {
    commit: 1,
    tree: 2,
    blob: 3,
    tag: 4,
  };

  for (const obj of objArray) {
    const typeCode = typeMap[obj.type];
    let s = obj.data.length;
    let b = (s & 0x0f) | (typeCode << 4);
    s >>= 4;
    const headerBytes: number[] = [];
    if (s > 0) {
      headerBytes.push(b | 0x80);
      while (s > 0) {
        let nextB = s & 0x7f;
        s >>= 7;
        if (s > 0) nextB |= 0x80;
        headerBytes.push(nextB);
      }
    } else {
      headerBytes.push(b);
    }

    const compressed = deflateSync(obj.data);
    const entry = new Uint8Array(headerBytes.length + compressed.length);
    entry.set(headerBytes, 0);
    entry.set(compressed, headerBytes.length);
    chunks.push(entry);
  }

  // Calculate total length for checksum
  let totalLen = 0;
  for (const c of chunks) totalLen += c.length;

  const fullPack = new Uint8Array(totalLen + 20);
  let pos = 0;
  for (const c of chunks) {
    fullPack.set(c, pos);
    pos += c.length;
  }

  const checksum = createHash("sha1").update(fullPack.subarray(0, totalLen)).digest();
  fullPack.set(checksum, totalLen);

  return fullPack;
}

export function reachableObjects(
  get: (oid: string) => GitObject | undefined,
  tips: string[]
): Set<string> {
  const visited = new Set<string>();
  const queue = [...tips];

  while (queue.length > 0) {
    const oid = queue.pop()!;
    if (visited.has(oid)) continue;
    const obj = get(oid);
    if (!obj) continue;
    visited.add(oid);

    if (obj.type === "commit") {
      const commit = parseCommit(obj.data);
      queue.push(commit.tree);
      for (const p of commit.parents) {
        queue.push(p);
      }
    } else if (obj.type === "tree") {
      const entries = parseTree(obj.data);
      for (const entry of entries) {
        queue.push(entry.oid);
      }
    } else if (obj.type === "tag") {
      const tag = parseTag(obj.data);
      queue.push(tag.object);
    } else if (obj.type === "blob") {
      // blob has no references
    }
  }

  return visited;
}

