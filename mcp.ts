import type { Store, Repo, Issue, Pull } from "./store.ts";
import { repoGid, issueGid, pullGid } from "./graphql.ts";

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

export function mcpTools(): Array<{
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}> {
  return [
    {
      name: "create_repo",
      description: "Create a new repository for the viewer",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Repository name" },
          description: { type: "string", description: "Repository description" },
          private: { type: "boolean", description: "Whether the repository is private" },
        },
        required: ["name"],
      },
    },
    {
      name: "get_repo",
      description: "Get a repository by owner and name",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "list_repos",
      description: "List repositories owned by the viewer",
      inputSchema: {
        type: "object",
        properties: {
          first: { type: "number", description: "Maximum number of repositories to return" },
        },
        required: [],
      },
    },
    {
      name: "create_issue",
      description: "Create an issue in a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          title: { type: "string", description: "Issue title" },
          body: { type: "string", description: "Issue body" },
        },
        required: ["owner", "repo", "title"],
      },
    },
    {
      name: "list_issues",
      description: "List issues in a repository",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          state: { type: "string", description: "open, closed, or all" },
          first: { type: "number", description: "Maximum number of issues to return" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "create_pull_request",
      description: "Create a pull request",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          title: { type: "string", description: "Pull request title" },
          body: { type: "string", description: "Pull request body" },
          head: { type: "string", description: "Head branch name" },
          base: { type: "string", description: "Base branch name" },
        },
        required: ["owner", "repo", "title", "head", "base"],
      },
    },
    {
      name: "merge_pull_request",
      description: "Merge a pull request",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          number: { type: "number", description: "Pull request number" },
          pull_number: { type: "number", description: "Pull request number (alias for number)" },
        },
        required: ["owner", "repo"],
      },
    },
    {
      name: "get_issue",
      description: "Get an issue by number",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          repo: { type: "string", description: "Repository name" },
          number: { type: "number", description: "Issue number" },
        },
        required: ["owner", "repo", "number"],
      },
    },
  ];
}

function requireString(args: Record<string, unknown>, key: string, error: string): string {
  const val = args[key];
  if (typeof val !== "string" || val === "") {
    throw new Error(error);
  }
  return val;
}

function requireRepo(store: Store, owner: string, name: string): Repo {
  const repo = store.getRepo(owner, name);
  if (!repo) {
    throw new Error("repository not found");
  }
  return repo;
}

function limitResults<T>(items: T[], first?: number): { sliced: T[]; totalCount: number } {
  let limit = typeof first === "number" ? first : 30;
  if (limit > 100) limit = 100;
  if (limit < 0) limit = 0;
  return { sliced: items.slice(0, limit), totalCount: items.length };
}

function callTool(store: Store, viewerLogin: string, name: string, args: Record<string, unknown>): unknown {
  switch (name) {
    case "create_repo": {
      const repoName = requireString(args, "name", "name is required");
      const desc = typeof args.description === "string" ? args.description : undefined;
      const isPrivate = args.private === true;
      const repo = store.createRepo(viewerLogin, repoName, { description: desc, private: isPrivate });
      return {
        id: repoGid(repo),
        databaseId: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        url: "/" + repo.fullName,
      };
    }
    case "get_repo": {
      const owner = requireString(args, "owner", "repository not found");
      const repoName = requireString(args, "repo", "repository not found");
      const repo = requireRepo(store, owner, repoName);
      return {
        id: repoGid(repo),
        databaseId: repo.id,
        name: repo.name,
        fullName: repo.fullName,
        owner: repo.owner,
        private: repo.private,
        defaultBranch: repo.defaultBranch,
        description: repo.description,
        createdAt: repo.createdAt,
        updatedAt: repo.updatedAt,
      };
    }
    case "list_repos": {
      const all = store.listRepos(viewerLogin);
      const { sliced, totalCount } = limitResults(all, typeof args.first === "number" ? args.first : undefined);
      return {
        repos: sliced.map((r) => ({
          id: repoGid(r),
          name: r.name,
          fullName: r.fullName,
          private: r.private,
          defaultBranch: r.defaultBranch,
        })),
        totalCount,
      };
    }
    case "create_issue": {
      const owner = requireString(args, "owner", "repository not found");
      const repoName = requireString(args, "repo", "repository not found");
      const title = requireString(args, "title", "title is required");
      const body = typeof args.body === "string" ? args.body : "";
      const repo = requireRepo(store, owner, repoName);
      const num = repo.issueSeq++;
      const now = store.tick();
      const issue: Issue = {
        number: num,
        title,
        body,
        state: "open",
        labels: [],
        assignee: null,
        user: viewerLogin,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        comments: [],
        locked: false,
      };
      repo.issues.set(num, issue);
      return {
        id: issueGid(repo, issue),
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: "OPEN",
        url: "/" + repo.fullName + "/issues/" + issue.number,
      };
    }
    case "list_issues": {
      const owner = requireString(args, "owner", "repository not found");
      const repoName = requireString(args, "repo", "repository not found");
      const repo = requireRepo(store, owner, repoName);
      const stateArg = typeof args.state === "string" ? args.state.toLowerCase() : "open";
      let issues = Array.from(repo.issues.values());
      if (stateArg === "open") {
        issues = issues.filter((i) => i.state === "open");
      } else if (stateArg === "closed") {
        issues = issues.filter((i) => i.state === "closed");
      }
      issues.sort((a, b) => a.number - b.number);
      const { sliced, totalCount } = limitResults(issues, typeof args.first === "number" ? args.first : undefined);
      return {
        issues: sliced.map((i) => ({
          id: issueGid(repo, i),
          number: i.number,
          title: i.title,
          body: i.body,
          state: i.state === "open" ? "OPEN" : "CLOSED",
          url: "/" + repo.fullName + "/issues/" + i.number,
        })),
        totalCount,
      };
    }
    case "create_pull_request": {
      const owner = requireString(args, "owner", "repository not found");
      const repoName = requireString(args, "repo", "repository not found");
      const title = requireString(args, "title", "title is required");
      const head = requireString(args, "head", "head is required");
      const base = requireString(args, "base", "base is required");
      const body = typeof args.body === "string" ? args.body : "";
      const repo = requireRepo(store, owner, repoName);
      const baseSha = repo.refs.get("refs/heads/" + base);
      if (!baseSha) {
        throw new Error(`branch does not exist: ${base}`);
      }
      const headSha = repo.refs.get("refs/heads/" + head);
      if (!headSha) {
        throw new Error(`branch does not exist: ${head}`);
      }
      const num = repo.pullSeq++;
      const now = store.tick();
      const pull: Pull = {
        number: num,
        title,
        body,
        state: "open",
        headRef: head,
        headSha,
        baseRef: base,
        baseSha,
        user: viewerLogin,
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        mergedAt: null,
        merged: false,
        mergeable: true,
        comments: [],
        reviewComments: [],
        requestedReviewers: [],
        assignees: [],
        labels: [],
      };
      repo.pulls.set(num, pull);
      return {
        id: pullGid(repo, pull),
        number: pull.number,
        title: pull.title,
        body: pull.body,
        state: "OPEN",
        headRefName: head,
        baseRefName: base,
        url: "/" + repo.fullName + "/pull/" + pull.number,
      };
    }
    case "merge_pull_request": {
      const owner = requireString(args, "owner", "pull request not found");
      const repoName = requireString(args, "repo", "pull request not found");
      const rawNum = args.number !== undefined ? args.number : args.pull_number;
      const num = typeof rawNum === "number" ? rawNum : Number(rawNum);
      if (isNaN(num)) {
        throw new Error("pull request not found");
      }
      const repo = requireRepo(store, owner, repoName);
      const pull = repo.pulls.get(num);
      if (!pull) {
        throw new Error("pull request not found");
      }
      if (pull.merged || pull.state !== "open") {
        throw new Error("pull request is already merged or closed");
      }
      repo.refs.set("refs/heads/" + pull.baseRef, pull.headSha);
      pull.merged = true;
      pull.state = "closed";
      const mergedAt = store.tick();
      pull.mergedAt = mergedAt;
      pull.closedAt = mergedAt;
      pull.mergeCommitSha = pull.headSha;
      pull.updatedAt = mergedAt;
      return {
        id: pullGid(repo, pull),
        number: pull.number,
        merged: true,
        state: "MERGED",
        mergeCommitSha: pull.headSha,
      };
    }
    case "get_issue": {
      const owner = requireString(args, "owner", "issue not found");
      const repoName = requireString(args, "repo", "issue not found");
      const rawNum = args.number;
      const num = typeof rawNum === "number" ? rawNum : Number(rawNum);
      if (isNaN(num)) {
        throw new Error("issue not found");
      }
      const repo = requireRepo(store, owner, repoName);
      const issue = repo.issues.get(num);
      if (!issue) {
        throw new Error("issue not found");
      }
      return {
        id: issueGid(repo, issue),
        number: issue.number,
        title: issue.title,
        body: issue.body,
        state: issue.state === "open" ? "OPEN" : "CLOSED",
        url: "/" + repo.fullName + "/issues/" + issue.number,
        author: issue.user,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        closedAt: issue.closedAt,
        labels: issue.labels.map((l) => l.name),
        comments: issue.comments.length,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

export function handleMcp(store: Store, viewerLogin: string, req: JsonRpcRequest): JsonRpcResponse {
  if (!req || req.jsonrpc !== "2.0") {
    return {
      jsonrpc: "2.0",
      id: req && req.id !== undefined ? req.id : null,
      error: {
        code: -32600,
        message: "Invalid Request: jsonrpc must be 2.0",
      },
    };
  }

  const id = req.id ?? null;

  if (req.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "github-core-clone", version: "1.0.0" },
      },
    };
  }

  if (req.method === "notifications/initialized" || req.method.startsWith("notifications/")) {
    return {
      jsonrpc: "2.0",
      id,
      result: null,
    };
  }

  if (req.method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        tools: mcpTools(),
      },
    };
  }

  if (req.method === "tools/call") {
    const params = req.params || {};
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments as Record<string, unknown>) || {};
    try {
      const toolResult = callTool(store, viewerLogin, name, args);
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(toolResult) }], isError: false } };
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      if (errorMessage.startsWith("Unknown tool:")) {
        return { jsonrpc: "2.0", id, error: { code: -32602, message: errorMessage } };
      }
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: errorMessage }], isError: true } };
    }
  }

  return {
    jsonrpc: "2.0",
    id,
    error: {
      code: -32601,
      message: `Method not found: ${req.method}`,
    },
  };
}

