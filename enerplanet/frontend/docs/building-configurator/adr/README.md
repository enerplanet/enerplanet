# Building Configurator ADRs

Architecture decision records for implementation-level choices made while
building the Building Configurator: state management shape, stage registry
mechanics, a library choice, a data-fetching pattern. One file per decision,
numbered in the order written.

This folder is for decisions scoped to this feature's code. Cross-repo or
thesis-level decisions (the c2t enrich endpoint contract, the API versioning
scheme, the choice to rebuild natively rather than port the prototype) are
recorded in the brain vault (`decisions/`), not here, and are only referenced
from an ADR when relevant.

## When to write one

Write an ADR when a choice has more than one reasonable option, is expensive to
reverse, or a future contributor (including yourself in six months) would
otherwise have to reconstruct the reasoning from the diff. Do not write one for
a choice with an obvious default or one dictated by an existing convention in
the codebase.

## Numbering and naming

`NNNN-short-slug.md`, four-digit, zero-padded, sequential. `0000-template.md`
is not a real decision; the first real one starts at `0001`.

## Format

Copy `0000-template.md`. Sections: Context, Decision, Consequences, Alternatives
considered. State is either `accepted` or `superseded by 000N`; there is no
`proposed` state here since a merged PR is the acceptance signal.

## Index

| ID | Title | State |
|---|---|---|
