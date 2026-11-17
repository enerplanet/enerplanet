# `model-variant`

An **interactive step** that makes a **family copy** of the saved model and records it.

It is a step the user starts. There is no `auto`: nothing runs on arrival, and the node carries its own forward
action — an interactive module advances by running itself (`shell/actions.ts`: the frame's `Continue` is gone).

## What it does

- **Reads `modelId` (required) and writes `modelVariant`.** The write is the record of the copy: the copy's id,
  the family's own original, and the copy's title. `modelVariant` is a **core port** (`@model-builder/core`) and
  not an `advancedParams` entry because the compare node declares it `required`, which is what places the
  comparison *after* this node by construction. Adding the port was a core change.
- **Gates on the record.** `validate()` reports an issue while no variant has been recorded, so the session rests
  on this node (it stays `stale`) and the user can still act. Once the record is present the gate is clean.
- **Copies through a slot.** The copy is created through an injected gateway (`source.ts`, installed with
  `setModelVariantGateway`); the shell supplies the implementation (`shell/modelVariantGateway.ts`, installed at
  startup). There is **no default**: a missing gateway is an error the run reports, naming the installer.
- **Never forks twice.** `run()` reads `modelVariant` before writing it and uses the read as the guard: a
  recorded variant means the copy was already made, so a second press seals a zero-diff step and creates nothing.
- **Shows what it made and links to it.** Once a variant exists the sidebar shows the copy's title and id, and a
  plain anchor to `/app/modelbuilder?model=<id>` — the builder's load contract (`shell/BuilderShell.tsx`). A
  module may import only `@model-builder/core` and `@spatialhub/i18n`, so it cannot use `react-router`; the
  anchor opens in this app and this tab.

## The copy rule

The rule is the model dashboard's `duplicateModel`
(`features/model-dashboard/services/modelService.ts`), **copied not imported** — a feature may not import another
feature — and pinned in `shell/modelVariantGateway.test.ts`. A copy *of a variant* records the same root in
`parent_model_id` and joins its `group_id`; a copy *of a root* records the root and takes its id as the family.
The title is versioned within the family (` v<n>`). The backend is the authority on families
(`backend/internal/model/handler/model_family.go`).

## Notes

- **No DOM in tests.** The view is covered by a static render (`react-dom/server`), as the templates are.
- **Regions:** `sidebar` (the form, the result and the forward action) and `bottom` (a status strip).
