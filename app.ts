import * as http from "node:http";
import { Store } from "./store.ts";
import type { Repo } from "./store.ts";
import {
  uploadPackAdvertisement,
  receivePackAdvertisement,
  uploadPack,
} from "./gitproto.ts";
import { handleReceivePack } from "./gitrecv.ts";
import { handleRest } from "./rest.ts";
import type { RestContext, RestResponse } from "./rest.ts";
import { executeGraphQL } from "./graphql.ts";
import { handleMcp } from "./mcp.ts";
import type { JsonRpcRequest } from "./mcp.ts";

let requestSeq = 0;

function genRequestId(): string {
  requestSeq += 1;
  const hex = requestSeq.toString(16).padStart(8, "0");
  return `req-${requestSeq}-${hex}`;
}

function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on("data", (chunk: Buffer | string) => {
      parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", (e: Error) => reject(e));
  });
}

function writeJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(payload));
}

function stripTrailingSlash(p: string): string {
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p;
}

function decodePathname(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseQueryString(qs: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!qs) return out;
  for (const pair of qs.split("&")) {
    if (!pair) continue;
    const idx = pair.indexOf("=");
    const k = idx === -1 ? pair : pair.slice(0, idx);
    const v = idx === -1 ? "" : pair.slice(idx + 1);
    const dk = decodeURIComponent(k.replace(/\+/g, " "));
    const dv = decodeURIComponent(v.replace(/\+/g, " "));
    if (!(dk in out)) out[dk] = dv;
  }
  return out;
}

export function createApp(store: Store, opts: { token: string }): http.RequestListener {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    (async () => {
      const requestId = genRequestId();
      res.setHeader("X-GitHub-Request-Id", requestId);

      try {
        const raw = req.url ?? "/";
        const qmark = raw.indexOf("?");
        const rawPath = qmark === -1 ? raw : raw.slice(0, qmark);
        const rawQuery = qmark === -1 ? "" : raw.slice(qmark + 1);
        const path = stripTrailingSlash(decodePathname(rawPath));
        const method = (req.method ?? "GET").toUpperCase();

        // /api/v3 FIRST (hottest path)
        if (path === "/api/v3" || path.startsWith("/api/v3/")) {
          const auth = req.headers["authorization"];
          if (auth !== `Bearer ${opts.token}`) {
            writeJson(res, 401, { message: "Bad credentials" });
            return;
          }

          const suffix = path === "/api/v3" ? "" : path.slice("/api/v3/".length);
          const segments = suffix ? suffix.split("/").filter((s) => s.length > 0) : [];
          const query = rawQuery ? parseQueryString(rawQuery) : {};

          let parsedBody: unknown = null;
          if (["POST", "PATCH", "PUT", "DELETE"].includes(method)) {
            const body = await readRequestBody(req);
            if (body.length > 0) {
              try {
                parsedBody = JSON.parse(body.toString("utf-8"));
              } catch {
                writeJson(res, 400, { message: "Invalid JSON" });
                return;
              }
            }
          }

          const host = req.headers.host ?? "";
          const origin = host ? `http://${host}` : "";
          const ctx: RestContext = {
            store,
            viewerLogin: "adaiversen",
            method,
            segments,
            query,
            body: parsedBody,
            origin,
          };

          const restRes = handleRest(ctx);
          if (restRes === null) {
            writeJson(res, 404, { message: "Not Found" });
            return;
          }

          res.statusCode = restRes.status;
          let hasCt = false;
          if (restRes.headers) {
            for (const [hk, hv] of Object.entries(restRes.headers)) {
              if (hk.toLowerCase() === "content-type") hasCt = true;
              res.setHeader(hk, hv);
            }
          }
          if (!hasCt) res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(restRes.body));
          return;
        }

        // /healthz (no auth)
        if (method === "GET" && path === "/healthz") {
          writeJson(res, 200, { ok: true });
          return;
        }

        // Auth for everything else
        const auth = req.headers["authorization"];
        if (auth !== `Bearer ${opts.token}`) {
          writeJson(res, 401, { message: "Bad credentials" });
          return;
        }

        // git info/refs
        const infoRefs = path.match(/^\/([^/]+)\/([^/]+)\.git\/info\/refs$/);
        if (infoRefs && method === "GET") {
          const [, owner, repoName] = infoRefs;
          const svc = rawQuery ? parseQueryString(rawQuery).service : null;
          const repo = store.getRepo(owner, repoName);
          if (!repo) {
            writeJson(res, 404, { message: "Not Found" });
            return;
          }
          if (svc === "git-upload-pack") {
            const adv = uploadPackAdvertisement(repo);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/x-git-upload-pack-advertisement");
            res.end(adv);
            return;
          }
          if (svc === "git-receive-pack") {
            const adv = receivePackAdvertisement(repo);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/x-git-receive-pack-advertisement");
            res.end(adv);
            return;
          }
          writeJson(res, 400, { message: "Invalid service" });
          return;
        }

        // git-upload-pack
        const upMatch = path.match(/^\/([^/]+)\/([^/]+)\.git\/git-upload-pack$/);
        if (upMatch && method === "POST") {
          const [, owner, repoName] = upMatch;
          const repo = store.getRepo(owner, repoName);
          if (!repo) {
            writeJson(res, 404, { message: "Not Found" });
            return;
          }
          const body = await readRequestBody(req);
          const out = uploadPack(repo, body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/x-git-upload-pack-result");
          res.end(out);
          return;
        }

        // git-receive-pack
        const rpMatch = path.match(/^\/([^/]+)\/([^/]+)\.git\/git-receive-pack$/);
        if (rpMatch && method === "POST") {
          const [, owner, repoName] = rpMatch;
          const repo = store.getRepo(owner, repoName);
          if (!repo) {
            writeJson(res, 404, { message: "Not Found" });
            return;
          }
          const body = await readRequestBody(req);
          const out = handleReceivePack(repo, body);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/x-git-receive-pack-result");
          res.end(out);
          return;
        }

        // GraphQL
        if (path === "/api/graphql" && method === "POST") {
          const body = await readRequestBody(req);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString("utf-8"));
          } catch {
            writeJson(res, 400, { message: "Invalid JSON" });
            return;
          }
          const gqlRes = executeGraphQL(store, "adaiversen", parsed);
          writeJson(res, gqlRes.status, gqlRes.body);
          return;
        }

        // MCP
        if (path === "/mcp" && method === "POST") {
          const body = await readRequestBody(req);
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString("utf-8"));
          } catch {
            writeJson(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
            return;
          }
          const mcpRes = handleMcp(store, "adaiversen", parsed as JsonRpcRequest);
          writeJson(res, 200, mcpRes);
          return;
        }

        writeJson(res, 404, { message: "Not Found" });
      } catch {
        if (!res.headersSent) writeJson(res, 500, { message: "Internal Server Error" });
      }
    })();
  };
}
