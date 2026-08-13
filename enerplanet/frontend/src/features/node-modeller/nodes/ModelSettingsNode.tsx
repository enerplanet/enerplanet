/**
 * Node A — Model Settings (Plan P3, README_V2 §2.1 + §6.1).
 * Title/description/dates/resolution; advanced pypsa params collapsed by default.
 */
import { useState } from "react";
import type { NodeUiProps } from "../components/context-store";

const inputCls = "w-full rounded-md border bg-background px-3 py-2 text-sm";
const labelCls = "mb-1 block text-sm font-medium";

export function ModelSettingsNode({ store, goNext }: NodeUiProps) {
  const { meta, pypsa } = store.ctx;
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pypsaText, setPypsaText] = useState(() => JSON.stringify(pypsa, null, 2));
  const [pypsaError, setPypsaError] = useState<string>();

  const setMeta = (patch: Partial<import("../context/types").ModelMeta>) =>
    store.dispatch({ type: "set-meta", payload: patch });

  const applyPypsa = (text: string) => {
    setPypsaText(text);
    try {
      const parsed = JSON.parse(text || "{}") as Record<string, unknown>;
      store.dispatch({ type: "set-pypsa", payload: parsed });
      setPypsaError(undefined);
    } catch {
      setPypsaError("Invalid JSON — not applied");
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <header>
        <h2 className="text-lg font-semibold">Model Settings</h2>
        <p className="text-sm text-muted-foreground">
          Name your model and set the simulation period. Everything has sensible defaults — only a
          title is required.
        </p>
      </header>

      <div>
        <label className={labelCls} htmlFor="nm-title">
          Title
        </label>
        <input
          id="nm-title"
          className={inputCls}
          value={meta.title}
          onChange={(e) => setMeta({ title: e.target.value })}
        />
      </div>

      <div>
        <label className={labelCls} htmlFor="nm-desc">
          Description
        </label>
        <textarea
          id="nm-desc"
          className={inputCls}
          rows={2}
          value={meta.description ?? ""}
          onChange={(e) => setMeta({ description: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls} htmlFor="nm-from">
            From
          </label>
          <input
            id="nm-from"
            type="date"
            className={inputCls}
            value={meta.fromDate ?? ""}
            onChange={(e) => setMeta({ fromDate: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="nm-to">
            To
          </label>
          <input
            id="nm-to"
            type="date"
            className={inputCls}
            value={meta.toDate ?? ""}
            onChange={(e) => setMeta({ toDate: e.target.value })}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="nm-res">
            Resolution
          </label>
          <select
            id="nm-res"
            className={inputCls}
            value={meta.resolution ?? "1h"}
            onChange={(e) => setMeta({ resolution: e.target.value })}
          >
            <option value="1h">Hourly</option>
            <option value="15min">Quarter-hourly</option>
          </select>
        </div>
      </div>

      {/* Advanced (pypsa) — collapsed by default (§6.1 progressive disclosure) */}
      <div className="rounded-md border">
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-sm"
          onClick={() => setShowAdvanced((s) => !s)}
        >
          <span>Advanced simulation parameters</span>
          <span>{showAdvanced ? "▾" : "▸"}</span>
        </button>
        {showAdvanced && (
          <div className="border-t p-3">
            <textarea
              className={`${inputCls} font-mono text-xs`}
              rows={6}
              value={pypsaText}
              onChange={(e) => applyPypsa(e.target.value)}
              spellCheck={false}
            />
            {pypsaError && <p className="mt-1 text-xs text-red-600">{pypsaError}</p>}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={goNext}
          disabled={!meta.title.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-40"
        >
          Next: Area & Grid
        </button>
      </div>
    </div>
  );
}
