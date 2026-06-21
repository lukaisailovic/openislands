/**
 * Proposal store backed by the AppStateStore under `proposals/`. A proposal pins
 * the hash of the manifest it was proposed against, so a restarted server can
 * still apply it and a stale one (base manifest changed on disk) is rejected.
 */
import { createHash } from "node:crypto";
import type { AppStateStore } from "@openislands/storage";

export interface StoredProposal {
  manifest: string;
  diff: string;
  baseHash: string;
}

export function hashManifest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ProposalStore {
  save(proposal: StoredProposal): Promise<string>;
  load(id: string): Promise<StoredProposal | null>;
  remove(id: string): Promise<void>;
  /** Drop staged proposals whose baseHash no longer matches `currentHash` — apply_edit
   * already rejects those as stale, so they're dead weight. Returns how many it removed. */
  discardStale(currentHash: string): Promise<number>;
}

const isProposalId = (id: string): boolean => /^prop-[0-9a-f]{12,}$/.test(id);
const proposalKey = (id: string): string => `proposals/${id}.json`;
const idFromFile = (name: string): string => name.slice(0, -".json".length);

export function createProposalStore(store: AppStateStore): ProposalStore {
  return {
    async save(proposal) {
      const id = `prop-${createHash("sha256").update(proposal.manifest + proposal.baseHash + Date.now()).digest("hex").slice(0, 16)}`;
      await store.put(proposalKey(id), JSON.stringify(proposal));
      return id;
    },
    async load(id) {
      if (!isProposalId(id)) return null;
      const raw = await store.getText(proposalKey(id));
      return raw === null ? null : (JSON.parse(raw) as StoredProposal);
    },
    async remove(id) {
      if (isProposalId(id)) await store.delete(proposalKey(id));
    },
    async discardStale(currentHash) {
      const entries = await store.list("proposals");
      let removed = 0;
      for (const entry of entries) {
        const id = idFromFile(entry.name);
        if (!isProposalId(id)) continue;
        const raw = await store.getText(proposalKey(id));
        if (raw === null) continue;
        if ((JSON.parse(raw) as StoredProposal).baseHash === currentHash) continue;
        await store.delete(proposalKey(id));
        removed += 1;
      }
      return removed;
    },
  };
}
