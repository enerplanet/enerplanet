# Example modules — the templates

Two **teaching templates** a new module is copied from: `interactive/` — a step the user fills in and
submits — and `auto/` — a step that runs on arrival.

They are **not live modules**: neither is registered in the shell's catalogue, placed in the dev
flow, or imported by the app. They are also **not workspaces** and **not installable in place** —
each carries the `package.json` a *copy* needs, and its two `file:` dependencies are depth-relative,
correct from where a copy **lands** (`modules/<id>/`), not from where the template sits here. Do not
run `npm install` in the template directory.

## Copying one

```bash
cp -r src/features/model-builder/modules/examples/interactive \
      src/features/model-builder/modules/tariff-settings
```

Then change the id, the `name` and the `modelBuilder.<id>.` i18n prefix; register it in
`../shell/moduleRegistry.ts`; and make its test say something true about *it* rather than about the
example. `../README.md`'s "Adding a module" has the full walkthrough.

| template | what it is |
|---|---|
| `interactive/` | a step with a forward action: the user collects values and commits them. Declares **all four regions** on purpose — the demonstration of the frame. |
| `auto/` | a step with **no forward action**: it runs on arrival and advances by itself. Declares `overlay` (its run state) and `bottom`. |

For the full contract — the regions and their conventions, the map service, `seal`, the store rules,
`testSupport` and the slot conventions — read `../README.md`.
