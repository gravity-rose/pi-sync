import { loadConfig } from "../config/config.js";
import { manifestForRemoteConfig } from "../config/manifest.js";
import type { Snapshot, SyncConfig, SyncState } from "../domain/types.js";
import { GitStore } from "../git/store.js";
import { configJsonFromFiles, createSnapshot } from "../snapshot/snapshot.js";
import { readState } from "../state/state.js";

export type SyncInputs = {
  config: SyncConfig;
  local: Snapshot;
  remote: Snapshot | undefined;
  state: SyncState;
  /** Remote paths the local manifest does not cover yet. */
  uncovered: string[];
};

/**
 * Load config, prepare the repo, and collect local/remote/state inputs.
 */
export async function syncInputs(): Promise<SyncInputs> {
  const config = await loadConfig();

  const gitStore = new GitStore(config);

  await gitStore.prepare();

  const remote = await gitStore.readSnapshot();
  const manifest = manifestForRemoteConfig(
    configJsonFromFiles(remote?.files ?? []),
  );

  return {
    config,
    local: await createSnapshot(),
    remote,
    state: await readState(),
    uncovered: await gitStore.uncoveredPaths(manifest),
  };
}
