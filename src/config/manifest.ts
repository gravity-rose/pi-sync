import fs from "node:fs";

import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, EXTERNAL_FILES } from "../domain/constants.js";
import { globToRegExp, matchesGlob, patternHead } from "../utils/glob.js";
import { localConfigPath } from "../utils/path-utils.js";

/**
 * The set of local paths pi-sync manages, resolved from pi-sync.json.
 *
 * Upstream hardcodes this list in the source. The fork reads `include` and
 * `exclude` from the same config file as the repository, so a directory that is
 * not one of upstream's four (`lib`, `prose`) can be synced without editing
 * code. Entries in `include` are ADDED to the defaults; `exclude` is applied on
 * top of the built-in deny rules.
 */
export type SyncManifest = {
  include: string[];
  exclude: string[];
  includeMatchers: RegExp[];
  excludeMatchers: RegExp[];
  /** Root-level Git pathspecs covering everything in `include`. */
  pathspecs: string[];
  /** First path segments worth descending into while scanning. */
  heads: string[];
  /** Set when a pattern can match at any depth, so every directory is scanned. */
  descendAll: boolean;
};

export type ManifestConfig = {
  include?: string[];
  exclude?: string[];
};

let cache: { key: string; manifest: SyncManifest } | undefined;

/**
 * Resolve the manifest, re-reading pi-sync.json when it changes on disk.
 *
 * @param configPath Path to the pi-sync config file.
 */
export function resolveManifest(
  configPath: string = localConfigPath(),
): SyncManifest {
  const key = fileKey(configPath);

  if (cache?.key === key) {
    return cache.manifest;
  }

  const manifest = buildManifest(readManifestConfig(configPath));

  cache = { key, manifest };

  return manifest;
}

/**
 * Build a manifest from config values, applying the upstream defaults.
 *
 * @param config Include and exclude entries from the config file.
 */
export function buildManifest(config: ManifestConfig): SyncManifest {
  const include = dedupe([...DEFAULT_INCLUDE, ...stringList(config.include)]);
  const exclude = dedupe([...DEFAULT_EXCLUDE, ...stringList(config.exclude)]);
  const heads = include.map(patternHead);

  return {
    include,
    exclude,
    includeMatchers: include.map(globToRegExp),
    excludeMatchers: exclude.map(globToRegExp),
    pathspecs: pathspecsFor(include),
    heads: heads.filter(isSafeHead),
    descendAll: heads.some((head) => head === ""),
  };
}

/**
 * Build one manifest covering two configs at once: what the local pi-sync.json
 * declares plus what the git copy declares. A pull reads and writes through
 * this union, so a machine whose local config lists nothing still fetches
 * every path the git config covers, in the same run.
 *
 * @param local Include and exclude entries from the local config file.
 * @param remote Git copy of pi-sync.json: its parsed entries, or the raw JSON
 *   text as a snapshot carries it.
 */
export function mergeManifestConfigs(
  local: ManifestConfig,
  remote: ManifestConfig | string | undefined,
): SyncManifest {
  const remoteConfig = parseConfigJson(remote);

  return buildManifest({
    include: [...stringList(local.include), ...stringList(remoteConfig.include)],
    exclude: [...stringList(local.exclude), ...stringList(remoteConfig.exclude)],
  });
}

/**
 * Manifest for reading and applying a remote snapshot: the local config file
 * merged with the git copy of pi-sync.json carried inside the snapshot.
 * Unparsable remote config degrades to the local scope, never to a crash.
 *
 * @param remoteConfigJson Raw JSON text of the remote pi-sync.json, if any.
 */
export function manifestForRemoteConfig(
  remoteConfigJson: string | undefined,
): SyncManifest {
  return mergeManifestConfigs(
    readManifestConfig(localConfigPath()),
    remoteConfigJson,
  );
}

/**
 * Check whether a path is managed, by include pattern or as an external file.
 *
 * @param syncPath Path relative to the agent directory.
 * @param manifest Resolved manifest.
 */
export function isInManifest(
  syncPath: string,
  manifest: SyncManifest = resolveManifest(),
): boolean {
  return (
    matchesGlob(syncPath, manifest.includeMatchers) ||
    EXTERNAL_FILES.has(syncPath)
  );
}

/**
 * Check whether a path is excluded by an `exclude` pattern.
 *
 * @param syncPath Path relative to the agent directory.
 * @param manifest Resolved manifest.
 */
export function isExcludedByManifest(
  syncPath: string,
  manifest: SyncManifest = resolveManifest(),
): boolean {
  return matchesGlob(syncPath, manifest.excludeMatchers);
}

/**
 * Check whether a directory could contain an included file, so a scan can skip
 * the rest of the tree.
 *
 * @param relativeDirectory Directory path relative to the agent directory.
 * @param manifest Resolved manifest.
 */
export function shouldDescend(
  relativeDirectory: string,
  manifest: SyncManifest = resolveManifest(),
): boolean {
  if (manifest.descendAll) {
    return true;
  }

  const head = relativeDirectory.split("/")[0] ?? "";

  return manifest.heads.includes(head);
}

/**
 * Root-level Git pathspecs managed by pi-sync.
 *
 * @param manifest Resolved manifest.
 */
export function manifestPathspecs(
  manifest: SyncManifest = resolveManifest(),
): string[] {
  return [...manifest.pathspecs, ...EXTERNAL_FILES];
}

function pathspecsFor(include: readonly string[]): string[] {
  const heads = include
    .map(patternHead)
    .filter(isSafeHead);

  return dedupe(heads);
}

function isSafeHead(head: string): boolean {
  // Heads become root-level Git pathspecs and delete targets in the clone, and
  // include patterns arrive from the git copy of pi-sync.json, which is remote
  // input. A head of "." or ".." or an absolute segment must never get there.
  return head !== "" && head !== "." && head !== ".." && !head.startsWith("/");
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(
    (item): item is string => typeof item === "string" && item.trim() !== "",
  );
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function readManifestConfig(configPath: string): ManifestConfig {
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as ManifestConfig;
  } catch {
    // Missing or malformed config is handled by loadConfig, which reports it.
    return {};
  }
}

function parseConfigJson(
  value: ManifestConfig | string | undefined,
): ManifestConfig {
  if (value == null) {
    return {};
  }

  if (typeof value === "object") {
    return value;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    return parsed != null && typeof parsed === "object"
      ? (parsed)
      : {};
  } catch {
    return {};
  }
}

function fileKey(configPath: string): string {
  try {
    const stat = fs.statSync(configPath);

    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}
