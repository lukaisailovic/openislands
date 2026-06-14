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
}

const isProposalId = (id: string): boolean => /^prop-[0-9a-f]{12,}$/.test(id);
const proposalKey = (id: string): string => `proposals/${id}.json`;

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
  };
}
