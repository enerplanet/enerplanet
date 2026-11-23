# Requirements — Publishing the EnerPlanET image to GHCR (and why old images must be purged first)

Status: planning / pre-action. **Do not flip the package visibility public until the steps below are done and verified.**

## Why this exists

The repo ships an environment-agnostic runtime image (`Dockerfile.ci`): the frontend reads its
config from `/config.js` at runtime (served from `FRONTEND_*` env vars), and **no build args or
production secrets are baked in**. This is what makes publishing the image publicly safe.

Recent images built from the current `Dockerfile.ci` are key-free by design.

**However**, images published **before** the env-agnostic refactor may have production keys
embedded inside them (e.g. baked `VITE_*`/deploy-time config, or secrets that were compiled in when
the image was built for prod). This is a hard constraint:

> **GitHub Package visibility is a property of the WHOLE package, not of individual image versions.**
> If you flip the `enerplanet` container package to public while old secret-bearing versions still
> exist, **everyone can pull those old versions too.**

Therefore the order is **strict**: purge the old versions first → then make the package public →
only then is the public surface limited to the env-agnostic images we keep.

---

## The constraint in one line

> **Public visibility leaks EVERY published version of the package, including ones with embedded
> production keys — so old images must be removed before the package can go public.**

---

## Build/test surface this affects (when this matters)

- `make local` has a `resolve-image` step: it checks GHCR for an image tagged
  `sha-<short>` for the current commit and reuses it if present, else builds locally.
  That pull path currently needs `docker login ghcr.io` because the package is private.
- Going public removes the login requirement for the pull path (see `.local/Makefile.docker`
  note and the `resolve-image` target in the root `Makefile`).

---

## Step 1 — Audit what is currently published

```bash
# Or org-owned package (the usual case for this repo):
gh api -H "Accept: application/vnd.github+json" \
  orgs/enerplanet/packages/container/enerplanet/versions \
  --jq '.[] | {id, name, created_at}' | sort

# User-owned package instead:
gh api -H "Accept: application/vnd.github+json" \
  user/packages/container/enerplanet/versions \
  --jq '.[] | {id, name, created_at}' | sort
```

For each version, decide whether it is:
- **Safe** — built from the env-agnostic `Dockerfile.ci` (no `VITE_*`/secrets baked). Keep.
- **Suspect** — predates the env-agnostic refactor, or you cannot prove it is key-free. **Must be purged.**

If a version's provenance is unknown, treat it as suspect. Do not assume.

> Because GHCR does **not** support secret/layer rewriting (no way to scrub a secret out of a
> retained version's history), an unknown/non-provable version cannot be made safe by editing it —
> it has to go.

---

## Step 2 — Purge every suspect version

```bash
# List the version ids (from Step 1), then delete each suspect one:
gh api --method DELETE \
  -H "Accept: application/vnd.github+json" \
  orgs/enerplanet/packages/container/enerplanet/versions/<VERSION_ID>
```

Deleting a version removes its tagged manifest from the package. Confirm each deleted id returns
HTTP 204.

### About retained layers

Purge at the package level removes the *versioned manifests*. A secret baked into a layer is
content-addressed and could in principle still be reachable if another retained tag references the
same layer. If you cannot guarantee that no retained image shares a layer with a purged
secret-bearing one, the only **unconditional** guarantee is Step 4 (new namespace).

Full audit of layer sharing is impractical to script reliably; prefer Step 4 when absolute
certainty is required.

---

## Step 3 — Verify the purge before going public

```bash
gh api -H "Accept: application/vnd.github+json" \
  orgs/enerplanet/packages/container/enerplanet/versions \
  --jq '.[] | {id, name, created_at}' | sort
```

Expected: **only** env-agnostic versions remain, and every suspect id from Step 1 is absent.
**Do not proceed to Step 4 / Step 5 until this list is clean.**

---

## Step 4 — (Stronger option, when purge alone can't be trusted)

If you cannot be certain that every old layer is gone (no unconditional scrub guarantee), do not
make the existing namespace public at all. Instead:

- Keep the `ghcr.io/enerplanet/enerplanet` namespace **private** (or delete it).
- Publish the env-agnostic images to a **new**, distinct name/namespace (e.g.
  `ghcr.io/enerplanet/enerplanet-app` under a fresh repo, or a new package name).
- Make **that new namespace** public.

This makes the guarantee unconditional: the public surface never touched the old data.

Trade-off: the pull path changes to the new name (update `GHCR_IMAGE_REPO` in `Makefile` /
`resolve-image`, `repos.conf`, and the deploy config accordingly).

---

## Step 5 — Make the (cleaned) package public

Only after Steps 1–3 (or Step 4) are complete and verified.

```bash
# Org-owned:
gh api --method PATCH \
  -H "Accept: application/vnd.github+json" \
  orgs/enerplanet/packages/container/enerplanet \
  -f visibility=public

# User-owned:
gh api --method PATCH \
  -H "Accept: application/vnd.github+json" \
  user/packages/container/enerplanet \
  -f visibility=public
```

(or the equivalent "Change visibility → Public" in the GitHub web UI.)

---

## Step 6 — Verify public pull works with no credentials

```bash
docker logout ghcr.io
docker manifest inspect ghcr.io/enerplanet/enerplanet:<tag>   # should succeed unauthenticated
```

After this, `make local`'s `resolve-image` pull path works on a fresh machine without
`docker login ghcr.io`.

---

## Rollback / risk notes

- **Public cannot be un-made cleanly once someone has pulled.** If you ever need to unpublish,
  you can set visibility back, but anyone who already pulled a public image keeps it. So getting
  the purge right **before** going public is the only meaningful control.
- **The image is env-agnostic, so public is safe *for the current code*.** The risk is entirely
  historical (old baked secrets), which is why the purge is the gate, not the current build.
- **Secrets in image history are not erasable.** There is no supported "rewrite this image's
  layers to remove a secret." The two safe paths are delete-the-version or new-namespace.

---

## Acceptance checklist

- [ ] Listed every published version and classified it safe vs. suspect
- [ ] Purged every suspect version from the `enerplanet` container package
- [ ] Re-listed versions and confirmed only env-agnostic versions remain
- [ ] (If absolute certainty needed) used a new public namespace instead of the existing one
- [ ] Made the cleaned package public
- [ ] Verified unauthenticated `docker manifest inspect` on a retained tag succeeds
- [ ] Updated `GHCR_IMAGE_REPO` / pull path if a new namespace was used
