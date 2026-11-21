import { Buffer } from "node:buffer";
import type { Repo } from "./store.ts";
import { readPack, parseCommit } from "./gitobj.ts";
import { pktLine, pktLines, pktFlush, decodePktLines } from "./gitproto.ts";

const ZERO_OID = "0000000000000000000000000000000000000000";

export type PushCommand = {
  oldOid: string;
  newOid: string;
  ref: string;
};

export function parsePushBody(body: Uint8Array): { commands: PushCommand[]; capabilities: Map<string, string>; pack: Uint8Array | null } {
  const commands: PushCommand[] = [];
  const capabilities = new Map<string, string>();
  let pack: Uint8Array | null = null;
  let offset = 0;

  while (offset < body.length) {
    if (offset + 4 > body.length) {
      throw new Error("bad pkt-line");
    }
    const hex = Buffer.from(body.subarray(offset, offset + 4)).toString("ascii");
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new Error("bad pkt-line");
    }
    const length = parseInt(hex, 16);
    if (length === 0) {
      const rest = body.subarray(offset + 4);
      pack = rest.length > 0 ? rest : null;
      break;
    }
    if (length < 4 || offset + length > body.length) {
      throw new Error("bad pkt-line");
    }

    const payload = body.subarray(offset + 4, offset + length);
    offset += length;

    let lineStr = Buffer.from(payload).toString("utf8");
    if (lineStr.endsWith("\n")) {
      lineStr = lineStr.slice(0, -1);
    }

    const nulIndex = lineStr.indexOf("\0");
    let cmdStr = lineStr;
    if (nulIndex !== -1) {
      cmdStr = lineStr.slice(0, nulIndex);
      const capStr = lineStr.slice(nulIndex + 1);
      for (const token of capStr.split(" ")) {
        if (!token) continue;
        const eqIndex = token.indexOf("=");
        if (eqIndex !== -1) {
          capabilities.set(token.slice(0, eqIndex), token.slice(eqIndex + 1));
        } else {
          capabilities.set(token, "");
        }
      }
    }

    const [oldOid, newOid, ref] = cmdStr.split(" ");
    commands.push({ oldOid, newOid, ref });
  }

  return { commands, capabilities, pack };
}
export function isAncestor(
  repo: Repo,
  ancestorOid: string,
  descendantOid: string
): boolean {
  if (descendantOid === ZERO_OID) {
    return false;
  }
  if (ancestorOid === descendantOid) {
    return true;
  }

  const visited = new Set<string>();
  const stack: string[] = [descendantOid];

  while (stack.length > 0) {
    const currentOid = stack.pop()!;
    if (visited.has(currentOid)) continue;
    visited.add(currentOid);

    if (currentOid === ancestorOid) {
      return true;
    }

    const obj = repo.objects.get(currentOid);
    if (!obj || obj.type !== "commit") {
      continue;
    }

    const commit = parseCommit(obj.data);
    for (const parentOid of commit.parents) {
      if (!visited.has(parentOid)) {
        stack.push(parentOid);
      }
    }
  }

  return false;
}

export function handleReceivePack(repo: Repo, body: Uint8Array): Buffer {
  const { commands, capabilities, pack } = parsePushBody(body);

  if (pack && pack.length > 0) {
    try {
      const read = readPack(pack);
      for (const [oid, obj] of read.objects) {
        repo.objects.set(oid, { type: obj.type, data: obj.data });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const reportLines: string[] = [`unpack ${errMsg}\n`];
      for (const cmd of commands) {
        reportLines.push(`ng ${cmd.ref} unpack failed\n`);
      }
      return formatReport(reportLines, capabilities);
    }
  }

  const reportLines: string[] = ["unpack ok\n"];

  for (const cmd of commands) {
    const cur = repo.refs.get(cmd.ref);

    if (cmd.newOid === ZERO_OID) {
      if (cur === undefined) {
        reportLines.push(`ng ${cmd.ref} ref does not exist\n`);
      } else if (cmd.oldOid !== ZERO_OID && cmd.oldOid !== cur) {
        reportLines.push(`ng ${cmd.ref} old value does not match\n`);
      } else {
        repo.refs.delete(cmd.ref);
        reportLines.push(`ok ${cmd.ref}\n`);
      }
    } else if (cmd.oldOid === ZERO_OID) {
      if (cur !== undefined) {
        reportLines.push(`ng ${cmd.ref} ref already exists\n`);
      } else {
        const newObj = repo.objects.get(cmd.newOid);
        if (!newObj) {
          reportLines.push(`ng ${cmd.ref} object not found\n`);
        } else if (newObj.type !== "commit" && !(cmd.ref.startsWith("refs/tags/") && newObj.type === "tag")) {
          reportLines.push(`ng ${cmd.ref} new object is not a commit\n`);
        } else {
          repo.refs.set(cmd.ref, cmd.newOid);
          reportLines.push(`ok ${cmd.ref}\n`);
        }
      }
    } else {
      if (cur === undefined) {
        reportLines.push(`ng ${cmd.ref} ref does not exist\n`);
      } else if (cmd.oldOid !== cur) {
        reportLines.push(`ng ${cmd.ref} old value does not match\n`);
      } else if (cmd.newOid === cur) {
        reportLines.push(`ok ${cmd.ref}\n`);
      } else {
        const newObj = repo.objects.get(cmd.newOid);
        if (!newObj) {
          reportLines.push(`ng ${cmd.ref} object not found\n`);
        } else if (newObj.type !== "commit" && !(cmd.ref.startsWith("refs/tags/") && newObj.type === "tag")) {
          reportLines.push(`ng ${cmd.ref} new object is not a commit\n`);
        } else if (!isAncestor(repo, cmd.oldOid, cmd.newOid)) {
          reportLines.push(`ng ${cmd.ref} non-fast-forward\n`);
        } else {
          repo.refs.set(cmd.ref, cmd.newOid);
          reportLines.push(`ok ${cmd.ref}\n`);
        }
      }
    }
  }

  return formatReport(reportLines, capabilities);
}

function formatReport(lines: string[], capabilities: Map<string, string>): Buffer {
  const reportBody = pktLines(lines);
  const responseEnd = Buffer.from("0002", "ascii");

  if (capabilities.has("side-band-64k")) {
    const chunks: Buffer[] = [];
    const CHUNK_SIZE = 65000;
    for (let i = 0; i < reportBody.length; i += CHUNK_SIZE) {
      const chunk = reportBody.subarray(i, i + CHUNK_SIZE);
      const band1Data = Buffer.concat([Buffer.from([1]), chunk]);
      chunks.push(pktLine(band1Data));
    }
    chunks.push(pktFlush());
    chunks.push(responseEnd);
    return Buffer.concat(chunks);
  } else {
    return Buffer.concat([reportBody, pktFlush(), responseEnd]);
  }
}
