/**
 * Runnable check for a pull on a fresh machine.
 *
 *   node --experimental-transform-types check-pull.ts
 *
 * The flag is needed because GitStore uses a TypeScript parameter property,
 * which strip-only mode refuses.
 *
 * The bug this guards against: a fresh machine's pi-sync.json has no include
 * list, so a pull that reads the git tree through it cannot see the git copy
 * of pi-sync.json either. The include list never widens and the extra paths
 * (lib, prose, pi-memory-extension.json) never arrive. One pull has to bring
 * the git config and everything it declares.
 *
 * The whole run happens under a throwaway HOME and a seeded local repository,
 * so nothing on this machine is read or written. Like check-manifest.ts, a
 * resolve hook rewrites the .js specifiers of the sources to .ts (see
 * check-glob.ts for why plain Node cannot).
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sync-check-"));
process.env.HOME = path.join(tempRoot, "home");
fs.mkdirSync(process.env.HOME, { recursive: true });

registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (!specifier.endsWith(".js")) {
        throw error;
      }

      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
  },
});

const { loadConfig } = await import("./src/config/config.ts");
const { GitStore } = await import("./src/git/store.ts");
const { applySnapshot } = await import("./src/snapshot/apply.ts");

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: "check",
  GIT_AUTHOR_EMAIL: "check@example.com",
  GIT_COMMITTER_NAME: "check",
  GIT_COMMITTER_EMAIL: "check@example.com",
};

const git = (cwd: string, ...args: string[]): void => {
  execFileSync("git", args, { cwd, env: gitEnv, stdio: "pipe" });
};

try {
  // The "other machine": a repository holding a pushed snapshot whose
  // pi-sync.json declares the extra paths.
  const seed = path.join(tempRoot, "seed");
  fs.mkdirSync(seed, { recursive: true });
  git(seed, "init", "-b", "main");

  const seedFiles: Record<string, unknown> = {
    "pi-sync.json": {
      repository: "https://github.com/gravity-rose/pi-config.git",
      branch: "main",
      autoSync: true,
      include: ["lib/**", "prose/**", "pi-memory-extension.json", "pi-sync.json"],
    },
    "settings.json": { defaultModel: "check" },
    "lib/logo.ts": "export const logo = 1;\n",
    "prose/doc.md": "prose\n",
    "pi-memory-extension.json": { caps: 1 },
  };

  for (const [name, value] of Object.entries(seedFiles)) {
    const target = path.join(seed, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(
      target,
      typeof value === "string" ? value : `${JSON.stringify(value, null, "\t")}\n`,
    );
  }

  git(seed, "add", "-A");
  git(seed, "commit", "-m", "seed");

  // The fresh machine: only a config with the repository, no include list.
  const agentDir = path.join(process.env.HOME ?? "", ".pi", "agent");
  fs.mkdirSync(agentDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentDir, "pi-sync.json"),
    `${JSON.stringify({ repository: seed, branch: "main", autoSync: false }, null, "\t")}\n`,
  );

  const config = await loadConfig();
  const gitStore = new GitStore(config);

  await gitStore.prepare();

  const remote = await gitStore.readSnapshot();

  assert.ok(remote, "remote snapshot is read");
  await applySnapshot(remote);

  const readPaths = new Set(remote.files.map((file) => file.path));

  for (const expected of [
    "pi-sync.json",
    "settings.json",
    "lib/logo.ts",
    "prose/doc.md",
    "pi-memory-extension.json",
  ]) {
    assert.ok(readPaths.has(expected), `pull covers ${expected}`);
    assert.ok(
      fs.existsSync(path.join(agentDir, expected)),
      `pull writes ${expected}`,
    );
  }

  // The git copy of pi-sync.json lands, so the widened scope is what the
  // machine keeps for the runs that follow.
  const pulled = JSON.parse(
    fs.readFileSync(path.join(agentDir, "pi-sync.json"), "utf8"),
  ) as { include?: string[] };

  assert.deepEqual(pulled.include, [
    "lib/**",
    "prose/**",
    "pi-memory-extension.json",
    "pi-sync.json",
  ]);

  console.log(
    "check-pull: one pull on a fresh machine brings pi-sync.json and the extra paths",
  );
} finally {
  fs.rmSync(tempRoot, { force: true, recursive: true });
}
