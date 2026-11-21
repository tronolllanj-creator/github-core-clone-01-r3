import type { Store, Repo, Issue, Pull } from "./store.ts";
import { parseTree, parseCommit } from "./gitobj.ts";

export type ValueNode =
  | { kind: "string"; value: string }
  | { kind: "int"; value: number }
  | { kind: "float"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "enum"; value: string }
  | { kind: "variable"; name: string }
  | { kind: "list"; values: ValueNode[] }
  | { kind: "object"; fields: Record<string, ValueNode> };

export type Selection =
  | { kind: "field"; name: string; alias: string | null; args: Record<string, ValueNode>; selections: Selection[] }
  | { kind: "fragment"; typeCondition: string; selections: Selection[] };

export type Operation = {
  kind: "query" | "mutation";
  name: string | null;
  varDefs: Record<string, { type: string; defaultValue?: ValueNode }>;
  selections: Selection[];
};

export type Token = {
  type: "name" | "string" | "int" | "float" | "punct" | "spread";
  value: string;
};

export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (/\s/.test(ch) || ch === ",") {
      i++;
      continue;
    }

    if (ch === "#") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") {
        i++;
      }
      continue;
    }

    if (input.slice(i, i + 3) === "...") {
      tokens.push({ type: "spread", value: "..." });
      i += 3;
      continue;
    }

    if ("!$&():=[]{|}".includes(ch)) {
      tokens.push({ type: "punct", value: ch });
      i++;
      continue;
    }

    if (ch === '"') {
      let str = "";
      i++;
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\") {
          i++;
          if (i >= input.length) {
            throw new Error("graphql parse error: unclosed escape in string");
          }
          const esc = input[i];
          if (esc === '"') str += '"';
          else if (esc === "\\") str += "\\";
          else if (esc === "/") str += "/";
          else if (esc === "b") str += "\b";
          else if (esc === "f") str += "\f";
          else if (esc === "n") str += "\n";
          else if (esc === "r") str += "\r";
          else if (esc === "t") str += "\t";
          else if (esc === "u") {
            const hex = input.slice(i + 1, i + 5);
            if (hex.length < 4 || !/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new Error("graphql parse error: invalid unicode escape");
            }
            str += String.fromCharCode(parseInt(hex, 16));
            i += 4;
          } else {
            throw new Error(`graphql parse error: invalid escape character \\${esc}`);
          }
        } else {
          str += input[i];
        }
        i++;
      }
      if (i >= input.length) {
        throw new Error("graphql parse error: unclosed string literal");
      }
      i++;
      tokens.push({ type: "string", value: str });
      continue;
    }

    if (ch === "-" || (ch >= "0" && ch <= "9")) {
      const start = i;
      if (ch === "-") i++;
      if (i >= input.length || input[i] < "0" || input[i] > "9") {
        throw new Error(`graphql parse error: invalid number at index ${start}`);
      }
      while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      let isFloat = false;
      if (i < input.length && input[i] === ".") {
        isFloat = true;
        i++;
        if (i >= input.length || input[i] < "0" || input[i] > "9") {
          throw new Error(`graphql parse error: invalid float decimal at index ${start}`);
        }
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      }
      if (i < input.length && (input[i] === "e" || input[i] === "E")) {
        isFloat = true;
        i++;
        if (i < input.length && (input[i] === "+" || input[i] === "-")) i++;
        if (i >= input.length || input[i] < "0" || input[i] > "9") {
          throw new Error(`graphql parse error: invalid float exponent at index ${start}`);
        }
        while (i < input.length && input[i] >= "0" && input[i] <= "9") i++;
      }
      tokens.push({ type: isFloat ? "float" : "int", value: input.slice(start, i) });
      continue;
    }

    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_") {
      const start = i;
      while (
        i < input.length &&
        ((input[i] >= "a" && input[i] <= "z") ||
          (input[i] >= "A" && input[i] <= "Z") ||
          (input[i] >= "0" && input[i] <= "9") ||
          input[i] === "_")
      ) {
        i++;
      }
      tokens.push({ type: "name", value: input.slice(start, i) });
      continue;
    }

    throw new Error(`graphql parse error: unexpected character '${ch}' at index ${i}`);
  }

  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token | null {
    return this.tokens[this.pos] || null;
  }

  private next(): Token {
    const tok = this.peek();
    if (!tok) throw new Error("graphql parse error: unexpected end of input");
    this.pos++;
    return tok;
  }

  private expect(type: Token["type"], value?: string): Token {
    const tok = this.next();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      throw new Error(`graphql parse error: expected ${value ?? type}, got ${tok.value}`);
    }
    return tok;
  }

  public parseDocument(): Operation {
    let kind: "query" | "mutation" = "query";
    let name: string | null = null;
    let varDefs: Record<string, { type: string; defaultValue?: ValueNode }> = {};

    const tok = this.peek();
    if (!tok) {
      throw new Error("graphql parse error: empty document");
    }

    if (tok.type === "name" && (tok.value === "query" || tok.value === "mutation")) {
      kind = this.next().value as "query" | "mutation";
      if (this.peek()?.type === "name") {
        name = this.next().value;
      }
      if (this.peek()?.type === "punct" && this.peek()?.value === "(") {
        varDefs = this.parseVarDefs();
      }
    } else if (tok.type === "punct" && tok.value === "{") {
      kind = "query";
      name = null;
      varDefs = {};
    } else {
      throw new Error(`graphql parse error: expected query, mutation, or '{', got ${tok.value}`);
    }

    const selections = this.parseSelectionSet();
    if (this.pos < this.tokens.length) {
      throw new Error(`graphql parse error: unexpected token '${this.peek()?.value}' after operation`);
    }

    return { kind, name, varDefs, selections };
  }

  private parseVarDefs(): Record<string, { type: string; defaultValue?: ValueNode }> {
    this.expect("punct", "(");
    const varDefs: Record<string, { type: string; defaultValue?: ValueNode }> = {};
    while (this.peek() && !(this.peek()?.type === "punct" && this.peek()?.value === ")")) {
      this.expect("punct", "$");
      const varName = this.expect("name").value;
      this.expect("punct", ":");
      const typeStr = this.parseTypeString();
      let defaultValue: ValueNode | undefined;
      if (this.peek()?.type === "punct" && this.peek()?.value === "=") {
        this.next();
        defaultValue = this.parseValue();
      }
      varDefs[varName] = defaultValue ? { type: typeStr, defaultValue } : { type: typeStr };
    }
    this.expect("punct", ")");
    return varDefs;
  }

  private parseTypeString(): string {
    let raw = "";
    if (this.peek()?.type === "punct" && this.peek()?.value === "[") {
      this.next();
      raw += "[" + this.parseTypeString();
      this.expect("punct", "]");
      raw += "]";
    } else {
      raw += this.expect("name").value;
    }
    if (this.peek()?.type === "punct" && this.peek()?.value === "!") {
      this.next();
      raw += "!";
    }
    return raw;
  }

  private parseSelectionSet(): Selection[] {
    this.expect("punct", "{");
    const selections: Selection[] = [];
    while (this.peek() && !(this.peek()?.type === "punct" && this.peek()?.value === "}")) {
      selections.push(this.parseSelection());
    }
    this.expect("punct", "}");
    return selections;
  }

  private parseSelection(): Selection {
    const tok = this.peek();
    if (tok?.type === "spread") {
      this.next();
      let typeCondition = "";
      if (this.peek()?.type === "name" && this.peek()?.value === "on") {
        this.next();
        typeCondition = this.expect("name").value;
      }
      const selections = this.parseSelectionSet();
      return { kind: "fragment", typeCondition, selections };
    }

    let alias: string | null = null;
    let fieldName: string;

    if (
      tok?.type === "name" &&
      this.tokens[this.pos + 1]?.type === "punct" &&
      this.tokens[this.pos + 1]?.value === ":"
    ) {
      alias = this.next().value;
      this.expect("punct", ":");
      fieldName = this.expect("name").value;
    } else {
      fieldName = this.expect("name").value;
    }

    let args: Record<string, ValueNode> = {};
    if (this.peek()?.type === "punct" && this.peek()?.value === "(") {
      args = this.parseArguments();
    }

    let selections: Selection[] = [];
    if (this.peek()?.type === "punct" && this.peek()?.value === "{") {
      selections = this.parseSelectionSet();
    }

    return { kind: "field", name: fieldName, alias, args, selections };
  }

  private parseArguments(): Record<string, ValueNode> {
    this.expect("punct", "(");
    const args: Record<string, ValueNode> = {};
    while (this.peek() && !(this.peek()?.type === "punct" && this.peek()?.value === ")")) {
      const argName = this.expect("name").value;
      this.expect("punct", ":");
      args[argName] = this.parseValue();
    }
    this.expect("punct", ")");
    return args;
  }

  private parseValue(): ValueNode {
    const tok = this.peek();
    if (!tok) throw new Error("graphql parse error: unexpected end of input in value");

    if (tok.type === "string") {
      this.next();
      return { kind: "string", value: tok.value };
    }
    if (tok.type === "int") {
      this.next();
      return { kind: "int", value: parseInt(tok.value, 10) };
    }
    if (tok.type === "float") {
      this.next();
      return { kind: "float", value: parseFloat(tok.value) };
    }
    if (tok.type === "punct" && tok.value === "$") {
      this.next();
      const varName = this.expect("name").value;
      return { kind: "variable", name: varName };
    }
    if (tok.type === "punct" && tok.value === "[") {
      this.next();
      const values: ValueNode[] = [];
      while (this.peek() && !(this.peek()?.type === "punct" && this.peek()?.value === "]")) {
        values.push(this.parseValue());
      }
      this.expect("punct", "]");
      return { kind: "list", values };
    }
    if (tok.type === "punct" && tok.value === "{") {
      this.next();
      const fields: Record<string, ValueNode> = {};
      while (this.peek() && !(this.peek()?.type === "punct" && this.peek()?.value === "}")) {
        const key = this.expect("name").value;
        this.expect("punct", ":");
        fields[key] = this.parseValue();
      }
      this.expect("punct", "}");
      return { kind: "object", fields };
    }
    if (tok.type === "name") {
      this.next();
      if (tok.value === "true") return { kind: "boolean", value: true };
      if (tok.value === "false") return { kind: "boolean", value: false };
      if (tok.value === "null") return { kind: "null" };
      return { kind: "enum", value: tok.value };
    }

    throw new Error(`graphql parse error: unexpected token '${tok.value}' when parsing value`);
  }
}

export function parseGraphQL(input: string): Operation {
  const tokens = tokenize(input);
  const parser = new Parser(tokens);
  return parser.parseDocument();
}

export function valueFromNode(node: ValueNode, variables: Record<string, unknown>): unknown {
  switch (node.kind) {
    case "string":
    case "int":
    case "float":
    case "boolean":
      return node.value;
    case "null":
      return null;
    case "enum":
      return node.value;
    case "variable":
      return node.name in variables ? variables[node.name] : null;
    case "list":
      return node.values.map((v) => valueFromNode(v, variables));
    case "object": {
      const res: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node.fields)) {
        res[k] = valueFromNode(v, variables);
      }
      return res;
    }
  }
}

export const ISSUE_FIELDS: string[] = [
  "id",
  "number",
  "title",
  "body",
  "state",
  "url",
  "createdAt",
  "updatedAt",
  "closedAt",
  "author",
  "labels",
  "comments",
  "assignee",
];

export const PULL_FIELDS: string[] = [
  "id",
  "number",
  "title",
  "body",
  "state",
  "headRefName",
  "baseRefName",
  "headRefOid",
  "baseRefOid",
  "mergeable",
  "merged",
  "url",
  "createdAt",
  "updatedAt",
  "closedAt",
  "mergedAt",
  "files",
  "author",
  "comments",
];

export const REPO_FIELDS: string[] = [
  "id",
  "databaseId",
  "name",
  "nameWithOwner",
  "owner",
  "defaultBranchRef",
  "viewerPermission",
  "hasIssuesEnabled",
  "url",
  "description",
  "isPrivate",
  "createdAt",
  "updatedAt",
  "issue",
  "issues",
  "pullRequest",
  "pullRequests",
];

export const SEARCH_ENUM: string[] = ["ISSUE", "REPOSITORY", "USER", "DISCUSSION", "COMMIT"];

export type GqlObject = {
  __typename: string;
  __fields: Record<string, (args: Record<string, unknown>) => unknown>;
};

export function encodeCursor(index: number): string {
  return Buffer.from("cursor:" + index, "utf8").toString("base64");
}

export function decodeCursor(cursor: string | undefined | null): number {
  if (!cursor || typeof cursor !== "string") return -1;
  try {
    const decoded = Buffer.from(cursor, "base64").toString("utf8");
    if (!decoded.startsWith("cursor:")) return -1;
    const val = parseInt(decoded.slice(7), 10);
    return isNaN(val) ? -1 : val;
  } catch {
    return -1;
  }
}

export function repoGid(repo: Repo): string {
  return "R_" + repo.id;
}

export function issueGid(repo: Repo, issue: Issue): string {
  return "I_" + repo.id + "_" + issue.number;
}

export function pullGid(repo: Repo, pull: Pull): string {
  return "PR_" + repo.id + "_" + pull.number;
}

export function parseGid(id: string): { kind: "repo" | "issue" | "pull" | "comment" | "unknown"; repoId: number; number: number } {
  if (!id || typeof id !== "string") return { kind: "unknown", repoId: 0, number: 0 };
  const parts = id.split("_");
  if (parts[0] === "R" && parts.length === 2) {
    return { kind: "repo", repoId: parseInt(parts[1], 10) || 0, number: 0 };
  }
  if (parts[0] === "I" && parts.length === 3) {
    return { kind: "issue", repoId: parseInt(parts[1], 10) || 0, number: parseInt(parts[2], 10) || 0 };
  }
  if (parts[0] === "PR" && parts.length === 3) {
    return { kind: "pull", repoId: parseInt(parts[1], 10) || 0, number: parseInt(parts[2], 10) || 0 };
  }
  if (parts[0] === "C" && parts.length === 2) {
    return { kind: "comment", repoId: 0, number: parseInt(parts[1], 10) || 0 };
  }
  return { kind: "unknown", repoId: 0, number: 0 };
}

function getUser(store: Store, login: string): any {
  if (!store || !store.users) return undefined;
  if (store.users instanceof Map) return store.users.get(login);
  if (Array.isArray(store.users)) return store.users.find((u: any) => u.login === login);
  return (store.users as Record<string, any>)[login];
}

function getIssues(repo: Repo): Issue[] {
  if (!repo || !repo.issues) return [];
  if (Array.isArray(repo.issues)) return repo.issues;
  if (repo.issues instanceof Map) return Array.from(repo.issues.values());
  if (typeof repo.issues === "object") return Object.values(repo.issues);
  return [];
}

function getPulls(repo: Repo): Pull[] {
  if (!repo || !repo.pulls) return [];
  if (Array.isArray(repo.pulls)) return repo.pulls;
  if (repo.pulls instanceof Map) return Array.from(repo.pulls.values());
  if (typeof repo.pulls === "object") return Object.values(repo.pulls);
  return [];
}

function findRepo(store: Store, owner: string, name: string): Repo | undefined {
  if (!store || !store.repos) return undefined;
  const allRepos = store.repos instanceof Map
    ? Array.from(store.repos.values())
    : Array.isArray(store.repos)
    ? store.repos
    : Object.values(store.repos);
  return (allRepos as Repo[]).find(r => {
    const rOwner = typeof r.owner === "string" ? r.owner : (r.owner as any)?.login;
    return rOwner === owner && r.name === name;
  });
}

function findRepoById(store: Store, id: number): Repo | undefined {
  if (!store || !store.repos) return undefined;
  const allRepos = store.repos instanceof Map
    ? Array.from(store.repos.values())
    : Array.isArray(store.repos)
    ? store.repos
    : Object.values(store.repos);
  return (allRepos as Repo[]).find(r => r.id === id);
}

function flattenTree(repo: Repo, commitOrTreeSha: string, prefix = "", visited = new Set<string>()): Map<string, string> {
  const result = new Map<string, string>();
  if (!repo.objects || visited.has(commitOrTreeSha)) return result;
  visited.add(commitOrTreeSha);
  
  const obj = repo.objects.get(commitOrTreeSha);
  if (!obj) return result;
  
  let treeSha = commitOrTreeSha;
  if (obj.type === "commit") {
    try {
      const commit = parseCommit(obj.data);
      treeSha = commit.tree;
    } catch {
      return result;
    }
  } else if (obj.type !== "tree") {
    return result;
  }
  
  const treeObj = repo.objects.get(treeSha);
  if (!treeObj || treeObj.type !== "tree") return result;
  
  try {
    const entries = parseTree(treeObj.data);
    for (const entry of entries) {
      const path = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.mode === "40000") {
        const subMap = flattenTree(repo, entry.oid, path, visited);
        for (const [p, sha] of subMap.entries()) {
          result.set(p, sha);
        }
      } else {
        result.set(path, entry.oid);
      }
    }
  } catch {}
  
  return result;
}

function changedFiles(store: Store, repo: Repo, pull: Pull): string[] {
  if (!pull.baseSha || !pull.headSha) return [];
  const baseMap = flattenTree(repo, pull.baseSha);
  const headMap = flattenTree(repo, pull.headSha);

  const allPaths = new Set<string>([...baseMap.keys(), ...headMap.keys()]);
  const changed: string[] = [];
  for (const path of allPaths) {
    if (baseMap.get(path) !== headMap.get(path)) {
      changed.push(path);
    }
  }
  changed.sort();
  return changed;
}

export function userObject(store: Store, login: string): GqlObject {
  const user = getUser(store, login);
  const uId = user ? user.id : 0;
  const uName = user && user.name ? user.name : login;
  const uEmail = user && user.email ? user.email : "";
  return {
    __typename: "User",
    __fields: {
      login: () => login,
      id: () => "U_" + uId,
      name: () => uName,
      email: () => uEmail
    }
  };
}

export function repoObject(store: Store, viewerLogin: string, repo: Repo): GqlObject {
  const ownerLogin = typeof repo.owner === "string" ? repo.owner : (repo.owner as any)?.login || viewerLogin;
  return {
    __typename: "Repository",
    __fields: {
      id: () => repoGid(repo),
      databaseId: () => repo.id,
      name: () => repo.name,
      nameWithOwner: () => repo.fullName,
      owner: () => userObject(store, ownerLogin),
      defaultBranchRef: () => ({
        __typename: "Ref",
        __fields: {
          name: () => repo.defaultBranch,
          prefix: () => "refs/heads/"
        }
      }),
      viewerPermission: () => "ADMIN",
      hasIssuesEnabled: () => true,
      url: () => "/" + repo.fullName,
      description: () => repo.description ?? null,
      isPrivate: () => repo.private,
      createdAt: () => repo.createdAt,
      updatedAt: () => repo.updatedAt,
      issue: (args) => {
        const num = args.number as number;
        const issue = getIssues(repo).find(i => i.number === num);
        return issue ? issueObject(store, repo, issue) : null;
      },
      issues: (args) => issueConnection(store, repo, args),
      pullRequest: (args) => {
        const num = args.number as number;
        const pull = getPulls(repo).find(p => p.number === num);
        return pull ? pullObject(store, repo, pull) : null;
      },
      pullRequests: (args) => pullConnection(store, repo, args)
    }
  };
}

export function issueObject(store: Store, repo: Repo, issue: Issue): GqlObject {
  const authorLogin = typeof issue.user === "string" ? issue.user : (issue.user as any)?.login || "";
  const assigneeLogin = issue.assignee ? (typeof issue.assignee === "string" ? issue.assignee : (issue.assignee as any).login) : null;
  return {
    __typename: "Issue",
    __fields: {
      id: () => issueGid(repo, issue),
      number: () => issue.number,
      title: () => issue.title,
      body: () => issue.body ?? "",
      state: () => issue.state === "open" ? "OPEN" : "CLOSED",
      url: () => "/" + repo.fullName + "/issues/" + issue.number,
      createdAt: () => issue.createdAt,
      updatedAt: () => issue.updatedAt,
      closedAt: () => issue.closedAt ?? null,
      author: () => userObject(store, authorLogin),
      assignee: () => assigneeLogin ? userObject(store, assigneeLogin) : null,
      labels: (args) => {
        const first = args.first as number | undefined;
        const afterIndex = decodeCursor(args.after as string | undefined | null);
        const labels = (issue.labels || []).map((lbl: any, idx: number) => {
          const name = typeof lbl === "string" ? lbl : lbl.name;
          const color = typeof lbl === "object" && lbl.color ? lbl.color : "default";
          const desc = typeof lbl === "object" && lbl.description ? lbl.description : "";
          const id = typeof lbl === "object" && lbl.id ? String(lbl.id) : "L_" + idx;
          return {
            __typename: "Label",
            __fields: {
              name: () => name,
              color: () => color,
              description: () => desc,
              id: () => id
            }
          } as GqlObject;
        });
        const visible = labels.slice(afterIndex + 1);
        return connectionObject(visible, labels.length, afterIndex, first);
      },
      comments: (args) => {
        const first = args.first as number | undefined;
        const afterIndex = decodeCursor(args.after as string | undefined | null);
        const comments = (issue.comments || []).map((c: any) => {
          const commentAuthor = typeof c.user === "string" ? c.user : c.user?.login || "";
          return {
            __typename: "IssueComment",
            __fields: {
              id: () => "C_" + c.id,
              body: () => c.body,
              author: () => userObject(store, commentAuthor),
              createdAt: () => c.createdAt,
              updatedAt: () => c.updatedAt
            }
          } as GqlObject;
        });
        const visible = comments.slice(afterIndex + 1);
        return connectionObject(visible, comments.length, afterIndex, first);
      }
    }
  };
}

export function pullObject(store: Store, repo: Repo, pull: Pull): GqlObject {
  const authorLogin = typeof pull.user === "string" ? pull.user : (pull.user as any)?.login || "";
  return {
    __typename: "PullRequest",
    __fields: {
      id: () => pullGid(repo, pull),
      number: () => pull.number,
      title: () => pull.title,
      body: () => pull.body ?? "",
      state: () => pull.merged ? "MERGED" : pull.state === "open" ? "OPEN" : "CLOSED",
      headRefName: () => pull.headRef,
      baseRefName: () => pull.baseRef,
      headRefOid: () => pull.headSha,
      baseRefOid: () => pull.baseSha,
      mergeable: () => pull.mergeable === false ? "CONFLICTING" : pull.mergeable === true ? "MERGEABLE" : "UNKNOWN",
      merged: () => pull.merged ?? false,
      url: () => "/" + repo.fullName + "/pull/" + pull.number,
      createdAt: () => pull.createdAt,
      updatedAt: () => pull.updatedAt,
      closedAt: () => pull.closedAt ?? null,
      mergedAt: () => pull.mergedAt ?? null,
      author: () => userObject(store, authorLogin),
      files: (args) => {
        const first = args.first as number | undefined;
        const afterIndex = decodeCursor(args.after as string | undefined | null);
        const files = changedFiles(store, repo, pull).map(path => ({
          __typename: "PullRequestFile",
          __fields: {
            path: () => path
          }
        } as GqlObject));
        const visible = files.slice(afterIndex + 1);
        return connectionObject(visible, files.length, afterIndex, first);
      },
      comments: (args) => {
        const first = args.first as number | undefined;
        const afterIndex = decodeCursor(args.after as string | undefined | null);
        const comments = (pull.comments || []).map((c: any) => {
          const commentAuthor = typeof c.user === "string" ? c.user : c.user?.login || "";
          return {
            __typename: "IssueComment",
            __fields: {
              id: () => "C_" + c.id,
              body: () => c.body,
              author: () => userObject(store, commentAuthor),
              createdAt: () => c.createdAt,
              updatedAt: () => c.updatedAt
            }
          } as GqlObject;
        });
        const visible = comments.slice(afterIndex + 1);
        return connectionObject(visible, comments.length, afterIndex, first);
      }
    }
  };
}

export function connectionObject(nodes: GqlObject[], total: number, afterIndex: number, first: number | undefined): GqlObject {
  const page = first !== undefined ? nodes.slice(0, first) : nodes;
  const hasNextPage = (afterIndex + 1 + page.length) < total;
  const hasPreviousPage = afterIndex >= 0;
  const startCursor = page.length > 0 ? encodeCursor(afterIndex + 1) : null;
  const endCursor = page.length > 0 ? encodeCursor(afterIndex + page.length) : null;

  return {
    __typename: "Connection",
    __fields: {
      nodes: () => page,
      pageInfo: () => ({
        __typename: "PageInfo",
        __fields: {
          hasNextPage: () => hasNextPage,
          hasPreviousPage: () => hasPreviousPage,
          startCursor: () => startCursor,
          endCursor: () => endCursor
        }
      }),
      totalCount: () => total
    }
  };
}

export function issueConnection(store: Store, repo: Repo, args: Record<string, unknown>): GqlObject {
  let issues = [...getIssues(repo)];
  issues.sort((a, b) => a.number - b.number);

  if (Array.isArray(args.states) && args.states.length > 0) {
    const allowed = (args.states as string[]).map(s => s === "OPEN" ? "open" : s === "CLOSED" ? "closed" : s.toLowerCase());
    issues = issues.filter(i => allowed.includes(i.state));
  }

  if (args.orderBy && typeof args.orderBy === "object") {
    const orderBy = args.orderBy as { field?: string; direction?: string };
    if (orderBy.field === "CREATED_AT") {
      if (orderBy.direction === "DESC") {
        issues.sort((a, b) => {
          if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
          return b.number - a.number;
        });
      } else if (orderBy.direction === "ASC") {
        issues.sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
          return a.number - b.number;
        });
      }
    }
  }

  const total = issues.length;
  const afterIndex = decodeCursor(args.after as string | undefined);
  const visible = issues.slice(afterIndex + 1);
  const first = typeof args.first === "number" ? args.first : undefined;

  const nodes = visible.map(i => issueObject(store, repo, i));
  return connectionObject(nodes, total, afterIndex, first);
}

export function pullConnection(store: Store, repo: Repo, args: Record<string, unknown>): GqlObject {
  let pulls = [...getPulls(repo)];
  pulls.sort((a, b) => a.number - b.number);

  if (Array.isArray(args.states) && args.states.length > 0) {
    const allowed = args.states as string[];
    pulls = pulls.filter(p => {
      const gqlState = p.merged ? "MERGED" : p.state === "open" ? "OPEN" : "CLOSED";
      return allowed.includes(gqlState);
    });
  }

  if (args.orderBy && typeof args.orderBy === "object") {
    const orderBy = args.orderBy as { field?: string; direction?: string };
    if (orderBy.field === "CREATED_AT") {
      if (orderBy.direction === "DESC") {
        pulls.sort((a, b) => {
          if (a.createdAt !== b.createdAt) return b.createdAt.localeCompare(a.createdAt);
          return b.number - a.number;
        });
      } else if (orderBy.direction === "ASC") {
        pulls.sort((a, b) => {
          if (a.createdAt !== b.createdAt) return a.createdAt.localeCompare(b.createdAt);
          return a.number - b.number;
        });
      }
    }
  }

  const total = pulls.length;
  const afterIndex = decodeCursor(args.after as string | undefined);
  const visible = pulls.slice(afterIndex + 1);
  const first = typeof args.first === "number" ? args.first : undefined;

  const nodes = visible.map(p => pullObject(store, repo, p));
  return connectionObject(nodes, total, afterIndex, first);
}

export function typeObject(name: string): GqlObject | null {
  if (name === "Issue" || name === "PullRequest" || name === "Repository") {
    const fieldsList = name === "Issue" ? ISSUE_FIELDS : name === "PullRequest" ? PULL_FIELDS : REPO_FIELDS;
    return {
      __typename: "__Type",
      __fields: {
        name: () => name,
        kind: () => "OBJECT",
        fields: () => fieldsList.map(fname => ({
          __typename: "__Field",
          __fields: { name: () => fname }
        })),
        enumValues: () => null
      }
    };
  }
  if (name === "SearchType") {
    return {
      __typename: "__Type",
      __fields: {
        name: () => name,
        kind: () => "ENUM",
        fields: () => null,
        enumValues: () => SEARCH_ENUM.map(ename => ({
          __typename: "__EnumValue",
          __fields: { name: () => ename }
        }))
      }
    };
  }
  return null;
}

function isGqlObject(val: unknown): val is GqlObject {
  return typeof val === "object" && val !== null && "__typename" in val && "__fields" in val;
}

export function executeSelections(
  parent: GqlObject,
  selections: Selection[],
  variables: Record<string, unknown>,
  errors: Array<{ message: string }>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const sel of selections) {
    if (sel.kind === "fragment") {
      if (sel.typeCondition === "" || sel.typeCondition === parent.__typename) {
        const fragRes = executeSelections(parent, sel.selections, variables, errors);
        Object.assign(result, fragRes);
      }
      continue;
    }

    if (sel.kind === "field") {
      const key = sel.alias || sel.name;
      const args: Record<string, unknown> = {};
      if (sel.args) {
        for (const [argName, argNode] of Object.entries(sel.args)) {
          args[argName] = valueFromNode(argNode, variables);
        }
      }

      let resolver = parent.__fields[sel.name];
      if (!resolver && sel.name === "__typename") {
        resolver = () => parent.__typename;
      }

      if (!resolver) {
        errors.push({ message: `Cannot query field "${sel.name}" on type "${parent.__typename}".` });
        result[key] = null;
        continue;
      }

      let val: unknown;
      try {
        val = resolver(args);
      } catch (err: any) {
        errors.push({ message: err?.message || String(err) });
        result[key] = null;
        continue;
      }

      const hasSubSelections = sel.selections && sel.selections.length > 0;

      if (!hasSubSelections) {
        result[key] = val ?? null;
      } else {
        if (val === null || val === undefined) {
          result[key] = null;
        } else if (Array.isArray(val)) {
          result[key] = val.map(item => {
            if (isGqlObject(item)) {
              return executeSelections(item, sel.selections!, variables, errors);
            }
            return item;
          });
        } else if (isGqlObject(val)) {
          result[key] = executeSelections(val, sel.selections!, variables, errors);
        } else {
          errors.push({ message: `Field "${sel.name}" of type "${typeof val}" cannot have sub-selections.` });
          result[key] = null;
        }
      }
    }
  }

  return result;
}

export function rootQuery(store: Store, viewerLogin: string): GqlObject {
  return {
    __typename: "Query",
    __fields: {
      viewer: () => userObject(store, viewerLogin),
      repository: (args) => {
        const owner = args.owner as string;
        const name = args.name as string;
        const repo = findRepo(store, owner, name);
        const repoOwner = repo ? (typeof repo.owner === "string" ? repo.owner : (repo.owner as any)?.login) : null;
        if (!repo || repoOwner !== viewerLogin) return null;
        return repoObject(store, viewerLogin, repo);
      },
      node: (args) => {
        const id = args.id as string;
        const parsed = parseGid(id);
        if (parsed.kind === "repo") {
          const repo = findRepoById(store, parsed.repoId);
          return repo ? repoObject(store, viewerLogin, repo) : null;
        }
        if (parsed.kind === "issue") {
          const repo = findRepoById(store, parsed.repoId);
          if (!repo) return null;
          const issue = getIssues(repo).find(i => i.number === parsed.number);
          return issue ? issueObject(store, repo, issue) : null;
        }
        if (parsed.kind === "pull") {
          const repo = findRepoById(store, parsed.repoId);
          if (!repo) return null;
          const pull = getPulls(repo).find(p => p.number === parsed.number);
          return pull ? pullObject(store, repo, pull) : null;
        }
        return null;
      },
      __type: (args) => typeObject(args.name as string)
    }
  };
}

export function rootMutation(store: Store, viewerLogin: string): GqlObject {
  return {
    __typename: "Mutation",
    __fields: {
      createIssue: (args) => {
        const input = (args.input || {}) as Record<string, unknown>;
        const repositoryId = input.repositoryId as string;
        const title = input.title as string;
        const body = (input.body as string) ?? "";
        const parsed = parseGid(repositoryId);
        const repo = findRepoById(store, parsed.repoId);
        if (!repo) throw new Error("repository not found");
        if (!title || !title.trim()) throw new Error("title is required");

        const now = store.tick();
        const num = repo.issueSeq++;
        const issue: Issue = {
          number: num,
          state: "open",
          title,
          body,
          labels: [],
          assignee: null,
          user: viewerLogin,
          createdAt: now,
          updatedAt: now,
          closedAt: null,
          comments: [],
          locked: false
        };

        if (Array.isArray(repo.issues)) repo.issues.push(issue);
        else if (repo.issues instanceof Map) repo.issues.set(num, issue);
        else if (typeof repo.issues === "object") (repo.issues as any)[num] = issue;

        return {
          __typename: "CreateIssuePayload",
          __fields: {
            issue: () => issueObject(store, repo, issue)
          }
        };
      },
      closeIssue: (args) => {
        const input = (args.input || {}) as Record<string, unknown>;
        const issueId = input.issueId as string;
        const parsed = parseGid(issueId);
        const repo = findRepoById(store, parsed.repoId);
        const issue = repo ? getIssues(repo).find(i => i.number === parsed.number) : undefined;
        if (!repo || !issue) throw new Error("issue not found");

        const now = store.tick();
        issue.state = "closed";
        issue.closedAt = now;
        issue.updatedAt = now;

        return {
          __typename: "CloseIssuePayload",
          __fields: {
            issue: () => issueObject(store, repo, issue)
          }
        };
      },
      createPullRequest: (args) => {
        const input = (args.input || {}) as Record<string, unknown>;
        const repositoryId = input.repositoryId as string;
        const baseRefName = input.baseRefName as string;
        const headRefName = input.headRefName as string;
        const title = input.title as string;
        const body = (input.body as string) ?? "";

        const parsed = parseGid(repositoryId);
        const repo = findRepoById(store, parsed.repoId);
        if (!repo) throw new Error("repository not found");
        if (!title || !title.trim()) throw new Error("title is required");

        const baseSha = repo.refs.get ? repo.refs.get("refs/heads/" + baseRefName) : (repo.refs as any)["refs/heads/" + baseRefName];
        if (!baseSha) throw new Error("branch does not exist: " + baseRefName);
        const headSha = repo.refs.get ? repo.refs.get("refs/heads/" + headRefName) : (repo.refs as any)["refs/heads/" + headRefName];
        if (!headSha) throw new Error("branch does not exist: " + headRefName);

        const now = store.tick();
        const num = repo.pullSeq++;
        const pull: Pull = {
          number: num,
          title,
          body,
          state: "open",
          merged: false,
          mergeable: true,
          user: viewerLogin,
          headRef: headRefName,
          baseRef: baseRefName,
          headSha,
          baseSha,
          createdAt: now,
          updatedAt: now,
          closedAt: null,
          mergedAt: null,
          mergeCommitSha: null,
          comments: []
        };

        if (Array.isArray(repo.pulls)) repo.pulls.push(pull);
        else if (repo.pulls instanceof Map) repo.pulls.set(num, pull);
        else if (typeof repo.pulls === "object") (repo.pulls as any)[num] = pull;

        return {
          __typename: "CreatePullRequestPayload",
          __fields: {
            pullRequest: () => pullObject(store, repo, pull)
          }
        };
      },
      mergePullRequest: (args) => {
        const input = (args.input || {}) as Record<string, unknown>;
        const pullRequestId = input.pullRequestId as string;
        const parsed = parseGid(pullRequestId);
        const repo = findRepoById(store, parsed.repoId);
        const pull = repo ? getPulls(repo).find(p => p.number === parsed.number) : undefined;
        if (!repo || !pull) throw new Error("pull request not found");
        if (pull.merged || pull.state !== "open") throw new Error("pull request is already merged or closed");

        const now = store.tick();
        if (repo.refs.set) repo.refs.set("refs/heads/" + pull.baseRef, pull.headSha);
        else (repo.refs as any)["refs/heads/" + pull.baseRef] = pull.headSha;

        pull.merged = true;
        pull.state = "closed";
        pull.mergedAt = now;
        pull.closedAt = now;
        pull.mergeCommitSha = pull.headSha;
        pull.updatedAt = now;

        return {
          __typename: "MergePullRequestPayload",
          __fields: {
            pullRequest: () => pullObject(store, repo, pull)
          }
        };
      },
      addComment: (args) => {
        const input = (args.input || {}) as Record<string, unknown>;
        const subjectId = input.subjectId as string;
        const body = input.body as string;
        if (!body || !body.trim()) throw new Error("body is required");

        const parsed = parseGid(subjectId);
        const repo = findRepoById(store, parsed.repoId);
        let target: Issue | Pull | undefined;
        if (repo) {
          if (parsed.kind === "issue") target = getIssues(repo).find(i => i.number === parsed.number);
          else if (parsed.kind === "pull") target = getPulls(repo).find(p => p.number === parsed.number);
        }
        if (!repo || !target) throw new Error("subject not found");

        const now = store.tick();
        const commentId = store.nextCommentId(repo);
        const comment = { id: commentId, body, user: viewerLogin, createdAt: now, updatedAt: now };
        if (!target.comments) target.comments = [];
        target.comments.push(comment);

        const commentIndex = target.comments.length - 1;
        const commentObj: GqlObject = {
          __typename: "IssueComment",
          __fields: {
            id: () => "C_" + comment.id,
            body: () => comment.body,
            author: () => userObject(store, viewerLogin),
            createdAt: () => comment.createdAt,
            updatedAt: () => comment.updatedAt
          }
        };

        const subjectObj = parsed.kind === "issue" ? issueObject(store, repo, target as Issue) : pullObject(store, repo, target as Pull);

        return {
          __typename: "AddCommentPayload",
          __fields: {
            commentEdge: () => ({
              __typename: "IssueCommentEdge",
              __fields: {
                cursor: () => encodeCursor(commentIndex),
                node: () => commentObj
              }
            }),
            subject: () => subjectObj
          }
        };
      }
    }
  };
}

function executeGraphQLSingle(store: Store, viewerLogin: string, reqBody: unknown): Record<string, unknown> {
  if (!reqBody || typeof reqBody !== "object" || typeof (reqBody as any).query !== "string") {
    return { errors: [{ message: "invalid GraphQL request" }] };
  }

  let op: Operation;
  try {
    op = parseGraphQL((reqBody as any).query);
  } catch (err: any) {
    return { errors: [{ message: err.message || String(err) }] };
  }

  const rawVars = (reqBody as any).variables && typeof (reqBody as any).variables === "object" && !Array.isArray((reqBody as any).variables)
    ? ((reqBody as any).variables as Record<string, unknown>)
    : {};
  const variables: Record<string, unknown> = { ...rawVars };
  if (op.varDefs) {
    for (const [name, vd] of Object.entries(op.varDefs)) {
      if (!(name in variables) && vd.defaultValue !== undefined) {
        variables[name] = valueFromNode(vd.defaultValue, variables);
      }
    }
  }

  const root = op.kind === "mutation" ? rootMutation(store, viewerLogin) : rootQuery(store, viewerLogin);
  const errors: Array<{ message: string }> = [];
  const data = executeSelections(root, op.selections, variables, errors);

  const res: Record<string, unknown> = { data };
  if (errors.length > 0) {
    res.errors = errors;
  }
  return res;
}

export function executeGraphQL(store: Store, viewerLogin: string, body: unknown): {
  status: number;
  body: Record<string, unknown> | Array<Record<string, unknown>>;
} {
  if (Array.isArray(body)) {
    const results = body.map(b => executeGraphQLSingle(store, viewerLogin, b));
    return { status: 200, body: results };
  }
  if (!body || typeof body !== "object" || typeof (body as any).query !== "string") {
    return { status: 400, body: { errors: [{ message: "invalid GraphQL request" }] } };
  }
  const result = executeGraphQLSingle(store, viewerLogin, body);
  return { status: 200, body: result };
}


