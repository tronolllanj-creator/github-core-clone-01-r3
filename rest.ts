import type { Store, Repo, User, Issue, Pull, Comment, Label } from "./store.ts";
import { hashObject, buildTree } from "./gitobj.ts";

export type RestResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
};

export type RestContext = {
  store: Store;
  viewerLogin: string;
  method: string;
  segments: string[];
  query: Record<string, string>;
  body: unknown;
  origin: string;
};

export function json(status: number, body: unknown, headers?: Record<string, string>): RestResponse {
  return { status, body, headers };
}

export function notFound(message?: string): RestResponse {
  return json(404, { message: message ?? "Not Found" });
}

export function badRequest(message: string): RestResponse {
  return json(400, { message });
}

export function unprocessable(message: string): RestResponse {
  return json(422, { message });
}

export function parsePagination(query: Record<string, string>): { page: number; perPage: number } {
  const p = parseInt(query.page ?? "1", 10);
  const page = isNaN(p) || p < 1 ? 1 : p;
  const pp = parseInt(query.per_page ?? "30", 10);
  const perPage = isNaN(pp) ? 30 : Math.max(1, Math.min(100, pp));
  return { page, perPage };
}

export function paginate<T>(
  items: T[],
  page: number,
  perPage: number
): { items: T[]; total: number; page: number; perPage: number; hasNext: boolean; hasPrev: boolean } {
  const total = items.length;
  const start = (page - 1) * perPage;
  const pageItems = items.slice(start, start + perPage);
  const hasNext = page * perPage < total;
  const hasPrev = page > 1;
  return { items: pageItems, total, page, perPage, hasNext, hasPrev };
}

export function linkHeader(
  origin: string,
  basePath: string,
  query: Record<string, string>,
  page: number,
  perPage: number,
  total: number
): string {
  if (total === 0) return "";
  const lastPage = Math.max(1, Math.ceil(total / perPage));

  const makeUrl = (p: number) => {
    const q = { ...query, page: String(p), per_page: String(perPage) };
    const params = new URLSearchParams(q);
    return `<${origin}${basePath}?${params.toString()}>`;
  };

  const links: string[] = [];
  if (page * perPage < total) {
    links.push(`${makeUrl(page + 1)}; rel="next"`);
  }
  links.push(`${makeUrl(lastPage)}; rel="last"`);
  links.push(`${makeUrl(1)}; rel="first"`);
  if (page > 1) {
    links.push(`${makeUrl(page - 1)}; rel="prev"`);
  }

  return links.join(", ");
}

function userId(store: Store, login: string): number {
  return store.users.get(login)?.id ?? 0;
}

function userType(store: Store, login: string): string {
  return store.users.get(login)?.type ?? "User";
}

export function repoJson(store: Store, repo: Repo): Record<string, unknown> {
  const openIssuesCount =
    Array.from(repo.issues.values()).filter((i) => i.state === "open").length +
    Array.from(repo.pulls.values()).filter((p) => p.state === "open").length;

  return {
    id: repo.id,
    node_id: "R_" + repo.id,
    name: repo.name,
    full_name: repo.fullName,
    owner: {
      login: repo.owner,
      id: userId(store, repo.owner),
      type: userType(store, repo.owner),
      avatar_url: "",
      html_url: "",
      url: "",
    },
    private: repo.private,
    html_url: "/" + repo.fullName,
    clone_url: "/" + repo.fullName + ".git",
    git_url: "/" + repo.fullName + ".git",
    ssh_url: "git@forge.invalid:" + repo.fullName + ".git",
    url: "/api/v3/repos/" + repo.fullName,
    description: repo.description,
    fork: false,
    created_at: repo.createdAt,
    updated_at: repo.updatedAt,
    pushed_at: repo.pushedAt,
    homepage: null,
    size: repo.objects.size,
    stargazers_count: 0,
    watchers_count: 0,
    language: null,
    has_issues: true,
    has_projects: false,
    has_downloads: true,
    has_wiki: false,
    has_pages: false,
    has_discussions: false,
    forks_count: 0,
    mirror_url: null,
    archived: false,
    disabled: false,
    open_issues_count: openIssuesCount,
    license: null,
    allow_forking: true,
    is_template: false,
    web_commit_signoff_required: false,
    topics: [],
    visibility: repo.private ? "private" : "public",
    forks: 0,
    open_issues: openIssuesCount,
    watchers: 0,
    default_branch: repo.defaultBranch,
  };
}

export function userJson(store: Store, user: User): Record<string, unknown> {
  const publicRepos = Array.from(store.repos.values()).filter(
    (r) => r.owner === user.login
  ).length;

  return {
    login: user.login,
    id: user.id,
    node_id: "U_" + user.id,
    avatar_url: "",
    gravatar_id: "",
    url: "/api/v3/users/" + user.login,
    html_url: "/" + user.login,
    followers_url: "",
    following_url: "",
    gists_url: "",
    starred_url: "",
    subscriptions_url: "",
    organizations_url: "",
    repos_url: "/api/v3/users/" + user.login + "/repos",
    events_url: "",
    received_events_url: "",
    type: user.type,
    site_admin: false,
    name: user.name,
    company: null,
    blog: null,
    location: null,
    email: user.email,
    hireable: null,
    bio: null,
    twitter_username: null,
    public_repos: publicRepos,
    public_gists: 0,
    followers: 0,
    following: 0,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
  };
}

export function labelJson(store: Store, repo: Repo, nameOrLabel: string | Label): Record<string, unknown> {
  let lbl: Label | undefined;
  let name: string;

  if (typeof nameOrLabel === "object") {
    lbl = nameOrLabel;
    name = lbl.name;
  } else {
    name = nameOrLabel;
    lbl = repo.labels.get(name);
  }

  if (lbl) {
    return {
      id: lbl.id,
      node_id: "L_" + lbl.id,
      url: "/api/v3/repos/" + repo.fullName + "/labels/" + encodeURIComponent(lbl.name),
      name: lbl.name,
      color: lbl.color,
      description: lbl.description,
      default: false,
    };
  }
  return {
    id: 0,
    node_id: "L_0",
    url: "",
    name: name,
    color: "000000",
    description: "",
    default: false,
  };
}

export function issueJson(store: Store, repo: Repo, issue: Issue): Record<string, unknown> {
  const userObj = {
    login: issue.user,
    id: userId(store, issue.user),
    type: "User",
  };
  const assigneeObj = issue.assignee
    ? {
        login: issue.assignee,
        id: userId(store, issue.assignee),
        type: "User",
      }
    : null;

  return {
    id: repo.id * 100000 + issue.number,
    node_id: "I_" + repo.id + "_" + issue.number,
    number: issue.number,
    title: issue.title,
    body: issue.body,
    state: issue.state,
    locked: false,
    user: userObj,
    labels: issue.labels.map((name) => labelJson(store, repo, name)),
    assignee: assigneeObj,
    assignees: assigneeObj ? [assigneeObj] : [],
    milestone: null,
    comments: issue.comments.length,
    created_at: issue.createdAt,
    updated_at: issue.updatedAt,
    closed_at: issue.closedAt,
    author_association: "OWNER",
    active_lock_reason: null,
    url: "/api/v3/repos/" + repo.fullName + "/issues/" + issue.number,
    html_url: "/" + repo.fullName + "/issues/" + issue.number,
    repository_url: "/api/v3/repos/" + repo.fullName,
    labels_url: "",
    comments_url: "",
    events_url: "",
    timeline_url: "",
  };
}

export function pullJson(store: Store, repo: Repo, pull: Pull): Record<string, unknown> {
  const userObj = {
    login: pull.user,
    id: userId(store, pull.user),
    type: "User",
  };
  const ownerObj = {
    login: repo.owner,
    id: userId(store, repo.owner),
    type: "User",
  };

  const isMergeable = computeMergeable(repo, pull);

  return {
    id: repo.id * 100000 + pull.number,
    node_id: "PR_" + repo.id + "_" + pull.number,
    number: pull.number,
    title: pull.title,
    body: pull.body,
    state: pull.merged ? "closed" : pull.state,
    locked: false,
    user: userObj,
    labels: [],
    assignee: null,
    assignees: [],
    milestone: null,
    comments: pull.comments.length,
    review_comments: 0,
    maintainer_can_modify: false,
    commits: 1,
    additions: 0,
    deletions: 0,
    changed_files: 0,
    created_at: pull.createdAt,
    updated_at: pull.updatedAt,
    closed_at: pull.closedAt,
    merged_at: pull.mergedAt,
    merge_commit_sha: pull.mergeCommitSha,
    merged: pull.merged,
    mergeable: isMergeable,
    mergeable_state: isMergeable ? "clean" : "blocked",
    merged_by: null,
    draft: false,
    head: {
      label: pull.user + ":" + pull.headRef,
      ref: pull.headRef,
      sha: pull.headSha,
      user: userObj,
      repo: repoJson(store, repo),
    },
    base: {
      label: repo.owner + ":" + pull.baseRef,
      ref: pull.baseRef,
      sha: pull.baseSha,
      user: ownerObj,
      repo: repoJson(store, repo),
    },
    url: "/api/v3/repos/" + repo.fullName + "/pulls/" + pull.number,
    html_url: "/" + repo.fullName + "/pull/" + pull.number,
    issue_url: "/api/v3/repos/" + repo.fullName + "/issues/" + pull.number,
    statuses_url: "",
    diff_url: "",
    patch_url: "",
    review_comment_url: "",
    comments_url: "",
    review_comments_url: "",
    commits_url: "",
    author_association: "OWNER",
    active_lock_reason: null,
  };
}

export function commentJson(
  store: Store,
  repo: Repo,
  kind: "issue" | "pull",
  number: number,
  comment: Comment
): Record<string, unknown> {
  const pathKind = kind === "issue" ? "issues" : "pulls";
  return {
    id: comment.id,
    node_id: "C_" + comment.id,
    url: "/api/v3/repos/" + repo.fullName + "/" + pathKind + "/" + number + "/comments/" + comment.id,
    body: comment.body,
    user: {
      login: comment.user,
      id: userId(store, comment.user),
      type: "User",
    },
    created_at: comment.createdAt,
    updated_at: comment.updatedAt,
    author_association: "OWNER",
  };
}

export function handleRepos(ctx: RestContext): RestResponse | null {
  const { store, viewerLogin, method, segments, query } = ctx;

  if (segments.length === 0 && method === "GET") {
    return json(200, {
      current_user_url: "/api/v3/user",
      repository_url: "/api/v3/repos/{owner}/{repo}",
      message: "GitHub-compatible API"
    }, {
      "X-OAuth-Scopes": "repo, user"
    });
  }

  if (segments.length === 1 && segments[0] === "meta" && method === "GET") {
    return json(200, {
      installed_version: "1.0.0",
      verifiable_password_authentication: true,
      ssh_key_fingerprints: {},
      hooks: [],
      git: [],
      importer: []
    });
  }


  if (segments.length === 1 && segments[0] === "user") {
    if (method === "GET") {
      const user = store.users.get(viewerLogin);
      if (!user) return notFound("User not found");
      return json(200, userJson(store, user));
    }
  }

  if (segments.length === 2 && segments[0] === "users") {
    if (method === "GET") {
      const login = segments[1];
      const user = store.users.get(login);
      if (!user) return notFound("User not found");
      return json(200, userJson(store, user));
    }
  }

  if (segments.length === 2 && segments[0] === "user" && segments[1] === "repos") {
    if (method === "POST") {
      const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) {
        return unprocessable("name is required");
      }
      if (store.getRepo(viewerLogin, name)) {
        return unprocessable("already exists");
      }
      const repo = store.createRepo(viewerLogin, name, {
        description: typeof body.description === "string" ? body.description : undefined,
        private: typeof body.private === "boolean" ? body.private : undefined,
        defaultBranch: typeof body.default_branch === "string" ? body.default_branch : undefined,
      });
      return json(201, repoJson(store, repo));
    }
    if (method === "GET") {
      const userRepos = Array.from(store.repos.values()).filter((r) => r.owner === viewerLogin);
      userRepos.sort((a, b) => {
        const c = a.createdAt.localeCompare(b.createdAt);
        return c !== 0 ? c : a.id - b.id;
      });
      if (query.direction === "desc") {
        userRepos.reverse();
      }
      const { page, perPage } = parsePagination(query);
      const paged = paginate(userRepos, page, perPage);
      const items = paged.items.map((r) => repoJson(store, r));
      const link = linkHeader(ctx.origin, "/api/v3/user/repos", query, page, perPage, paged.total);
      const headers: Record<string, string> = { "X-Total-Count": String(paged.total) };
      if (link) {
        headers["Link"] = link;
      }
      return json(200, items, headers);
    }
  }

  if (segments.length === 3 && segments[0] === "users" && segments[2] === "repos") {
    if (method === "GET") {
      const login = segments[1];
      if (!store.users.has(login)) {
        return notFound("User not found");
      }
      const userRepos = Array.from(store.repos.values()).filter((r) => r.owner === login);
      userRepos.sort((a, b) => {
        const c = a.createdAt.localeCompare(b.createdAt);
        return c !== 0 ? c : a.id - b.id;
      });
      if (query.direction === "desc") {
        userRepos.reverse();
      }
      const { page, perPage } = parsePagination(query);
      const paged = paginate(userRepos, page, perPage);
      const items = paged.items.map((r) => repoJson(store, r));
      const basePath = "/api/v3/users/" + login + "/repos";
      const link = linkHeader(ctx.origin, basePath, query, page, perPage, paged.total);
      const headers: Record<string, string> = { "X-Total-Count": String(paged.total) };
      if (link) {
        headers["Link"] = link;
      }
      return json(200, items, headers);
    }
  }

  if (segments.length === 3 && segments[0] === "repos") {
    const owner = segments[1];
    const name = segments[2];
    const repo = store.getRepo(owner, name);

    if (method === "GET") {
      if (!repo) return notFound();
      return json(200, repoJson(store, repo));
    }
    if (method === "PATCH") {
      if (!repo || repo.owner !== viewerLogin) return notFound();
      const body = ctx.body && typeof ctx.body === "object" ? (ctx.body as Record<string, unknown>) : {};
      if (typeof body.description === "string") {
        repo.description = body.description;
      }
      if (typeof body.private === "boolean") {
        repo.private = body.private;
      }
      if (typeof body.default_branch === "string") {
        repo.defaultBranch = body.default_branch;
      }
      repo.updatedAt = new Date().toISOString();
      return json(200, repoJson(store, repo));
    }
    if (method === "DELETE") {
      if (!repo || repo.owner !== viewerLogin) return notFound();
      store.repos.delete(repo.fullName);
      return json(204, null);
    }
  }

  return null;
}

function bodyObj(ctx: RestContext): Record<string, unknown> {
  if (typeof ctx.body === "object" && ctx.body !== null && !Array.isArray(ctx.body)) {
    return ctx.body as Record<string, unknown>;
  }
  return {};
}

function strField(o: Record<string, unknown>, key: string): string | undefined {
  const val = o[key];
  return typeof val === "string" ? val : undefined;
}

function strArrayField(o: Record<string, unknown>, key: string): string[] | undefined {
  const val = o[key];
  if (Array.isArray(val) && val.every((x) => typeof x === "string")) {
    return val as string[];
  }
  return undefined;
}

function getRepoOr404(ctx: RestContext): Repo | null {
  if (ctx.segments.length < 3 || ctx.segments[0] !== "repos") return null;
  const owner = ctx.segments[1];
  const name = ctx.segments[2];
  const repo = ctx.store.getRepo(owner, name);
  if (!repo || repo.owner !== ctx.viewerLogin) return null;
  return repo;
}

function parseCommitLocal(data: Uint8Array): {
  tree: string;
  parents: string[];
  author: string;
  committer: string;
  message: string;
} {
  const text = new TextDecoder().decode(data);
  const blankLineIdx = text.indexOf("\n\n");
  const headerStr = blankLineIdx !== -1 ? text.substring(0, blankLineIdx) : text;
  const message = blankLineIdx !== -1 ? text.substring(blankLineIdx + 2) : "";

  const lines = headerStr.split("\n");
  let tree = "";
  const parents: string[] = [];
  let author = "";
  let committer = "";

  for (const line of lines) {
    if (line.startsWith("tree ")) {
      tree = line.substring(5).trim();
    } else if (line.startsWith("parent ")) {
      parents.push(line.substring(7).trim());
    } else if (line.startsWith("author ")) {
      author = line.substring(7).trim();
    } else if (line.startsWith("committer ")) {
      committer = line.substring(10).trim();
    }
  }

  return { tree, parents, author, committer, message };
}

function authorLineParts(s: string): { name: string; email: string; date: string } {
  const match = s.match(/^(.*?)\s*<([^>]+)>\s*(\d+)\s+.*$/);
  if (match) {
    const name = match[1];
    const email = match[2];
    const unix = parseInt(match[3], 10);
    const date = isNaN(unix) ? new Date().toISOString() : new Date(unix * 1000).toISOString();
    return { name, email, date };
  }
  return { name: s || "unknown", email: "", date: new Date().toISOString() };
}

function parseTreeLocal(data: Uint8Array): Array<{
  mode: string;
  name: string;
  oid: string;
  type: "blob" | "tree";
}> {
  const result: Array<{ mode: string; name: string; oid: string; type: "blob" | "tree" }> = [];
  let pos = 0;
  while (pos < data.length) {
    const spaceIdx = data.indexOf(32, pos);
    if (spaceIdx === -1) break;
    const mode = new TextDecoder().decode(data.subarray(pos, spaceIdx));
    const nullIdx = data.indexOf(0, spaceIdx + 1);
    if (nullIdx === -1) break;
    const name = new TextDecoder().decode(data.subarray(spaceIdx + 1, nullIdx));
    pos = nullIdx + 1;
    if (pos + 20 > data.length) break;
    const shaBytes = data.subarray(pos, pos + 20);
    const oid = Array.from(shaBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    pos += 20;
    const type = mode === "40000" ? "tree" : "blob";
    result.push({ mode, name, oid, type });
  }
  return result;
}

function walkTreeRecursive(
  repo: Repo,
  treeSha: string,
  currentPath = ""
): Map<string, { mode: string; oid: string; type: "blob" | "tree" }> {
  const map = new Map<string, { mode: string; oid: string; type: "blob" | "tree" }>();
  const data = repo.objects.get(treeSha)?.data;
  if (!data) return map;
  const entries = parseTreeLocal(data);
  for (const entry of entries) {
    const fullPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
    map.set(fullPath, entry);
    if (entry.type === "tree") {
      const subMap = walkTreeRecursive(repo, entry.oid, fullPath);
      for (const [k, v] of subMap.entries()) {
        map.set(k, v);
      }
    }
  }
  return map;
}

function computeMergeable(repo: Repo, pull: Pull): boolean {
  try {
    // Resolve the CURRENT branch refs: the stored baseSha goes stale when the
    // base branch advances (e.g. after another PR merges), which would hide a
    // real conflict. Fall back to the stored shas if a ref is missing.
    const baseSha = repo.refs.get("refs/heads/" + pull.baseRef) ?? pull.baseSha;
    const headSha = repo.refs.get("refs/heads/" + pull.headRef) ?? pull.headSha;
    if (!baseSha || !headSha) return true;

    const getCommitAncestors = (startSha: string): Set<string> => {
      const visited = new Set<string>();
      const queue = [startSha];
      while (queue.length > 0) {
        const sha = queue.shift()!;
        if (visited.has(sha)) continue;
        visited.add(sha);
        const obj = repo.objects.get(sha);
        if (!obj || obj.type !== "commit") continue;
        const commit = parseCommitLocal(obj.data);
        if (commit && commit.parents) {
          for (const p of commit.parents) {
            if (!visited.has(p)) queue.push(p);
          }
        }
      }
      return visited;
    };

    const baseAncestors = getCommitAncestors(baseSha);
    let mergeBaseSha: string | null = null;

    const headQueue = [headSha];
    const headVisited = new Set<string>();
    while (headQueue.length > 0) {
      const sha = headQueue.shift()!;
      if (headVisited.has(sha)) continue;
      headVisited.add(sha);
      if (baseAncestors.has(sha)) {
        mergeBaseSha = sha;
        break;
      }
      const obj = repo.objects.get(sha);
      if (!obj || obj.type !== "commit") continue;
      const commit = parseCommitLocal(obj.data);
      if (commit && commit.parents) {
        for (const p of commit.parents) {
          if (!headVisited.has(p)) headQueue.push(p);
        }
      }
    }

    if (!mergeBaseSha) return true;

    const getFileMap = (commitSha: string): Map<string, string> => {
      const map = new Map<string, string>();
      const obj = repo.objects.get(commitSha);
      if (!obj || obj.type !== "commit") return map;
      const commit = parseCommitLocal(obj.data);
      if (!commit || !commit.tree) return map;
      const treeMap = walkTreeRecursive(repo, commit.tree);
      for (const [path, entry] of treeMap.entries()) {
        if (entry.type === "blob") {
          map.set(path, entry.oid);
        }
      }
      return map;
    };

    const mapBase = getFileMap(mergeBaseSha);
    const mapTarget = getFileMap(baseSha);
    const mapHead = getFileMap(headSha);

    const allPaths = new Set([...mapBase.keys(), ...mapTarget.keys(), ...mapHead.keys()]);

    for (const path of allPaths) {
      const baseOid = mapBase.get(path) || "";
      const targetOid = mapTarget.get(path) || "";
      const headOid = mapHead.get(path) || "";

      const changedInTarget = targetOid !== baseOid;
      const changedInHead = headOid !== baseOid;

      if (changedInTarget && changedInHead) {
        if (targetOid !== headOid) {
          return false;
        }
      }
    }

    return true;
  } catch {
    return true;
  }
}

export function handleIssuesPulls(ctx: RestContext): RestResponse | null {
  const { segments, store, viewerLogin, method, query, body, origin } = ctx;
  if (segments.length < 3 || segments[0] !== "repos") return null;

  const sub = segments.slice(3);
  if (sub.length === 0) return null;

  const section = sub[0];
  const knownSections = ["issues", "labels", "pulls", "contents", "branches", "commits", "git"];
  if (!knownSections.includes(section)) return null;

  const owner = segments[1];
  const name = segments[2];
  const repo = getRepoOr404(ctx);
  if (!repo) return notFound();

  // Helper to build issue list response
  function respondIssueList(list: Issue[]): RestResponse {
    const { page, perPage } = parsePagination(ctx);
    const paged = paginate(list, page, perPage);
    const basePath = `/api/v3/repos/${owner}/${name}/issues`;
    return {
      status: 200,
      headers: {
        ...linkHeader(origin, basePath, query, page, perPage, list.length),
        "X-Total-Count": String(list.length),
      },
      body: paged.items.map((i) => issueJson(store, repo, i)),
    };
  }

  // Helper to build comment list response
  function respondCommentList(comments: Comment[], issueNumber: number): RestResponse {
    const { page, perPage } = parsePagination(ctx);
    const paged = paginate(comments, page, perPage);
    const basePath = `/api/v3/repos/${owner}/${name}/issues/${issueNumber}/comments`;
    return {
      status: 200,
      headers: {
        ...linkHeader(origin, basePath, query, page, perPage, comments.length),
        "X-Total-Count": String(comments.length),
      },
      body: paged.items.map((c) => commentJson(store, repo, "issue", issueNumber, c)),
    };
  }

  // Helper to validate labels array
  function validateLabels(labels: string[]): string | null {
    for (const l of labels) {
      if (!repo.labels.has(l)) return `label does not exist: ${l}`;
    }
    return null;
  }

  // Helper to validate assignee
  function validateAssignee(assignee: string | null): string | null {
    if (assignee !== null && !store.users.has(assignee)) {
      return "assignee does not exist";
    }
    return null;
  }

  // ISSUES
  if (section === "issues") {
    if (sub.length === 1) {
      if (method === "GET") {
        let list = Array.from(repo.issues.values());
        const state = query["state"] ?? "open";
        if (state !== "all") {
          list = list.filter((i) => i.state === state);
        }
        const reqLabels = query["labels"];
        if (reqLabels) {
          const names = reqLabels.split(",").map((l) => l.trim()).filter(Boolean);
          list = list.filter((i) => names.every((n) => i.labels.includes(n)));
        }
        const assignee = query["assignee"];
        if (assignee) {
          if (assignee === "none") {
            list = list.filter((i) => i.assignee === null);
          } else {
            list = list.filter((i) => i.assignee === assignee);
          }
        }
        const sort = query["sort"] ?? "created";
        const dir = query["direction"] ?? "desc";
        list = [...list].sort((a, b) => {
          let cmp = 0;
          if (sort === "updated") {
            cmp = a.updatedAt.localeCompare(b.updatedAt);
          } else if (sort === "comments") {
            cmp = a.comments.length - b.comments.length;
          } else {
            cmp = a.createdAt.localeCompare(b.createdAt);
          }
          if (cmp === 0) cmp = a.number - b.number;
          return dir === "asc" ? cmp : -cmp;
        });
        return respondIssueList(list);
      }
      if (method === "POST") {
        const b = bodyObj(ctx);
        const title = strField(b, "title");
        if (!title || title.trim() === "") return unprocessable("title is required");
        const bodyStr = strField(b, "body") ?? "";
        const labels = strArrayField(b, "labels") ?? [];
        const assigneeVal = b.assignee === null ? null : (strField(b, "assignee") ?? null);

        const labelErr = validateLabels(labels);
        if (labelErr) return unprocessable(labelErr);
        const assigneeErr = validateAssignee(assigneeVal);
        if (assigneeErr) return unprocessable(assigneeErr);

        const issue: Issue = {
          number: repo.issueSeq++,
          title,
          body: bodyStr,
          state: "open",
          labels: [...labels],
          assignee: assigneeVal,
          user: viewerLogin,
          createdAt: store.tick(),
          updatedAt: store.tick(),
          closedAt: null,
          comments: [],
          locked: false,
        };
        repo.issues.set(issue.number, issue);
        return json(201, issueJson(store, repo, issue));
      }
    }

    if (sub.length >= 2) {
      const num = parseInt(sub[1], 10);
      if (isNaN(num) || String(num) !== sub[1]) return notFound();
      const issue = repo.issues.get(num);
      if (!issue) return notFound();

      if (sub.length === 2) {
        if (method === "GET") return json(200, issueJson(store, repo, issue));
        if (method === "PATCH") {
          const b = bodyObj(ctx);
          const title = strField(b, "title");
          const bodyStr = strField(b, "body");
          const state = strField(b, "state");
          const labels = strArrayField(b, "labels");
          const assigneeVal = b.assignee;

          if (state !== undefined && state !== "open" && state !== "closed") {
            return unprocessable("invalid state");
          }
          if (labels !== undefined) {
            const labelErr = validateLabels(labels);
            if (labelErr) return unprocessable(labelErr);
          }
          if (assigneeVal !== undefined && assigneeVal !== null) {
            const assStr = typeof assigneeVal === "string" ? assigneeVal : "";
            if (!store.users.has(assStr)) return unprocessable("assignee does not exist");
          }

          if (title !== undefined) issue.title = title;
          if (bodyStr !== undefined) issue.body = bodyStr;
          if (state !== undefined) {
            if (state === "closed" && issue.state !== "closed") {
              issue.state = "closed";
              issue.closedAt = store.tick();
            } else if (state === "open" && issue.state !== "open") {
              issue.state = "open";
              issue.closedAt = null;
            }
          }
          if (labels !== undefined) issue.labels = [...labels];
          if (assigneeVal !== undefined) {
            issue.assignee = assigneeVal === null ? null : String(assigneeVal);
          }
          issue.updatedAt = store.tick();
          return json(200, issueJson(store, repo, issue));
        }
      }

      if (sub.length === 3 && sub[2] === "comments") {
        if (method === "GET") {
          return respondCommentList(issue.comments, issue.number);
        }
        if (method === "POST") {
          const b = bodyObj(ctx);
          const bodyText = strField(b, "body");
          if (!bodyText || bodyText.trim() === "") return unprocessable("body is required");
          const comment: Comment = {
            id: store.nextCommentId(repo),
            body: bodyText,
            user: viewerLogin,
            createdAt: store.tick(),
            updatedAt: store.tick(),
          };
          issue.comments.push(comment);
          return json(201, commentJson(store, repo, "issue", issue.number, comment));
        }
      }

      if (sub.length === 3 && sub[2] === "labels") {
        if (method === "GET") {
          const list = issue.labels.map(
            (l) => labelJson(store, repo, repo.labels.get(l) ?? { id: 0, name: l, color: "000000", description: "" })
          );
          return json(200, list);
        }
        if (method === "POST") {
          let newLabels: string[] = [];
          if (Array.isArray(body) && body.every((x) => typeof x === "string")) {
            newLabels = body as string[];
          } else {
            const b = bodyObj(ctx);
            newLabels = strArrayField(b, "labels") ?? [];
          }
          const labelErr = validateLabels(newLabels);
          if (labelErr) return unprocessable(labelErr);
          issue.labels = [...newLabels];
          const list = issue.labels.map((l) => labelJson(store, repo, repo.labels.get(l)!));
          return json(200, list);
        }
      }

      if (sub.length === 4 && sub[2] === "labels" && method === "DELETE") {
        const labelName = decodeURIComponent(sub[3]);
        issue.labels = issue.labels.filter((l) => l !== labelName);
        const list = issue.labels.map(
          (l) => labelJson(store, repo, repo.labels.get(l) ?? { id: 0, name: l, color: "000000", description: "" })
        );
        return json(200, list);
      }
    }
  }

  // LABELS
  if (section === "labels") {
    if (sub.length === 1) {
      if (method === "GET") {
        const list = Array.from(repo.labels.values()).sort((a, b) => a.name.localeCompare(b.name));
        const { page, perPage } = parsePagination(ctx);
        const paged = paginate(list, page, perPage);
        const basePath = `/api/v3/repos/${owner}/${name}/labels`;
        return {
          status: 200,
          headers: {
            ...linkHeader(origin, basePath, query, page, perPage, list.length),
            "X-Total-Count": String(list.length),
          },
          body: paged.items.map((l) => labelJson(store, repo, l)),
        };
      }
      if (method === "POST") {
        const b = bodyObj(ctx);
        const nameStr = strField(b, "name");
        if (!nameStr || nameStr.trim() === "") return unprocessable("name is required");
        if (repo.labels.has(nameStr)) return unprocessable("label already exists");
        let color = strField(b, "color") ?? "000000";
        if (color.startsWith("#")) color = color.substring(1);
        if (!/^[0-9a-fA-F]{6}$/.test(color)) return unprocessable("invalid color");
        const description = strField(b, "description") ?? "";
        const label: Label = { id: store.nextLabelId(repo), name: nameStr, color, description };
        repo.labels.set(nameStr, label);
        return json(201, labelJson(store, repo, label));
      }
    }

    if (sub.length === 2) {
      const nameStr = decodeURIComponent(sub[1]);
      const label = repo.labels.get(nameStr);
      if (!label) return notFound();

      if (method === "GET") return json(200, labelJson(store, repo, label));
      if (method === "PATCH") {
        const b = bodyObj(ctx);
        const newName = strField(b, "name");
        const newColorRaw = strField(b, "color");
        const newDesc = strField(b, "description");
        if (newName !== undefined && newName !== nameStr) {
          if (newName.trim() === "") return unprocessable("name is required");
          if (repo.labels.has(newName)) return unprocessable("label already exists");
        }
        let processedColor: string | undefined;
        if (newColorRaw !== undefined) {
          processedColor = newColorRaw.startsWith("#") ? newColorRaw.substring(1) : newColorRaw;
          if (!/^[0-9a-fA-F]{6}$/.test(processedColor)) return unprocessable("invalid color");
        }
        if (newName !== undefined && newName !== nameStr) {
          repo.labels.delete(nameStr);
          label.name = newName;
          repo.labels.set(newName, label);
          for (const issue of repo.issues.values()) {
            issue.labels = issue.labels.map((l) => (l === nameStr ? newName : l));
          }
        }
        if (processedColor !== undefined) label.color = processedColor;
        if (newDesc !== undefined) label.description = newDesc;
        return json(200, labelJson(store, repo, label));
      }
      if (method === "DELETE") {
        repo.labels.delete(nameStr);
        for (const issue of repo.issues.values()) {
          issue.labels = issue.labels.filter((l) => l !== nameStr);
        }
        return json(204, null);
      }
    }
  }

  // PULLS
  if (section === "pulls") {
    if (sub.length === 1) {
      if (method === "GET") {
        let list = Array.from(repo.pulls.values());
        const state = ctx.query["state"] ?? "open";
        if (state !== "all") {
          list = list.filter((p) => p.state === state);
        }
        const sort = ctx.query["sort"] ?? "created";
        const dir = ctx.query["direction"] ?? "desc";
        list = [...list].sort((a, b) => {
          let cmp = 0;
          if (sort === "updated") {
            cmp = a.updatedAt.localeCompare(b.updatedAt);
          } else {
            cmp = a.createdAt.localeCompare(b.createdAt);
          }
          if (cmp === 0) cmp = a.number - b.number;
          return dir === "asc" ? cmp : -cmp;
        });
        const { page, perPage } = parsePagination(ctx);
        const paged = paginate(list, page, perPage);
        const basePath = `/api/v3/repos/${owner}/${name}/pulls`;
        return {
          status: 200,
          headers: {
            ...linkHeader(ctx.origin, basePath, ctx.query, page, perPage, list.length),
            "X-Total-Count": String(list.length),
          },
          body: paged.items.map((p) => pullJson(store, repo, p)),
        };
      }
      if (method === "POST") {
        const b = bodyObj(ctx);
        const title = strField(b, "title");
        if (!title || title.trim() === "") return unprocessable("title is required");
        const head = strField(b, "head");
        if (!head || head.trim() === "") return unprocessable("head is required");
        const base = strField(b, "base");
        if (!base || base.trim() === "") return unprocessable("base is required");
        const bodyStr = strField(b, "body") ?? "";

        const headSha = repo.refs.get("refs/heads/" + head);
        if (!headSha) return unprocessable(`branch does not exist: ${head}`);
        const baseSha = repo.refs.get("refs/heads/" + base);
        if (!baseSha) return unprocessable(`branch does not exist: ${base}`);
        if (head === base) return unprocessable("head and base are the same");

        const pull: Pull = {
          number: repo.pullSeq++,
          title,
          body: bodyStr,
          state: "open",
          merged: false,
          headRef: head,
          headSha,
          baseRef: base,
          baseSha,
          mergeCommitSha: null,
          user: viewerLogin,
          createdAt: store.tick(),
          updatedAt: store.tick(),
          closedAt: null,
          mergedAt: null,
          mergeable: true,
          comments: [],
        };
        repo.pulls.set(pull.number, pull);
        return json(201, pullJson(store, repo, pull));
      }
    }

    if (sub.length >= 2) {
      const num = parseInt(sub[1], 10);
      if (isNaN(num) || String(num) !== sub[1]) return notFound();
      const pull = repo.pulls.get(num);
      if (!pull) return notFound();

      if (sub.length === 2) {
        if (method === "GET") return json(200, pullJson(store, repo, pull));
        if (method === "PATCH") {
          const b = bodyObj(ctx);
          const title = strField(b, "title");
          const bodyStr = strField(b, "body");
          const state = strField(b, "state");
          if (state !== undefined && state !== "open" && state !== "closed") {
            return unprocessable("invalid state");
          }
          if (title !== undefined) pull.title = title;
          if (bodyStr !== undefined) pull.body = bodyStr;
          if (state !== undefined) {
            if (state === "closed" && pull.state !== "closed") {
              pull.state = "closed";
              pull.closedAt = store.tick();
            } else if (state === "open" && pull.state !== "open") {
              pull.state = "open";
              pull.closedAt = null;
            }
          }
          pull.updatedAt = store.tick();
          return json(200, pullJson(store, repo, pull));
        }
      }

      if (sub.length === 3 && sub[2] === "files" && method === "GET") {
        const baseData = repo.objects.get(pull.baseSha)?.data;
        const headData = repo.objects.get(pull.headSha)?.data;
        if (!baseData || !headData) return notFound();
        const baseTreeSha = parseCommitLocal(baseData).tree;
        const headTreeSha = parseCommitLocal(headData).tree;
        const baseMap = walkTreeRecursive(repo, baseTreeSha);
        const headMap = walkTreeRecursive(repo, headTreeSha);

        const files: Array<Record<string, unknown>> = [];
        const allPaths = new Set([...baseMap.keys(), ...headMap.keys()]);
        for (const path of allPaths) {
          const inBase = baseMap.get(path);
          const inHead = headMap.get(path);
          const isBlob = (inHead && inHead.type === "blob") || (inBase && inBase.type === "blob");
          if (!isBlob) continue;
          const lineCount = (oid: string): number => {
            const d = repo.objects.get(oid)?.data;
            if (!d) return 0;
            const text = new TextDecoder().decode(d);
            if (text === "") return 0;
            return text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
          };
          const lineDiff = (oldOid: string, newOid: string): { additions: number; deletions: number } => {
            const oldD = repo.objects.get(oldOid)?.data;
            const newD = repo.objects.get(newOid)?.data;
            const oldLines = oldD ? new TextDecoder().decode(oldD).split("\n") : [];
            const newLines = newD ? new TextDecoder().decode(newD).split("\n") : [];
            const oldSet = new Set(oldLines);
            const newSet = new Set(newLines);
            let additions = 0;
            for (const l of newLines) if (!oldSet.has(l)) additions++;
            let deletions = 0;
            for (const l of oldLines) if (!newSet.has(l)) deletions++;
            return { additions, deletions };
          };
          if (inHead && !inBase) {
            const additions = lineCount(inHead.oid);
            files.push({ sha: inHead.oid, filename: path, status: "added", additions, deletions: 0, changes: additions, blob_url: "", raw_url: "", contents_url: "", patch: "" });
          } else if (inBase && !inHead) {
            const deletions = lineCount(inBase.oid);
            files.push({ sha: inBase.oid, filename: path, status: "removed", additions: 0, deletions, changes: deletions, blob_url: "", raw_url: "", contents_url: "", patch: "" });
          } else if (inBase && inHead && inBase.oid !== inHead.oid) {
            const { additions, deletions } = lineDiff(inBase.oid, inHead.oid);
            files.push({ sha: inHead.oid, filename: path, status: "modified", additions, deletions, changes: additions + deletions, blob_url: "", raw_url: "", contents_url: "", patch: "" });
          }
        }
        return {
          status: 200,
          headers: { "X-Total-Count": String(files.length) },
          body: files,
        };
      }

      if (sub.length === 3 && sub[2] === "commits" && method === "GET") {
        const baseSet = new Set<string>();
        const qBase = [pull.baseSha];
        while (qBase.length > 0) {
          const s = qBase.shift()!;
          if (baseSet.has(s)) continue;
          baseSet.add(s);
          const d = repo.objects.get(s)?.data;
          if (d) qBase.push(...parseCommitLocal(d).parents);
        }
        const commitsList: Array<{ sha: string; parsed: ReturnType<typeof parseCommitLocal> }> = [];
        const visited = new Set<string>();
        const qHead = [pull.headSha];
        while (qHead.length > 0) {
          const s = qHead.shift()!;
          if (!s || visited.has(s) || baseSet.has(s)) continue;
          visited.add(s);
          const d = repo.objects.get(s)?.data;
          if (d) {
            const parsed = parseCommitLocal(d);
            commitsList.push({ sha: s, parsed });
            qHead.push(...parsed.parents);
          }
        }
        commitsList.reverse();
        const res = commitsList.map((c) => ({
          sha: c.sha,
          commit: {
            message: c.parsed.message,
            author: authorLineParts(c.parsed.author),
            committer: authorLineParts(c.parsed.committer),
          },
          author: null,
          committer: null,
          parents: c.parsed.parents.map((p) => ({ sha: p })),
        }));
        return json(200, res);
      }

      if (sub.length === 3 && sub[2] === "merge" && (method === "PUT" || method === "POST")) {
        if (pull.merged || pull.state === "closed") {
          return unprocessable("pull request is already merged/closed");
        }
        const mergeableNow = computeMergeable(repo, pull);
        pull.mergeable = mergeableNow;
        if (!mergeableNow) {
          return json(405, { message: "Merge conflict" });
        }
        repo.refs.set("refs/heads/" + pull.baseRef, pull.headSha);
        pull.merged = true;
        pull.state = "closed";
        pull.mergedAt = store.tick();
        pull.closedAt = pull.mergedAt;
        pull.mergeCommitSha = pull.headSha;
        pull.updatedAt = pull.mergedAt;
        return json(200, {
          merged: true,
          message: "Pull Request successfully merged",
          sha: pull.headSha,
        });
      }

      if (sub.length === 3 && sub[2] === "reviews") {
        if (method === "GET") return json(200, []);
        if (method === "POST") {
          const b = bodyObj(ctx);
          const bodyText = strField(b, "body") ?? "";
          return json(201, {
            id: store.nextCommentId(repo),
            state: "APPROVED",
            body: bodyText,
            user: { login: viewerLogin },
            submitted_at: store.tick(),
          });
        }
      }

      if (sub.length === 3 && sub[2] === "comments") {
        if (method === "GET") {
          const { page, perPage } = parsePagination(ctx);
          const paged = paginate(pull.comments, page, perPage);
          const basePath = `/api/v3/repos/${owner}/${name}/pulls/${pull.number}/comments`;
          return {
            status: 200,
            headers: {
              ...linkHeader(ctx.origin, basePath, ctx.query, page, perPage, pull.comments.length),
              "X-Total-Count": String(pull.comments.length),
            },
            body: paged.items.map((c) => commentJson(store, repo, "pull", pull.number, c)),
          };
        }
        if (method === "POST") {
          const b = bodyObj(ctx);
          const bodyText = strField(b, "body");
          if (!bodyText || bodyText.trim() === "") return unprocessable("body is required");
          const comment: Comment = {
            id: store.nextCommentId(repo),
            body: bodyText,
            user: viewerLogin,
            createdAt: store.tick(),
            updatedAt: store.tick(),
          };
          pull.comments.push(comment);
          return json(201, commentJson(store, repo, "pull", pull.number, comment));
        }
      }
    }
  }

  // CONTENTS
  if (section === "contents" && method === "GET") {
    const filePath = sub.slice(1).map(decodeURIComponent).join("/");
    const defaultBranch = repo.defaultBranch || "main";
    const refSha = repo.refs.get("refs/heads/" + defaultBranch);
    if (!refSha) return notFound();
    const commitData = repo.objects.get(refSha)?.data;
    if (!commitData) return notFound();
    const rootTreeSha = parseCommitLocal(commitData).tree;

    if (filePath === "") {
      const treeData = repo.objects.get(rootTreeSha)?.data;
      if (!treeData) return notFound();
      const entries = parseTreeLocal(treeData).sort((a, b) => a.name.localeCompare(b.name));
      const res = entries.map((e) => ({
        type: e.type === "tree" ? "dir" : "file",
        name: e.name,
        path: e.name,
        sha: e.oid,
        size: e.type === "tree" ? 0 : (repo.objects.get(e.oid)?.data?.length ?? 0),
        url: "",
        html_url: "",
        git_url: "",
        download_url: null,
        _links: { self: "", git: "", html: "" },
      }));
      return json(200, res);
    } else {
      const parts = filePath.split("/");
      let currSha = rootTreeSha;
      let targetEntry: { mode: string; name: string; oid: string; type: "blob" | "tree" } | null = null;
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const tData = repo.objects.get(currSha)?.data;
        if (!tData) return notFound();
        const entries = parseTreeLocal(tData);
        const found = entries.find((e) => e.name === p);
        if (!found) return notFound();
        if (i === parts.length - 1) {
          targetEntry = found;
        } else {
          if (found.type !== "tree") return notFound();
          currSha = found.oid;
        }
      }
      if (!targetEntry) return notFound();
      if (targetEntry.type === "tree") {
        const tData = repo.objects.get(targetEntry.oid)?.data;
        if (!tData) return notFound();
        const entries = parseTreeLocal(tData).sort((a, b) => a.name.localeCompare(b.name));
        const res = entries.map((e) => ({
          type: e.type === "tree" ? "dir" : "file",
          name: e.name,
          path: filePath + "/" + e.name,
          sha: e.oid,
          size: e.type === "tree" ? 0 : (repo.objects.get(e.oid)?.data?.length ?? 0),
          url: "",
          html_url: "",
          git_url: "",
          download_url: null,
          _links: { self: "", git: "", html: "" },
        }));
        return json(200, res);
      } else {
        const blobData = repo.objects.get(targetEntry.oid)?.data;
        if (!blobData) return notFound();
        const b64 = Buffer.from(blobData).toString("base64");
        return json(200, {
          type: "file",
          name: targetEntry.name,
          path: filePath,
          sha: targetEntry.oid,
          size: blobData.length,
          url: "",
          html_url: "",
          git_url: "",
          download_url: null,
          content: b64,
          encoding: "base64",
          _links: { self: "", git: "", html: "" },
        });
      }
    }
  }
function makeCommit(repo: Repo, treeSha: string, parents: string[], message: string, authorName: string, authorEmail: string, unix: number): string {
  let header = `tree ${treeSha}\n`;
  for (const p of parents) {
    header += `parent ${p}\n`;
  }
  header += `author ${authorName} <${authorEmail}> ${unix} +0000\n`;
  header += `committer ${authorName} <${authorEmail}> ${unix} +0000\n\n`;
  const text = header + message;
  const data = new TextEncoder().encode(text);
  const oid = hashObject("commit", data);
  repo.objects.set(oid, { type: "commit", data });
  return oid;
}

function setPathInTree(repo: Repo, rootTreeSha: string | null, parts: string[], blobSha: string | null, mode: string = "100644"): string {
  function traverse(currentSha: string | null, pathParts: string[], isRoot: boolean): string | null {
    let entries: Array<{ mode: string; name: string; oid: string; type: "blob" | "tree" }> = [];
    if (currentSha) {
      const obj = repo.objects.get(currentSha);
      if (!obj || obj.type !== "tree") {
        throw new Error("a parent path is a blob");
      }
      entries = parseTreeLocal(obj.data);
    }
    const headName = pathParts[0];
    const isLeaf = pathParts.length === 1;

    if (isLeaf) {
      if (blobSha === null) {
        entries = entries.filter(e => e.name !== headName);
      } else {
        const idx = entries.findIndex(e => e.name === headName);
        if (idx !== -1 && entries[idx].type === "tree") {
          throw new Error("path is a directory");
        }
        const newEntry = { mode: mode || "100644", name: headName, oid: blobSha, type: "blob" as const };
        if (idx >= 0) {
          entries[idx] = newEntry;
        } else {
          entries.push(newEntry);
        }
      }
    } else {
      const idx = entries.findIndex(e => e.name === headName);
      let childSha: string | null = null;
      if (idx !== -1) {
        if (entries[idx].type !== "tree") {
          throw new Error("a parent path is a blob");
        }
        childSha = entries[idx].oid;
      }
      const newChildSha = traverse(childSha, pathParts.slice(1), false);
      if (newChildSha === null) {
        if (idx !== -1) {
          entries.splice(idx, 1);
        }
      } else {
        const childEntry = { mode: "40000", name: headName, oid: newChildSha, type: "tree" as const };
        if (idx !== -1) {
          entries[idx] = childEntry;
        } else {
          entries.push(childEntry);
        }
      }
    }

    if (entries.length === 0 && !isRoot && blobSha === null) {
      return null;
    }

    const treeData = buildTree(entries.map(e => ({ mode: e.mode, name: e.name, oid: e.oid })));
    const treeSha = hashObject("tree", treeData);
    repo.objects.set(treeSha, { type: "tree", data: treeData });
    return treeSha;
  }

  return traverse(rootTreeSha, parts, true) || "";
}

function findPathInTree(repo: Repo, rootSha: string | null, parts: string[]): { found: boolean; oid?: string; type?: "blob" | "tree"; parentIsBlob?: boolean } {
  if (!rootSha) return { found: false };
  let currSha = rootSha;
  for (let i = 0; i < parts.length; i++) {
    const obj = repo.objects.get(currSha);
    if (!obj || obj.type !== "tree") return { found: false, parentIsBlob: true };
    const entries = parseTreeLocal(obj.data);
    const entry = entries.find(e => e.name === parts[i]);
    if (!entry) return { found: false };
    if (i === parts.length - 1) {
      return { found: true, oid: entry.oid, type: entry.type };
    }
    if (entry.type !== "tree") {
      return { found: false, parentIsBlob: true };
    }
    currSha = entry.oid;
  }
  return { found: false };
}

if (section === "contents" && method === "PUT") {
  const parts = sub.slice(1).map(decodeURIComponent).filter(Boolean);
  if (parts.length === 0) return unprocessable("path is required");
  const filePath = parts.join("/");
  const b = bodyObj(ctx);

  if (typeof b.content !== "string") {
    return unprocessable("content is required");
  }

  const cleanContent = b.content.replace(/[\r\n\s]/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleanContent) || (cleanContent.length % 4 !== 0)) {
    return unprocessable("invalid base64 content");
  }
  const rawBytes = new Uint8Array(Buffer.from(cleanContent, "base64"));

  const branch = strField(b, "branch") || repo.defaultBranch || "main";
  const refName = "refs/heads/" + branch;
  const headCommitSha = repo.refs.get(refName);

  let blobSha: string;
  let newRootTreeSha: string;
  let isCreate = false;
  let parents: string[] = [];

  if (!headCommitSha) {
    isCreate = true;
    blobSha = hashObject("blob", rawBytes);
    repo.objects.set(blobSha, { type: "blob", data: rawBytes });
    try {
      newRootTreeSha = setPathInTree(repo, null, parts, blobSha, "100644");
    } catch (err: any) {
      return unprocessable(err.message || "invalid path");
    }
  } else {
    const headObj = repo.objects.get(headCommitSha);
    if (!headObj || headObj.type !== "commit") return unprocessable("invalid commit ref");
    const headCommit = parseCommitLocal(headObj.data);
    const rootTreeSha = headCommit.tree;

    const existing = findPathInTree(repo, rootTreeSha, parts);
    if (existing.parentIsBlob) {
      return unprocessable("a parent path is a blob");
    }

    if (existing.found) {
      if (existing.type === "tree") {
        return unprocessable("path is a directory");
      }
      const providedSha = strField(b, "sha");
      if (providedSha && providedSha !== existing.oid) {
        return json(409, { message: "sha does not match" });
      }
      isCreate = false;
    } else {
      isCreate = true;
    }

    blobSha = hashObject("blob", rawBytes);
    repo.objects.set(blobSha, { type: "blob", data: rawBytes });
    try {
      newRootTreeSha = setPathInTree(repo, rootTreeSha, parts, blobSha, "100644");
    } catch (err: any) {
      return unprocessable(err.message || "invalid path");
    }
    parents = [headCommitSha];
  }

  const defaultMsg = isCreate ? ("Create " + filePath) : ("Update " + filePath);
  const commitMsg = strField(b, "message") || defaultMsg;
  const unix = Math.floor(new Date(store.tick()).getTime() / 1000);
  const commitSha = makeCommit(repo, newRootTreeSha, parents, commitMsg, viewerLogin, viewerLogin + "@example.invalid", unix);
  repo.refs.set(refName, commitSha);

  const status = isCreate ? 201 : 200;
  return json(status, {
    content: {
      name: parts[parts.length - 1],
      path: filePath,
      sha: blobSha,
      size: rawBytes.length,
      url: "",
      html_url: "",
      git_url: "",
      download_url: null,
      type: "file",
      content: b.content,
      encoding: "base64",
      _links: { self: "", git: "", html: "" }
    },
    commit: {
      sha: commitSha,
      message: commitMsg,
      author: { name: viewerLogin },
      committer: { name: viewerLogin }
    }
  });
}

if (section === "contents" && method === "DELETE") {
  const parts = sub.slice(1).map(decodeURIComponent).filter(Boolean);
  if (parts.length === 0) return unprocessable("path is required");
  const filePath = parts.join("/");
  const b = bodyObj(ctx);

  const providedSha = strField(b, "sha");
  if (!providedSha) {
    return unprocessable("sha is required");
  }

  const branch = strField(b, "branch") || repo.defaultBranch || "main";
  const refName = "refs/heads/" + branch;
  const headCommitSha = repo.refs.get(refName);
  if (!headCommitSha) {
    return notFound("branch ref not found");
  }

  const headObj = repo.objects.get(headCommitSha);
  if (!headObj || headObj.type !== "commit") return notFound("invalid commit ref");
  const headCommit = parseCommitLocal(headObj.data);
  const rootTreeSha = headCommit.tree;

  const existing = findPathInTree(repo, rootTreeSha, parts);
  if (existing.parentIsBlob || !existing.found) {
    return notFound("file not found");
  }
  if (existing.type === "tree") {
    return unprocessable("path is a directory");
  }
  if (existing.oid !== providedSha) {
    return json(409, { message: "sha does not match" });
  }

  let newRootTreeSha: string;
  try {
    newRootTreeSha = setPathInTree(repo, rootTreeSha, parts, null);
  } catch (err: any) {
    return unprocessable(err.message || "invalid tree state");
  }

  const commitMsg = strField(b, "message") || ("Delete " + filePath);
  const unix = Math.floor(new Date(store.tick()).getTime() / 1000);
  const commitSha = makeCommit(repo, newRootTreeSha, [headCommitSha], commitMsg, viewerLogin, viewerLogin + "@example.invalid", unix);
  repo.refs.set(refName, commitSha);

  return json(200, {
    commit: {
      sha: commitSha,
      message: commitMsg,
      author: { name: viewerLogin },
      committer: { name: viewerLogin }
    }
  });
}

// BRANCHES
if (section === "branches" && method === "GET") {
  if (sub.length === 1) {
    const list: Array<{ name: string; commit: { sha: string; url: string }; protected: boolean }> = [];
    for (const [refName, sha] of repo.refs.entries()) {
      if (refName.startsWith("refs/heads/")) {
        list.push({ name: refName.substring(11), commit: { sha, url: "" }, protected: false });
      }
    }
    return json(200, list);
  }
  if (sub.length >= 2) {
    const branchName = sub.slice(1).map(decodeURIComponent).join("/");
    const sha = repo.refs.get("refs/heads/" + branchName);
    if (!sha) return notFound();
    return json(200, { name: branchName, commit: { sha, url: "" }, protected: false });
  }
}

// COMMITS
if (section === "commits" && method === "GET") {
  if (sub.length === 1) {
    const shaParam = ctx.query["sha"];
    let currSha: string | undefined;
    if (shaParam) {
      currSha = repo.refs.get("refs/heads/" + shaParam) ?? repo.refs.get(shaParam) ?? shaParam;
    } else {
      const defaultBranch = repo.defaultBranch || "main";
      currSha = repo.refs.get("refs/heads/" + defaultBranch);
    }
    const commits: Array<Record<string, unknown>> = [];
    const visited = new Set<string>();
    while (currSha && !visited.has(currSha)) {
      visited.add(currSha);
      const data = repo.objects.get(currSha)?.data;
      if (!data) break;
      const parsed = parseCommitLocal(data);
      commits.push({
        sha: currSha,
        commit: {
          message: parsed.message,
          author: authorLineParts(parsed.author),
          committer: authorLineParts(parsed.committer),
        },
        author: null,
        committer: null,
        parents: parsed.parents.map((p) => ({ sha: p })),
      });
      currSha = parsed.parents[0];
    }
    const { page, perPage } = parsePagination(ctx);
    const paged = paginate(commits, page, perPage);
    return json(200, paged.items);
  }
  if (sub.length === 2) {
    const sha = sub[1];
    const data = repo.objects.get(sha)?.data;
    if (!data) return notFound();
    const parsed = parseCommitLocal(data);
    return json(200, {
      sha,
      commit: {
        message: parsed.message,
        author: authorLineParts(parsed.author),
        committer: authorLineParts(parsed.committer),
      },
      author: null,
      committer: null,
      parents: parsed.parents.map((p) => ({ sha: p })),
    });
  }
}

// GIT DATA
if (section === "git" && method === "GET") {
  if (sub[1] === "refs") {
    if (sub.length === 2) {
      const list: Array<Record<string, unknown>> = [];
      for (const [refName, sha] of repo.refs.entries()) {
        list.push({ ref: refName, node_id: "REF_" + refName, url: "", object: { sha, type: "commit", url: "" } });
      }
      return json(200, list);
    }
    if (sub.length > 2) {
      const rawRef = sub.slice(2).map(decodeURIComponent).join("/");
      const fullRef = rawRef.startsWith("refs/") ? rawRef : "refs/" + rawRef;
      const sha = repo.refs.get(fullRef) ?? repo.refs.get(rawRef);
      if (!sha) return notFound();
      const refName = repo.refs.has(fullRef) ? fullRef : rawRef;
      return json(200, {
        ref: refName,
        node_id: "REF_" + refName,
        url: "",
        object: { sha, type: "commit", url: "" },
      });
    }
  }

  if (sub[1] === "trees" && sub.length === 3) {
    const sha = sub[2];
    const data = repo.objects.get(sha)?.data;
    if (!data) return notFound();
    const isRecursive = ctx.query["recursive"] === "1";
    if (!isRecursive) {
      const entries = parseTreeLocal(data);
      const treeItems = entries.map((e) => ({
        path: e.name,
        mode: e.mode,
        type: e.type,
        sha: e.oid,
        size: e.type === "blob" ? (repo.objects.get(e.oid)?.data?.length ?? 0) : undefined,
        url: "",
      }));
      return json(200, { sha, url: "", tree: treeItems, truncated: false });
    } else {
      const map = walkTreeRecursive(repo, sha);
      const treeItems = Array.from(map.entries()).map(([path, e]) => ({
        path,
        mode: e.mode,
        type: e.type,
        sha: e.oid,
        size: e.type === "blob" ? (repo.objects.get(e.oid)?.data?.length ?? 0) : undefined,
        url: "",
      }));
      return json(200, { sha, url: "", tree: treeItems, truncated: false });
    }
  }

  if (sub[1] === "blobs" && sub.length === 3) {
    const sha = sub[2];
    const data = repo.objects.get(sha)?.data;
    if (!data) return notFound();
    const b64 = Buffer.from(data).toString("base64");
    return json(200, { sha, size: data.length, url: "", content: b64, encoding: "base64" });
  }

  if (sub[1] === "commits" && sub.length === 3) {
    const sha = sub[2];
    const data = repo.objects.get(sha)?.data;
    if (!data) return notFound();
    const parsed = parseCommitLocal(data);
    return json(200, {
      sha,
      commit: {
        message: parsed.message,
        author: authorLineParts(parsed.author),
        committer: authorLineParts(parsed.committer),
      },
      author: null,
      committer: null,
      parents: parsed.parents.map((p) => ({ sha: p })),
    });
  }
}

if (section === "git" && method === "POST") {
  if (sub[1] === "refs") {
    const b = bodyObj(ctx);
    const ref = strField(b, "ref");
    const sha = strField(b, "sha");
    if (!ref) return unprocessable("ref is required");
    if (!sha) return unprocessable("sha is required");
    if (!ref.startsWith("refs/")) return unprocessable("ref must start with refs/");
    if (repo.refs.has(ref)) return unprocessable("ref already exists");
    const obj = repo.objects.get(sha);
    if (!obj || (obj.type !== "commit" && obj.type !== "tag")) {
      return unprocessable("sha does not exist");
    }
    repo.refs.set(ref, sha);
    return json(201, {
      ref,
      node_id: "REF_" + ref,
      url: "",
      object: { sha, type: "commit", url: "" }
    });
  }
  return null;
}

if (section === "git" && method === "DELETE") {
  if (sub[1] === "refs" && sub.length > 2) {
    let refPath = sub.slice(2).join("/");
    if (!refPath.startsWith("refs/")) {
      refPath = "refs/" + refPath;
    }
    if (!repo.refs.has(refPath)) {
      return notFound("Reference does not exist");
    }
    repo.refs.delete(refPath);
    return json(204, null);
  }
  return null;
}

  return null;
}

export function handleRest(ctx: RestContext): RestResponse | null {
  const repoRes = handleRepos(ctx);
  if (repoRes !== null) return repoRes;
  const issuePullRes = handleIssuesPulls(ctx);
  if (issuePullRes !== null) return issuePullRes;
  return null;
}


