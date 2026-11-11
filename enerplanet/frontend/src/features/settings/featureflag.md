# Feature flags

User-toggleable switches, flipped at runtime in **Settings → Experimental** (no rebuild, no `.env`,
no restart). Use them for anything that ships behind a "not ready for everyone" gate.

Code lives next to this file:

| File | Role |
|---|---|
| `flags.ts` | the **registry** — one entry per toggle; ids and i18n keys are derived from it |
| `flags-store.ts` | zustand store (persisted in `localStorage` under `feature-flags`) + `useFeatureFlag` / `isFeatureFlagEnabled` |
| `FeatureFlagGate.tsx` | declarative wrapper for conditional rendering |
| `ExperimentalFeatures.tsx` | the settings panel that renders the registry |
| `flags.test.ts` | fails if a flag is malformed or a locale is missing its label/description |

## Add a toggle

1. One line in the `REGISTRY` array in `flags.ts`:

```ts
{ id: "myFeature", category: "experimental", default: false },
```

2. Two keys in each locale (`src/locales/{en,de,es,nl}.json`), inside `settings.featureFlags.flags`:

```json
"myFeature": {
  "label": "My Feature",
  "description": "One sentence on what it turns on."
}
```

Done — the panel lists it, the id is typed everywhere, and `flags.test.ts` tells you if a
translation is missing. Nothing else to register.

`category` is `"experimental"` (shown under the amber warning banner) or `"general"`.
`default` is the value used until the user flips it.

Rows are grouped by `category` in **registry order**. Every group after the first is preceded
by a divider and a small heading, whose label comes from
`settings.featureFlags.sections.<category>.title` — that is why only `experimental` has a
section key today: it sits below the `general` group. If you put a new category first, no
heading key is needed for it.

## Use it in the app

Reactive, inside a component:

```tsx
const on = useFeatureFlag("myFeature");
if (!on) return null;
```

Declarative:

```tsx
<FeatureFlagGate flag="myFeature">
  <MyFeaturePanel />
</FeatureFlagGate>
```

Outside React (route table setup, guards, services):

```ts
isFeatureFlagEnabled("myFeature");
```

A route:

```tsx
<Route path="/app/my-feature" element={
  <FeatureFlagGate flag="myFeature"><MyFeaturePage /></FeatureFlagGate>
} />
```

A sidebar/menu item: read the hook in `AppLayout` and filter the item, exactly like the
`hidden` flag on `SidebarItem`.

Because the store is reactive, flipping the switch re-renders every consumer live — the route
mounts/unmounts without a reload.

## Behaviour

- Only **explicit** choices are persisted. Nothing stored ⇒ the registry `default` wins, so a
  new flag ships off without touching storage.
- Storage: `localStorage["feature-flags"]` → `{ state: { enabled: { myFeature: true } }, version: 0 }`.
  Clearing that key resets every flag. `useFeatureFlagsStore.getState().reset()` does the same in code.
- Flags are **client preferences, not model state** — they survive model switches and reloads and
  belong in this store, not in a model/config store.
- Values are per-browser, not per-account. A user who clears storage is back to defaults.

## The Experimental tab itself is flag-gated

The tab is hidden by default. Opening **`/app/settings/experimental`** once enables the
`experimentalSettings` flag (persisted), activates the tab and rewrites the URL back to
`/app/settings` — the URL is a one-shot unlock, not a mode.

- Hide it again: switch **Experimental tab** off inside the panel (or the tab disappears on the
  next settings visit).
- Unlock again: open `/app/settings/experimental` again.

This keeps the tab out of the way for normal users while making it reachable by link for anyone
who needs it — no admin role, no env var.

## Gotchas

- Ids are typed (`FeatureFlagId`): a typo in `useFeatureFlag("...")` is a compile error.
- Don't gate on server-fetched permissions — that is what `Authorized` / `access_level` is for.
  Flags are for *unfinished* things, not for *unauthorised* things.
- `npm run i18n:check` cannot see `t(flag.labelKey)` (dynamic lookup), which is why
  `flags.test.ts` walks the registry against every locale file. Keep that test.
- Removing a flag means deleting its registry line and its locale keys; stored overrides for a
  gone id are ignored.
