# `model-variant`

An **interactive step** that makes a **family copy** of the saved model and records it.

It is a step the user starts. There is no `auto`: nothing runs on arrival, and the node carries its own forward
action — an interactive module advances by running itself (`shell/actions.ts`: the frame's `Continue` is gone).

## What it does

- **Reads `modelId` (required) and writes `modelVariant` — and the switch.** The record of the copy names the
  copy's id, the family's own original, and the copy's title. `modelVariant` is a **core port**
  (`@model-builder/core`) and not an `advancedParams` entry because the compare node declares it `required`,
  which is what places the comparison *after* this node by construction. Adding the port was a core change. In
  the **same transaction** it writes `modelId` = the copy's id: the node already read `modelId`, so the rewrite
  is the supported read → rewrite shape and a self-edge (its own write is not pruned by its own invalidation).
  Committing `modelId` *is* the switch — this page is now on the variant, nothing navigates — and every node that
  reads `modelId` (both run nodes, the results node) goes `stale`, which is how the run downstream re-runs
  against the copy. The copy's own session row is the shell's, not the node's (`shell/variantSession.ts`).
- **Gates on the record.** `validate()` reports an issue while no variant has been recorded, so the session rests
  on this node (it stays `stale`) and the user can still act. Once the record is present the gate is clean.
- **Copies through a slot.** The copy is created through an injected gateway (`source.ts`, installed with
  `setModelVariantGateway`); the shell supplies the implementation (`shell/modelVariantGateway.ts`, installed at
  startup). There is **no default**: a missing gateway is an error the run reports, naming the installer.
- **Never forks twice.** `run()` reads `modelVariant` before writing it and uses the read as the guard: a
  recorded variant means the copy was already made, so a second press seals a zero-diff step and creates nothing.
- **Says what the switch did.** Once a variant exists the sidebar states that this page is now on the copy — its
  title and id — and the family's root original, the id the comparison reads as its baseline. Everything shown
  comes from the `modelVariant` port. There is **no link**: the page is not left.

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
