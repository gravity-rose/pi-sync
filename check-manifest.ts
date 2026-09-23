/**
 * Runnable check for the manifest scope rules.
 *
 *   node check-manifest.ts
 *
 * pi-sync.json declares which paths sync, so it must itself always be in
 * scope. On a fresh machine the local file has no include list yet: when the
 * manifest built from it cannot see pi-sync.json, a pull cannot read the git
 * copy either, the include list never widens, and the extra paths (lib,
 * prose, pi-memory-extension.json) never arrive. The same union rule decides
 * what a pull may write on a machine that already has a config.
 *
 * manifest.ts reaches its dependencies through .js specifiers, which plain
 * Node does not rewrite to .ts (see check-glob.ts), so a resolve hook is
 * installed before the import below.
 */
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

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

const {
  buildManifest,
  isExcludedByManifest,
  isInManifest,
  manifestPathspecs,
  mergeManifestConfigs,
} = await import("./src/config/manifest.ts");

// A fresh machine's config has no include list, and the manifest still has to
// cover pi-sync.json: it is the file that widens the scope.
const fresh = buildManifest({});

assert.equal(isInManifest("pi-sync.json", fresh), true);
assert.ok(manifestPathspecs(fresh).includes("pi-sync.json"));

// A pull covers what the local config declares plus what the git config
// declares, so one run brings a fresh machine its extra paths.
const local = { include: ["prose/**"] };
const remote = {
  include: ["lib/**", "pi-memory-extension.json", "pi-sync.json"],
};
const union = mergeManifestConfigs(local, remote);

assert.equal(isInManifest("prose/simple-english.md", union), true);
assert.equal(isInManifest("lib/logo.ts", union), true);
assert.equal(isInManifest("pi-memory-extension.json", union), true);
assert.equal(isInManifest("pi-sync.json", union), true);

const specs = manifestPathspecs(union);

for (const head of [
  "lib",
  "prose",
  "pi-memory-extension.json",
  "pi-sync.json",
]) {
  assert.ok(specs.includes(head), `union pathspecs cover ${head}`);
}

// Excludes from either side hold in the union.
assert.equal(
  isExcludedByManifest(
    "lib/old.bak",
    mergeManifestConfigs(local, { include: ["lib/**"], exclude: ["**/*.bak"] }),
  ),
  true,
);

// A missing or malformed git config leaves the local scope alone.
assert.equal(
  isInManifest("lib/logo.ts", mergeManifestConfigs(local, undefined)),
  false,
);
assert.equal(
  isInManifest("lib/logo.ts", mergeManifestConfigs(local, "not json")),
  false,
);

// A broken or hostile pattern cannot smuggle a Git pathspec outside the
// repository root.
const hostile = mergeManifestConfigs(
  {},
  { include: ["../outside/**", "/etc/passwd"] },
);

assert.ok(
  manifestPathspecs(hostile).every(
    (head: string) => head !== ".." && head !== "." && !head.startsWith("/"),
  ),
);

console.log("check-manifest: all assertions passed");
