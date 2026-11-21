import { Buffer } from "node:buffer";
import type { Repo } from "./store.ts";

export function pktLine(payload: string | Uint8Array): Buffer {
  const body = typeof payload === "string" ? Buffer.from(payload, "utf8") : Buffer.from(payload);
  const len = body.length + 4;
  const hex = len.toString(16).padStart(4, "0").toLowerCase();
  return Buffer.concat([Buffer.from(hex, "ascii"), body]);
}

export function pktFlush(): Buffer {
  return Buffer.from("0000", "ascii");
}

export function pktDelim(): Buffer {
  return Buffer.from("0001", "ascii");
}

export function pktLines(items: Array<string | Uint8Array | "flush" | "delim">): Buffer {
  const bufs: Buffer[] = [];
  for (const item of items) {
    if (item === "flush") {
      bufs.push(pktFlush());
    } else if (item === "delim") {
      bufs.push(pktDelim());
    } else {
      bufs.push(pktLine(item));
    }
  }
  return Buffer.concat(bufs);
}

export function decodePktLines(
  buf: Uint8Array
): Array<{ kind: "data" | "flush" | "delim" | "response-end"; payload: Uint8Array }> {
  const result: Array<{ kind: "data" | "flush" | "delim" | "response-end"; payload: Uint8Array }> = [];
  let offset = 0;

  while (offset < buf.length) {
    if (buf.length - offset < 4) {
      throw new Error("bad pkt-line");
    }
    const hexStr = Buffer.from(buf.subarray(offset, offset + 4)).toString("ascii");
    if (!/^[0-9a-fA-F]{4}$/.test(hexStr)) {
      throw new Error("bad pkt-line");
    }
    const len = parseInt(hexStr, 16);
    if (len === 0) {
      result.push({ kind: "flush", payload: new Uint8Array(0) });
      offset += 4;
    } else if (len === 1) {
      result.push({ kind: "delim", payload: new Uint8Array(0) });
      offset += 4;
    } else if (len === 2) {
      result.push({ kind: "response-end", payload: new Uint8Array(0) });
      offset += 4;
    } else if (len < 4) {
      throw new Error("bad pkt-line");
    } else {
      if (offset + len > buf.length) {
        throw new Error("bad pkt-line");
      }
      const payload = buf.subarray(offset + 4, offset + len);
      result.push({ kind: "data", payload: new Uint8Array(payload) });
      offset += len;
    }
  }

  return result;
}

export function pktLinesToStrings(packets: Array<{ kind: string; payload: Uint8Array }>): string[] {
  const result: string[] = [];
  for (const pkt of packets) {
    if (pkt.kind === "data") {
      result.push(Buffer.from(pkt.payload).toString("utf8"));
    }
  }
  return result;
}

export function tagTarget(data: Uint8Array): string | undefined {
  const newlineIdx = data.indexOf(10);
  const lineBuf = newlineIdx !== -1 ? data.subarray(0, newlineIdx) : data;
  let line = Buffer.from(lineBuf).toString("utf8");
  const nullIdx = line.indexOf("\0");
  if (nullIdx !== -1) {
    line = line.substring(nullIdx + 1);
  }
  line = line.trim();
  if (line.startsWith("object ")) {
    const oid = line.substring(7).trim();
    return oid || undefined;
  }
  return undefined;
}

function getRefEntries(repo: Repo): [string, string][] {
  const repoObj = repo as unknown as Record<string, unknown>;
  const refs = repoObj.refs;
  if (!refs) return [];
  if (refs instanceof Map) {
    const map = refs as Map<unknown, unknown>;
    const result: [string, string][] = [];
    for (const [k, v] of map.entries()) {
      if (typeof k === "string" && typeof v === "string") {
        result.push([k, v]);
      }
    }
    return result;
  }
  if (typeof refs === "object" && refs !== null) {
    const obj = refs as Record<string, unknown>;
    const result: [string, string][] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === "string") {
        result.push([k, v]);
      }
    }
    return result;
  }
  return [];
}

function getDefaultBranch(repo: Repo): string {
  const repoObj = repo as unknown as Record<string, unknown>;
  if (typeof repoObj.defaultBranch === "string" && repoObj.defaultBranch) {
    return repoObj.defaultBranch;
  }
  return "main";
}

function getObjectData(repo: Repo, oid: string): Uint8Array | undefined {
  const repoObj = repo as unknown as Record<string, unknown>;
  if (typeof repoObj.getObject === "function") {
    const fn = repoObj.getObject as (oid: string) => unknown;
    const res = fn(oid);
    if (res instanceof Uint8Array) return res;
    if (res && typeof res === "object" && "data" in res && (res as { data: unknown }).data instanceof Uint8Array) {
      return (res as { data: Uint8Array }).data;
    }
  }
  if (typeof repoObj.readObject === "function") {
    const fn = repoObj.readObject as (oid: string) => unknown;
    const res = fn(oid);
    if (res instanceof Uint8Array) return res;
    if (res && typeof res === "object" && "data" in res && (res as { data: unknown }).data instanceof Uint8Array) {
      return (res as { data: Uint8Array }).data;
    }
  }
  if (repoObj.objects) {
    const objs = repoObj.objects;
    let res: unknown;
    if (objs instanceof Map) {
      res = objs.get(oid);
    } else if (typeof objs === "object" && objs !== null) {
      res = (objs as Record<string, unknown>)[oid];
    }
    if (res instanceof Uint8Array) return res;
    if (res && typeof res === "object" && "data" in res && (res as { data: unknown }).data instanceof Uint8Array) {
      return (res as { data: Uint8Array }).data;
    }
  }
  return undefined;
}

export function uploadPackAdvertisement(repo: Repo): Buffer {
  return pktLines([
    "# service=git-upload-pack\n",
    "flush",
    "version 2\n",
    "agent=forge/1.0\n",
    "ls-refs=unborn\n",
    "fetch=shallow wait-for-done\n",
    "server-option\n",
    "object-format=sha1\n",
    "flush",
  ]);
}

export function receivePackAdvertisement(repo: Repo): Buffer {
  const refEntries = getRefEntries(repo);
  if (refEntries.length === 0) {
    return pktLines([
      "# service=git-receive-pack\n",
      "flush",
      "0000000000000000000000000000000000000000 capabilities^{}\0report-status report-status-v2 delete-refs side-band-64k ofs-delta agent=forge/1.0\n",
      "flush",
    ]);
  }

  refEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const defaultBranch = getDefaultBranch(repo);
  const defaultRefName = `refs/heads/${defaultBranch}`;
  const defaultEntry = refEntries.find(([name]) => name === defaultRefName);

  const caps = "report-status report-status-v2 delete-refs side-band-64k ofs-delta agent=forge/1.0";
  const refLines: string[] = [];
  let isFirstLine = true;

  if (defaultEntry) {
    const headOid = defaultEntry[1];
    refLines.push(`${headOid} HEAD\0${caps} symref=HEAD:${defaultRefName}\n`);
    isFirstLine = false;
  }

  for (const [refname, oid] of refEntries) {
    if (isFirstLine) {
      refLines.push(`${oid} ${refname}\0${caps}\n`);
      isFirstLine = false;
    } else {
      refLines.push(`${oid} ${refname}\n`);
    }

    const data = getObjectData(repo, oid);
    if (data) {
      const targetOid = tagTarget(data);
      if (targetOid) {
        refLines.push(`${targetOid} ${refname}^{}\n`);
      }
    }
  }

  return pktLines(["# service=git-receive-pack\n", "flush", ...refLines, "flush"]);
}

export type GitHelpers = {
  writePack: (objs: Array<{ type: string; data: Uint8Array }>) => Uint8Array;
  reachable: (
    get: (oid: string) => { type: string; data: Uint8Array } | undefined,
    tips: string[]
  ) => Set<string>;
  parseCommitParents: (d: Uint8Array) => string[];
  parseTreeOids: (d: Uint8Array) => string[];
};

let writePackFn: GitHelpers["writePack"] = () => {
  throw new Error("git helpers not attached");
};
let reachableFn: GitHelpers["reachable"] = () => {
  throw new Error("git helpers not attached");
};
let parseCommitParentsFn: GitHelpers["parseCommitParents"] = () => {
  throw new Error("git helpers not attached");
};
let parseTreeOidsFn: GitHelpers["parseTreeOids"] = () => {
  throw new Error("git helpers not attached");
};

export function attachGitHelpers(h: GitHelpers): void {
  writePackFn = h.writePack;
  reachableFn = h.reachable;
  parseCommitParentsFn = h.parseCommitParents;
  parseTreeOidsFn = h.parseTreeOids;
}

export function lsRefs(repo: Repo, body: Uint8Array): Buffer {
  const decoded = decodePktLines(body);
  let peel = false;
  let symrefs = false;
  let unborn = false;
  const prefixes: string[] = [];

  for (const item of decoded) {
    if (item.kind === "data" && item.payload) {
      const s = Buffer.from(item.payload).toString("utf8").replace(/\n$/, "");
      if (s === "peel") peel = true;
      else if (s === "symrefs") symrefs = true;
      else if (s === "unborn") unborn = true;
      else if (s.startsWith("ref-prefix ")) prefixes.push(s.slice(11));
    }
  }

  const lines: string[] = [];
  const headMatches = prefixes.length === 0 || prefixes.some((p) => "HEAD".startsWith(p));

  if (headMatches) {
    const defaultRef = "refs/heads/" + repo.defaultBranch;
    const headOid = repo.refs.get(defaultRef);
    if (headOid) {
      if (symrefs) {
        lines.push(`${headOid} HEAD symref-target:${defaultRef}\n`);
      } else {
        lines.push(`${headOid} HEAD\n`);
      }
    } else if (unborn) {
      if (symrefs) {
        lines.push(`unborn HEAD symref-target:${defaultRef}\n`);
      } else {
        lines.push(`unborn HEAD\n`);
      }
    }
  }

  const refNames = Array.from(repo.refs.keys()).sort();
  for (const ref of refNames) {
    if (ref === "HEAD") continue;
    if (prefixes.length > 0 && !prefixes.some((p) => ref.startsWith(p))) continue;

    const oid = repo.refs.get(ref)!;
    let line = `${oid} ${ref}`;
    if (peel) {
      const obj = repo.objects.get(oid);
      if (obj?.type === "tag") {
        const target = tagTarget(obj.data);
        line += ` peeled:${target}`;
      }
    }
    lines.push(line + "\n");
  }

  return pktLines([...lines, "flush"]);
}

export function fetchObjects(
  repo: Repo,
  wants: string[],
  haves: string[],
  depth: number | undefined,
  clientShallow: string[]
): {
  objects: Map<string, { type: string; data: Uint8Array }>;
  shallow: string[];
  unshallow: string[];
  wantedRefs: Array<{ oid: string; ref: string }>;
} {
  const wantedRefs: Array<{ oid: string; ref: string }> = [];
  const seenRefs = new Set<string>();
  for (const want of wants) {
    for (const [ref, oid] of repo.refs.entries()) {
      if (oid === want && !seenRefs.has(ref)) {
        seenRefs.add(ref);
        wantedRefs.push({ oid, ref });
      }
    }
  }

  let includedTips: string[] = [];
  let shallow: string[] = [];
  let unshallow: string[] = [];
  const includedSet = new Set<string>();

  if (depth !== undefined) {
    const visitedDepth = new Map<string, number>();
    const queue: Array<{ oid: string; d: number }> = [];

    for (const want of wants) {
      if (repo.objects.has(want)) {
        visitedDepth.set(want, 0);
        queue.push({ oid: want, d: 0 });
      }
    }

    while (queue.length > 0) {
      const { oid, d } = queue.shift()!;
      if (d < depth - 1) {
        const obj = repo.objects.get(oid);
        if (obj && obj.type === "commit") {
          const parents = parseCommitParentsFn(obj.data);
          for (const parent of parents) {
            if (repo.objects.has(parent)) {
              if (!visitedDepth.has(parent) || visitedDepth.get(parent)! > d + 1) {
                visitedDepth.set(parent, d + 1);
                queue.push({ oid: parent, d: d + 1 });
              }
            }
          }
        }
      }
    }

    const shallowList: string[] = [];
    for (const [oid, d] of visitedDepth.entries()) {
      if (d < depth) {
        includedTips.push(oid);
        includedSet.add(oid);
      }
      if (d === depth - 1) {
        shallowList.push(oid);
      }
    }
    shallow = shallowList;
    unshallow = clientShallow.filter((s) => includedSet.has(s));
  } else {
    includedTips = wants.filter((w) => repo.objects.has(w));
    for (const id of includedTips) includedSet.add(id);
    shallow = [];

    const getObjAll = (oid: string) => repo.objects.get(oid);
    const reachableFromWants = reachableFn(getObjAll, includedTips);
    unshallow = clientShallow.filter((s) => reachableFromWants.has(s));
  }

  const getObj = (oid: string) => {
    const obj = repo.objects.get(oid);
    if (!obj) return undefined;
    if (depth !== undefined && obj.type === "commit" && !includedSet.has(oid)) {
      return undefined;
    }
    return obj;
  };

  const wantSet = reachableFn(getObj, includedTips);
  const validHaves = haves.filter((h) => repo.objects.has(h));
  let haveSet = validHaves.length > 0 ? reachableFn(getObj, validHaves) : new Set<string>();

  if (clientShallow.length > 0) {
    const boundaryParents: string[] = [];
    for (const sc of clientShallow) {
      const obj = repo.objects.get(sc);
      if (obj && obj.type === "commit") {
        for (const p of parseCommitParentsFn(obj.data)) boundaryParents.push(p);
      }
    }
    if (boundaryParents.length > 0) {
      const beyond = reachableFn((oid) => repo.objects.get(oid), boundaryParents);
      haveSet = new Set([...haveSet].filter((o) => !beyond.has(o)));
    }
  }

  const sendOids = new Set<string>();
  for (const oid of wantSet) {
    if (!haveSet.has(oid)) {
      sendOids.add(oid);
    }
  }

  const objects = new Map<string, { type: string; data: Uint8Array }>();
  for (const oid of sendOids) {
    const obj = repo.objects.get(oid);
    if (obj) {
      objects.set(oid, obj);
    }
  }

  return { objects, shallow, unshallow, wantedRefs };
}

export function fetchV2(repo: Repo, body: Uint8Array): Buffer {
  const decoded = decodePktLines(body);
  const wants: string[] = [];
  const haves: string[] = [];
  const clientShallow: string[] = [];
  let depth: number | undefined = undefined;

  let inSection2 = false;
  for (const item of decoded) {
    if (!inSection2) {
      if (item.kind === "flush" || item.kind === "delim") {
        inSection2 = true;
      }
      continue;
    }
    if (item.kind === "flush") break;
    if (item.kind === "data" && item.payload) {
      const line = Buffer.from(item.payload).toString("utf8").replace(/\n$/, "");
      if (line.startsWith("want ")) {
        wants.push(line.slice(5).trim());
      } else if (line.startsWith("have ")) {
        haves.push(line.slice(5).trim());
      } else if (line.startsWith("shallow ")) {
        clientShallow.push(line.slice(8).trim());
      } else if (line.startsWith("deepen ")) {
        const d = parseInt(line.slice(7).trim(), 10);
        if (!isNaN(d)) depth = d;
      }
    }
  }

  const { objects, shallow, unshallow, wantedRefs } = fetchObjects(repo, wants, haves, depth, clientShallow);

  const parts: Buffer[] = [];
  if (haves.length === 0 && objects.size === 0) {
    parts.push(pktLines(["acknowledgments\n", "NAK\n", "flush"]));
    return Buffer.concat(parts);
  }
  if (haves.length > 0) {
    parts.push(pktLines(["acknowledgments\n", "NAK\n", "ready\n", "delim"]));
  }

  if (shallow.length > 0 || unshallow.length > 0) {
    parts.push(
      pktLines([
        "shallow-info\n",
        ...shallow.map((o) => `shallow ${o}\n`),
        ...unshallow.map((o) => `unshallow ${o}\n`),
        "delim",
      ])
    );
  }

  if (wantedRefs.length > 0) {
    parts.push(
      pktLines([
        "wanted-refs\n",
        ...wantedRefs.map((w) => `${w.oid} ${w.ref}\n`),
        "delim",
      ])
    );
  }

  if (objects.size > 0) {
    parts.push(pktLines(["packfile\n"]));
    const packData = writePackFn(Array.from(objects.values()));
    const CHUNK_SIZE = 65000;
    for (let offset = 0; offset < packData.length; offset += CHUNK_SIZE) {
      const chunk = packData.subarray(offset, offset + CHUNK_SIZE);
      const payload = Buffer.concat([Buffer.from([1]), chunk]);
      const lenStr = (payload.length + 4).toString(16).padStart(4, "0");
      parts.push(Buffer.concat([Buffer.from(lenStr, "ascii"), payload]));
    }
  }

  parts.push(pktFlush());
  return Buffer.concat(parts);
}

export function fetchV0(repo: Repo, body: Uint8Array): Buffer {
  const decoded = decodePktLines(body);
  const wants: string[] = [];
  const haves: string[] = [];
  const clientShallow: string[] = [];
  let depth: number | undefined = undefined;

  let section = 1;
  for (const item of decoded) {
    if (item.kind === "flush") {
      if (section === 1) section = 2;
      continue;
    }
    if (item.kind === "data" && item.payload) {
      const line = Buffer.from(item.payload).toString("utf8").replace(/\n$/, "");
      if (section === 1) {
        if (line.startsWith("want ")) {
          const oid = line.slice(5).trim().split(/\s+/)[0];
          if (oid) wants.push(oid);
        } else if (line.startsWith("shallow ")) {
          clientShallow.push(line.slice(8).trim());
        } else if (line.startsWith("deepen ")) {
          const d = parseInt(line.slice(7).trim(), 10);
          if (!isNaN(d)) depth = d;
        }
      } else if (section === 2) {
        if (line.startsWith("have ")) {
          haves.push(line.slice(5).trim());
        }
      }
    }
  }

  const { objects, shallow } = fetchObjects(repo, wants, haves, depth, clientShallow);

  const parts: Buffer[] = [];
  if (shallow.length > 0) {
    parts.push(pktLines(shallow.map((o) => `shallow ${o}\n`)));
  }
  parts.push(pktLine("NAK\n"));

  if (objects.size > 0) {
    const packData = writePackFn(Array.from(objects.values()));
    const CHUNK_SIZE = 65000;
    for (let offset = 0; offset < packData.length; offset += CHUNK_SIZE) {
      const chunk = packData.subarray(offset, offset + CHUNK_SIZE);
      const payload = Buffer.concat([Buffer.from([1]), chunk]);
      const lenStr = (payload.length + 4).toString(16).padStart(4, "0");
      parts.push(Buffer.concat([Buffer.from(lenStr, "ascii"), payload]));
    }
  }

  parts.push(pktFlush());
  return Buffer.concat(parts);
}

export function uploadPack(repo: Repo, body: Uint8Array): Buffer {
  const decoded = decodePktLines(body);
  for (const item of decoded) {
    if (item.kind === "data" && item.payload) {
      const line = Buffer.from(item.payload).toString("utf8").trim();
      if (line.startsWith("command=ls-refs")) {
        return lsRefs(repo, body);
      }
      if (line.startsWith("command=fetch")) {
        return fetchV2(repo, body);
      }
      if (line.startsWith("want ")) {
        return fetchV0(repo, body);
      }
    }
  }
  throw new Error("unknown upload-pack command");
}

