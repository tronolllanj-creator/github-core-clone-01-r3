export type User = {
  id: number;
  login: string;
  name: string;
  email: string;
  type: "User" | "Organization";
};

export type GitObject = {
  type: "blob" | "tree" | "commit" | "tag";
  data: Uint8Array;
};

export type Label = {
  id: number;
  name: string;
  color: string;
  description: string;
};

export type Comment = {
  id: number;
  body: string;
  user: string;
  createdAt: string;
  updatedAt: string;
};

export type Issue = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  assignee: string | null;
  user: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  comments: Comment[];
  locked: boolean;
};

export type Pull = {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  merged: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  baseSha: string;
  mergeCommitSha: string | null;
  user: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  mergedAt: string | null;
  mergeable: boolean;
  comments: Comment[];
};

export type Repo = {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  description: string;
  defaultBranch: string;
  createdAt: string;
  updatedAt: string;
  pushedAt: string;
  objects: Map<string, GitObject>;
  refs: Map<string, string>;
  issues: Map<number, Issue>;
  pulls: Map<number, Pull>;
  labels: Map<string, Label>;
  issueSeq: number;
  pullSeq: number;
  commentSeq: number;
  labelSeq: number;
};

export class Store {
  users: Map<string, User>;
  repos: Map<string, Repo>;
  private repoSeq: number;
  private clockTime: number;

  constructor() {
    this.users = new Map();
    this.repos = new Map();
    this.repoSeq = 5000;
    this.clockTime = Date.UTC(2025, 0, 1, 0, 0, 0);

    const baseUsers: User[] = [
      { login: "adaiversen", id: 1000, name: "ada iversen", email: "adaiversen@example.invalid", type: "User" },
      { login: "quinnkeller", id: 1001, name: "quinn keller", email: "quinnkeller@example.invalid", type: "User" },
      { login: "olgabauer", id: 1002, name: "olga bauer", email: "olgabauer@example.invalid", type: "User" },
      { login: "dmitriquist", id: 1003, name: "dmitri quist", email: "dmitriquist@example.invalid", type: "User" },
      { login: "adanovak", id: 1004, name: "ada novak", email: "adanovak@example.invalid", type: "User" },
      { login: "zanerossi", id: 1005, name: "zane rossi", email: "zanerossi@example.invalid", type: "User" },
      { login: "pavelcosta", id: 1006, name: "pavel costa", email: "pavelcosta@example.invalid", type: "User" },
      { login: "wrenkeller", id: 1007, name: "wren keller", email: "wrenkeller@example.invalid", type: "User" },
      { login: "coraquist", id: 1008, name: "cora quist", email: "coraquist@example.invalid", type: "User" },
      { login: "elenaulrich", id: 1009, name: "elena ulrich", email: "elenaulrich@example.invalid", type: "User" },
      { login: "tesssato", id: 1010, name: "tess sato", email: "tesssato@example.invalid", type: "User" },
      { login: "svenrossi", id: 1011, name: "sven rossi", email: "svenrossi@example.invalid", type: "User" },
      { login: "faint-meadow-org", id: 6000, name: "faint meadow org", email: "faint-meadow-org@example.invalid", type: "Organization" },
    ];

    for (const u of baseUsers) {
      this.users.set(u.login, u);
    }
  }

  tick(): string {
    this.clockTime += 1000;
    return new Date(this.clockTime).toISOString();
  }

  seedScenario(): void {
    const seededRepoNames = [
      "amber-thistle",
      "happy-willow",
      "happy-ember",
      "crisp-thistle",
      "nimble-delta",
      "tidy-harbor",
      "quiet-orchid",
      "gentle-quartz",
      "happy-nebula",
      "witty-thistle",
      "upbeat-yarrow",
      "faint-falcon",
      "quick-juniper",
      "tidy-umber",
      "eager-pebble",
      "warm-raven",
      "idle-badger",
      "calm-orchid",
      "tidy-ember",
      "brisk-cedar",
      "steady-meadow",
      "idle-lantern",
      "quick-raven",
      "plain-cedar",
      "calm-quartz",
      "tidy-lantern",
      "happy-thistle",
      "crisp-zephyr",
      "keen-glade",
      "amber-badger"
    ];

    const timestamp = new Date(this.clockTime).toISOString();

    for (const name of seededRepoNames) {
      const owner = "adaiversen";
      const fullName = `${owner}/${name}`;
      const repo: Repo = {
        id: this.repoSeq++,
        name,
        fullName,
        owner,
        private: false,
        description: "",
        defaultBranch: "main",
        createdAt: timestamp,
        updatedAt: timestamp,
        pushedAt: timestamp,
        objects: new Map(),
        refs: new Map(),
        issues: new Map(),
        pulls: new Map(),
        labels: new Map(),
        issueSeq: 1,
        pullSeq: 1,
        commentSeq: 1,
        labelSeq: 1,
      };
      this.repos.set(fullName, repo);
    }
  }

  createRepo(owner: string, name: string, opts: { private?: boolean; description?: string; defaultBranch?: string } = {}): Repo {
    const fullName = `${owner}/${name}`;
    if (this.repos.has(fullName)) {
      throw new Error("already exists");
    }

    const now = this.tick();
    const repo: Repo = {
      id: this.repoSeq++,
      name,
      fullName,
      owner,
      private: opts.private ?? false,
      description: opts.description ?? "",
      defaultBranch: opts.defaultBranch ?? "main",
      createdAt: now,
      updatedAt: now,
      pushedAt: now,
      objects: new Map(),
      refs: new Map(),
      issues: new Map(),
      pulls: new Map(),
      labels: new Map(),
      issueSeq: 1,
      pullSeq: 1,
      commentSeq: 1,
      labelSeq: 1,
    };

    this.repos.set(fullName, repo);
    return repo;
  }

  getRepo(owner: string, name: string): Repo | undefined {
    return this.repos.get(`${owner}/${name}`);
  }

  listRepos(owner: string): Repo[] {
    const result: Repo[] = [];
    for (const repo of this.repos.values()) {
      if (repo.owner === owner) {
        result.push(repo);
      }
    }
    return result;
  }

  allRepos(): Repo[] {
    return Array.from(this.repos.values());
  }

  nextLabelId(repo: Repo): number {
    return repo.labelSeq++;
  }

  nextCommentId(repo: Repo): number {
    return repo.commentSeq++;
  }
}
