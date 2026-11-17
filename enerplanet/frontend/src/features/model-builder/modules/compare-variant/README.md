# `compare-variant`

An **interactive view** that compares a family's root model against the variant, and links to the full compare
page.

It is a step the user looks at and moves on from. There is no `auto`: nothing runs on arrival, and the node
carries its own forward action — an interactive module advances by running itself (`shell/actions.ts`: the
frame's `Continue` is gone).

## What it does

- **Reads `modelVariant` (required) and writes nothing.** The two compared models come from that record —
  `rootModelId` and `variantModelId` — so `modelId` is not declared: it would tell the node nothing the pair
  does not already carry. Declaring `modelVariant` required is what places this node *after* the variant by
  construction. It is a **view**, so `affect` is empty and `run()` commits nothing but still seals the
  zero-diff trace an interactive step needs to be left behind.
- **Gates on the record, never on the variant's results.** `validate()` reports an issue while no variant has
  been made (nothing to compare). It deliberately does **not** require the variant to have results: a variant is
  a copy of the *model*, not of its results (`duplicateModel` copies the config, and results are not part of the
  create request), so a freshly made variant has none until someone runs it — a gate that demanded them would
  deadlock the flow. "The variant has not been run yet" is information the UI states, not a blocking issue.
- **Fetches both sides through one slot.** The summaries arrive through an injected gateway (`source.ts`,
  installed with `setCompareVariantGateway`); the shell supplies the implementation
  (`shell/compareVariantGateway.ts`, installed at startup). There is **no default**: a missing gateway is an
  error the view reports, naming the installer. A side with no results is reported as `null` (the UI says "not
  run yet") and a request that failed rejects (the UI says "could not load") — two different claims.
- **Shows a small, honest comparison.** Two sides (`Original` / `Variant`), three totals each — production,
  consumption, peak demand — and nothing derived. A side with no results says so rather than showing a zero as
  if it were a measurement.
- **Links to the full page.** A plain anchor to
  `/app/simulation-reports?model1=<rootModelId>&model2=<variantModelId>`, which the compare page seeds both
  sides from (`features/simulation-charts/SimulationCharts.tsx`). A module may import only `@model-builder/core`
  and `@spatialhub/i18n`, so it cannot use `react-router`; the anchor opens in this app and this tab.

## Notes

- **No DOM in tests.** The view is covered by a static render (`react-dom/server`), as the templates are.
- **Regions:** `sidebar` (the two sides, the link and the forward action) and `bottom` (a status strip).
- **The endpoint is `GET /models/:id/results/structured`** — the one the results page, the compare page and
  `result-overview` all read. It is copied into `shell/compareVariantGateway.ts`, not imported: a feature may
  not import another feature.
