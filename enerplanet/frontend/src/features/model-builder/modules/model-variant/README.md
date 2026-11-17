# `model-variant`

An **interactive step** that makes a **family copy** of the saved model and records it.

## What it does

- **Reads `modelId` (required) and writes `modelVariant`** — the copy's id, the family's root and the
  copy's title — **and, in the same transaction, `modelId` = the copy's id.** Committing `modelId`
  *is* the switch (this page is now on the variant), and every node that reads `modelId` goes
  `stale`, which is how the downstream run re-runs against the copy.
- **Gates on the record:** `validate()` reports an issue until a variant has been recorded, so the
  session rests here and the user can still act.
- **Copies through a slot** — an injected gateway (`source.ts`, installed with
  `setModelVariantGateway`, no default). The copy follows the model dashboard's `duplicateModel` rule,
  copied not imported.
- **Never forks twice** — `run()` reads `modelVariant` first and uses the read as the guard, so a
  second press creates nothing.

**Regions:** `sidebar` and `bottom`.
