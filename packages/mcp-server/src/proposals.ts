/**
 * File-backed proposal store under `.openislands/proposals/`. A proposal pins
 * the hash of the manifest it was proposed against, so a restarted server can
 * still apply it and a stale one (base manifest changed on disk) is rejected.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StoredProposal {
  manifest: string;
  diff: string;
  baseHash: string;
}

export function hashManifest(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export interface ProposalStore {
  save(proposal: StoredProposal): string;
  load(id: string): StoredProposal | null;
  remove(id: string): void;
}

export function createProposalStore(dir: string): ProposalStore {
  const pathFor = (id: string): string | null => (/^prop-[0-9a-f]{12,}$/.test(id) ? join(dir, `${id}.json`) : null);

  return {
    save(proposal) {
      const id = `prop-${createHash("sha256").update(proposal.manifest + proposal.baseHash + Date.now()).digest("hex").slice(0, 16)}`;
      mkdirSync(dir, { recursive: true });
      writeFileSync(pathFor(id)!, JSON.stringify(proposal));
      return id;
    },
    load(id) {
      const path = pathFor(id);
      if (!path || !existsSync(path)) return null;
      return JSON.parse(readFileSync(path, "utf8")) as StoredProposal;
    },
    remove(id) {
      const path = pathFor(id);
      if (path) rmSync(path, { force: true });
    },
  };
}
