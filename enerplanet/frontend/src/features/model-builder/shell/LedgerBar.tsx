/**
 * The ledger bar — the frame's bottom band (`spec/frame.md` §2, §3.2).
 *
 * Collapsed by default and dense: the last **applied** transaction as a signed line, and a marker when
 * anything sits beyond the cursor. Expanded it is the whole log, newest first, with the discarded tail drawn
 * as discarded — that is the one view that answers "what happened, and how much of it still counts".
 *
 * It carries no module status: store and history live here, anything a module wants to say belongs in its own
 * `bottom` slot. And it holds no history of its own — `ledgerState` derives every line from the log and the
 * cursor, so this component cannot show a state the store is not in.
 */

import { useState } from "react";
import { useTranslation } from "@spatialhub/i18n";
import { ledgerRows, ledgerSummary, type LedgerRow } from "./ledgerState";
import type { Store } from "../core/store";

/** One transaction, on one line. */
const Line: React.FC<{ row: LedgerRow }> = ({ row }) => {
  const { t } = useTranslation();

  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 font-mono text-xs">
      <span className="text-muted-foreground/70">#{row.revision}</span>

      {row.kind === "jump" && (
        <span className="rounded bg-muted px-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {t("modelBuilder.ledger.jump")}
        </span>
      )}

      {row.nodeId !== undefined && <span className="text-muted-foreground">{row.nodeId}</span>}

      {row.auto && (
        <span className="rounded bg-muted px-1 text-[0.65rem] uppercase tracking-wide text-muted-foreground">
          {t("modelBuilder.ledger.auto")}
        </span>
      )}

      {row.changes.map((change) => (
        <span
          key={`${change.sign}${change.port}`}
          className={
            change.sign === "+"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-rose-600 dark:text-rose-400"
          }
        >
          {change.sign}
          {change.port}
        </span>
      ))}
    </span>
  );
};

export const LedgerBar: React.FC<{ store: Store }> = ({ store }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const summary = ledgerSummary(store.log, store.cursor);

  return (
    <section
      className={`shrink-0 border-t border-border bg-card ${open ? "flex h-1/5 min-h-0 flex-col" : ""}`}
    >
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full shrink-0 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-left hover:bg-muted"
      >
        <span className="text-xs text-muted-foreground/70">{open ? "▾" : "▸"}</span>
        <span className="text-xs font-medium text-muted-foreground">
          {t("modelBuilder.ledger.history")}
        </span>

        {summary.last === undefined ? (
          <span className="text-xs text-muted-foreground/70">{t("modelBuilder.ledger.empty")}</span>
        ) : (
          <Line row={summary.last} />
        )}

        {summary.discarded > 0 && (
          <span className="ml-auto rounded-full bg-amber-500/10 px-2 py-0.5 text-[0.65rem] font-medium text-amber-700 dark:text-amber-400">
            {t("modelBuilder.ledger.discarded")} · {summary.discarded}
          </span>
        )}
      </button>

      {open && (
        <ul className="min-h-0 flex-1 overflow-auto px-4 pb-2">
          {ledgerRows(store.log, store.cursor).map((row) => (
            <li key={row.revision} className="flex items-baseline gap-2 py-0.5">
              <span className={row.discarded ? "opacity-40" : ""}>
                <Line row={row} />
              </span>
              {row.discarded && (
                <span className="text-[0.65rem] uppercase tracking-wide text-muted-foreground/70">
                  {t("modelBuilder.ledger.discarded")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
};

export default LedgerBar;
