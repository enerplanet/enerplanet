# `compare-variant`

An **interactive view** that compares a family's root model against the variant, and links to the
full compare page.

## What it does

- **Reads `modelVariant` (required) and writes nothing.** The two compared models come from that
  record (`rootModelId` and `variantModelId`); declaring `modelVariant` required is what places this
  node *after* the variant by construction. It is a view, so `affect` is empty and `run()` seals only
  the zero-diff trace an interactive step needs.
- **Gates on the record, never on the variant's results.** `validate()` reports an issue while no
  variant has been made. A variant that has not been run yet is stated in the UI, not a blocking
  issue.
- **Fetches both sides through one slot** — an injected gateway (`source.ts`, installed with
  `setCompareVariantGateway`, no default). It reads `GET /models/:id/results/structured`, the endpoint
  the results page and the compare page also use.
- Shows production, consumption and peak demand for `Original` / `Variant`, and links to
  `/app/simulation-reports?model1=<rootModelId>&model2=<variantModelId>` with a plain anchor.

**Regions:** `sidebar` and `bottom`.
