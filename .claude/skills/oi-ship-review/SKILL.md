---
name: oi-ship-review
description: >-
  OpenIslands ship gate. Use BEFORE building/baking a box image, before bumping or
  adding any npm dependency, before a release, or whenever the user says "ship review",
  "oi-ship-review", "review deps before shipping", "is this safe to ship", "gate the
  image build", or "did anything sketchy get into the lockfile". Runs a single-pass
  supply-chain + source-quality gate over the OpenIslands monorepo — lockfile diff,
  provenance (npm audit signatures), the structural pnpm controls (release-age +
  install-script blocking), a fallow source audit, and the full build/test suite —
  and returns one GO / NO-GO verdict. Specific to the OpenIslands monorepo at the
  repo root (has pnpm-workspace.yaml with allowBuilds).
---

# OpenIslands ship gate (`/oi-ship-review`)

## Why this exists (the actual threat model)

OpenIslands boxes are **single-tenant, no-egress, no-hosting**: a box never emits
customer data and never serves anything outward. The box **image is built on the
developer's MacBook and copied over** — customers never run `npm`, and there is no
runtime dependency tree to poison.

That collapses the npm supply-chain risk to exactly one surface: **a malicious
package version landing in the lockfile on the build machine, where it could run at
`pnpm install`/`pnpm build` time** (the machine that *does* have network + secrets).
Runtime risk is contained by the no-egress box; build-time risk is not. This gate
guards that one surface, and it runs on the MacBook before an image is baked.

It is **not** a rewrite. The repo already has ~80% of the controls; this gate makes
the residual review a checklist instead of a vibe. See the decision doc
"OpenIslands: trust, ship process & rewrite-vs-adopt" for the full cost case.

## When to run it

- Before baking a box image to ship to a customer.
- After `pnpm add` / `pnpm update` / any change to `pnpm-lock.yaml`, before committing it.
- Before cutting a release.

Single-pass. No subagents, no fan-out — it's a sequence of checks that produce one verdict.

## The gate

Run from the repo root. Work top to bottom; collect every result, don't stop at the
first warning — the verdict needs the whole picture. Each step says what a finding means.

### 0. Structural controls (preflight — these are the load-bearing ones)

These two pnpm settings do more than the rest of the gate combined, because they
neutralize the two most common npm attacks (malicious postinstall + fresh-publish
takeover) *before* code ever runs. **Both are blocking** — a gate that lets you ship
with either disabled isn't a gate.

1. **Install-script blocking — verify the *exact* allowlist, not just its presence.**
   pnpm 10+ blocks all dependency build/postinstall scripts by default and only runs
   the ones explicitly set `true` under `allowBuilds:`. Read it:

   ```bash
   sed -n '/allowBuilds:/,/^[^[:space:]]/p' pnpm-workspace.yaml
   ```

   The only entry that should be `true` is `esbuild`. **NO-GO if:** the `allowBuilds:`
   block is missing entirely, OR any package other than `esbuild` is set `true` that
   this review hasn't explicitly approved. A new `<pkg>: true` is someone handing a
   dependency the right to run code at install — the exact thing the block exists to stop.

2. **Release-age pin — NO-GO if absent.** A numeric `minimumReleaseAge:` (minutes)
   makes `pnpm install` *natively refuse* any version published more recently than that
   window. That's the single strongest net for compromised-package incidents, because
   the malicious version is almost always hours old. Verify it's actually a number:

   ```bash
   pnpm config get minimumReleaseAge    # must print a number, not "undefined"
   grep -E '^minimumReleaseAge:' pnpm-workspace.yaml
   ```

   `minimumReleaseAgeExclude:` alone does **not** enforce anything. If the numeric pin
   is missing/`undefined` → **NO-GO until added.** Offer the fix and let the user pick
   the window (1440 = 1 day, 2880 = 2 days, 4320 = 3 days):

   ```yaml
   # pnpm-workspace.yaml — beside the existing minimumReleaseAgeExclude
   minimumReleaseAge: 2880   # 2 days; nothing newer than this installs
   ```

   pnpm 11.5.1 enforces this even under `--frozen-lockfile`. Don't downgrade it to a
   note — the whole fresh-publish defense rests on it.

### 1. What changed (the full review surface)

The lockfile is not the only thing that gates supply-chain risk — `.npmrc`,
`pnpm-workspace.yaml` (allowBuilds/release-age/excludes), the package manifests, and
`patches/**` (this repo has `patchedDependencies`) all change what executes. Review the
whole surface; don't grep the lockfile for a couple of fields (that loses names,
removals, and truncates):

```bash
git diff -- pnpm-lock.yaml package.json 'packages/*/package.json' 'apps/**/package.json' \
            pnpm-workspace.yaml .npmrc 'patches/**'
git status --porcelain pnpm-lock.yaml
```

If nothing in that set changed, there's no new dependency to vet — skip to step 4. For
each added or version-bumped package, note name + old→new. A bump you didn't initiate
(transitive churn from one direct add) is where a poisoned transitive dep hides.

### 2. Install frozen, then verify signatures

Install **frozen** — the gate must review exactly what ships, never let install mutate
the lockfile or re-resolve underneath you:

```bash
pnpm install --frozen-lockfile    # NO-GO if this fails (lockfile/manifest drift)
npm audit signatures
```

`npm audit signatures` checks registry signatures and verifies provenance attestations
**when they're present**. It does *not* enumerate packages that lack provenance and does
*not* fail merely because provenance is absent — so don't claim it detects "lost
provenance". Read it for what it is:

- A **verification failure** on a signed/attested package → **NO-GO** (tampering signal).
- A **network/TUF failure** (e.g. can't fetch Sigstore metadata, 403) → **inconclusive,
  treat as NO-GO**, never as pass. Re-run with connectivity.
- Clean → good. (Absence of provenance on a package that never had it is just a note.)

If you specifically need to know whether a *changed* package dropped its attestation,
compare metadata explicitly: `npm view <pkg>@<old> dist.attestations` vs `@<new>` — but
that's an optional deep-dive, not the default verdict.

### 3. New build-script requests (native command)

A version newly asking to run a build/postinstall script is the classic injection
vector. Use pnpm's native report rather than grepping install output:

```bash
pnpm ignored-builds
```

This lists packages whose build scripts pnpm blocked. Anything here that wasn't blocked
before — a charting/data lib that suddenly wants a postinstall — gets investigated
*before* you'd ever consider an `allowBuilds: <pkg>: true`. Default answer is "no".

### 4. Source-quality audit (your code, not the deps)

`fallow audit` reviews **your changed source files** (against the git merge-base) for
dead code, complexity, and duplication, returning a pass/warn/fail verdict. It does
*not* inspect npm tarballs — that's steps 1–3. This half catches the "agent edited the
manifest/runtime and left a mess" failure mode.

```bash
fallow audit --format json    # NOTE: --format json, not --json (which errors)
```

Treat `fail` as NO-GO, `warn` as a note (not blocking unless it touches a
security-relevant path).

### 5. The repo's own required gate — all of it

CI treats `validate:templates` and `e2e` as required (`.github/workflows/ci.yml`), so a
ship gate that skips them can false-GO on broken templates/examples. Run the full set:

```bash
pnpm lint && pnpm build && pnpm typecheck && pnpm test && pnpm validate:templates && pnpm e2e
```

Green here is non-negotiable — a dep change that breaks any of these doesn't ship
regardless of how clean its provenance is.

## The verdict

End with exactly this block so the result is skimmable:

```
## Ship review: GO | NO-GO

Structural controls : allowBuilds = {esbuild} only ✓/✗ · release-age pinned ✓/✗ (window: N)
Dependency changes  : <N packages changed, or "none">
Signatures          : verified clean / verification FAILED / inconclusive (network)
New build scripts   : none new / <pkg now requests a build script>
Source audit        : pass / warn / fail
Build·test·templates·e2e : pass / fail

Verdict: GO — <one line>
   (or) NO-GO — <the specific failing check and what to do>
```

**NO-GO if any of:**
- `allowBuilds:` missing, or any package other than `esbuild` set `true` without explicit
  approval in this review;
- numeric `minimumReleaseAge:` missing/`undefined` (offer the fix; stays NO-GO until added);
- `pnpm install --frozen-lockfile` fails (lockfile/manifest drift);
- `npm audit signatures` reports a verification failure, **or** can't complete (network/TUF) —
  inconclusive counts as NO-GO;
- a changed package newly appears in `pnpm ignored-builds` (new build-script request) with no
  justification;
- `fallow audit` fails;
- any of `build · typecheck · test · validate:templates · e2e · lint` is red.

**Note-but-GO:** `fallow warn` on a non-security path; changed packages that simply never had
provenance (absence ≠ tampering).

## Scope notes

- **npm only.** The boxes ship no Rust/Cargo tree, so this gate doesn't cover Cargo.
  If that changes, add a `cargo audit` step here — don't build a separate gate.
- **One source of truth.** This gate verifies controls; it doesn't duplicate the CI
  release pipeline (OIDC trusted publishing + `--provenance`, already best-in-class).
  ponytail: if a check here starts overlapping CI, delete it here.
