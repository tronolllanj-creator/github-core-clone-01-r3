import http from "node:http";
import { createApp } from "./app.ts";
import { Store } from "./store.ts";
import { attachGitHelpers } from "./gitproto.ts";
import {
  writePack,
  reachableObjects,
  parseCommit,
  parseTree,
} from "./gitobj.ts";

const envUrl = process.env.MAKEFUN_ENV_URL;
const shopToken = process.env.MAKEFUN_SHOP_TOKEN ?? "dev-token";
const trialNow = process.env.MAKEFUN_TRIAL_NOW;
const trialSeed = process.env.MAKEFUN_TRIAL_SEED;

const store = new Store();
store.seedScenario(trialSeed);

attachGitHelpers({
  writePack: (objs) =>
    writePack(
      objs as unknown as Array<{
        type: "commit" | "tree" | "blob" | "tag";
        data: Uint8Array;
      }>
    ),
  reachable: (get, tips) =>
    reachableObjects(
      get as unknown as (
        oid: string
      ) => { type: "commit" | "tree" | "blob" | "tag"; data: Uint8Array } | undefined,
      tips
    ),
  parseCommitParents: (d) => parseCommit(d).parents,
  parseTreeOids: (d) => parseTree(d).map((e) => e.oid),
});

if (trialNow) {
  const parsed = Date.parse(trialNow);
  if (!isNaN(parsed)) {
    store.clockTime = parsed;
  }
}

const app = createApp(store, { token: shopToken });
const server = http.createServer(app);

const shutdown = (): void => {
  server.close(() => {
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(0, "127.0.0.1", async () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  console.log(`listening on 127.0.0.1:${port}`);

  if (!envUrl) {
    console.log("MAKEFUN_ENV_URL not set, skipping registration");
    return;
  }

  try {
    const res = await fetch(`${envUrl}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port }),
    });

    if (!res.ok) {
      console.error(`Failed to register with trial env: ${res.status}`);
      process.exit(1);
    }

    console.log("registered with trial env");
  } catch (err) {
    console.error("Failed to register with trial env:", err);
    process.exit(1);
  }

  while (true) {
    try {
      const res = await fetch(`${envUrl}/done`);
      if (res.status === 200) {
        const body = await res.json() as { done?: boolean };
        if (body.done === true) {
          server.close(() => {
            process.exit(0);
          });
          return;
        }
      }
    } catch {
      // Keep polling on fetch error
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
});
