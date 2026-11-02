import React, { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import { formatDateTime24h } from "@/utils/dateHelpers";
import { FALLBACK_COUNTRY, fetchGridPrices, gridPriceError, saveGridPrice, type GridPrice } from "@/features/grid-prices/api";
import { AdminManagementSkeleton } from "./components/AdminManagementSkeleton";

const INPUT_CLASS = "w-full px-2 py-1.5 text-xs bg-card border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring";

interface Draft {
	country: string;
	importCt: string;
	exportCt: string;
	source: string;
}

const toDraft = (p: GridPrice): Draft => ({
	country: p.country,
	importCt: String(p.import_ct_per_kwh),
	exportCt: String(p.export_ct_per_kwh),
	source: p.source,
});

const EMPTY_DRAFT: Draft = { country: "", importCt: "", exportCt: "0", source: "" };

interface PriceRowProps {
	readonly initial: Draft;
	readonly isNew?: boolean;
	readonly updated?: string;
	readonly onSaved: () => void;
}

/** One editable country row; saves on its own button. */
const PriceRow: React.FC<PriceRowProps> = ({ initial, isNew, updated, onSaved }) => {
	const { t } = useTranslation();
	const { showSuccess, showError } = useNotification();
	const [draft, setDraft] = useState(initial);
	const [saving, setSaving] = useState(false);

	const importCt = draft.importCt === "" ? Number.NaN : Number(draft.importCt);
	const exportCt = draft.exportCt === "" ? 0 : Number(draft.exportCt);
	const errorKey = Number.isNaN(importCt) ? "gridPrices.errors.importPositive" : gridPriceError(importCt, exportCt);
	const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
	const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [key]: e.target.value });
	const label = draft.country === FALLBACK_COUNTRY ? t("gridPrices.otherCountries") : draft.country;

	const save = async () => {
		setSaving(true);
		try {
			await saveGridPrice({ country: draft.country, import_ct_per_kwh: importCt, export_ct_per_kwh: exportCt, source: draft.source });
			showSuccess(t("gridPrices.saved", { country: label }));
			if (isNew) setDraft(EMPTY_DRAFT);
			onSaved();
		} catch (err) {
			const reason = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? String(err);
			showError(t("gridPrices.saveFailed", { country: label, reason }));
		} finally {
			setSaving(false);
		}
	};

	return (
		<tr className="border-t border-border align-top">
			<td className="py-2 pr-2 text-xs font-medium text-foreground capitalize">
				{isNew
					? <input className={INPUT_CLASS} value={draft.country} onChange={set("country")} placeholder={t("gridPrices.countryPlaceholder")} />
					: label}
			</td>
			<td className="py-2 pr-2 w-28"><input type="number" min={0} step="0.01" className={INPUT_CLASS} value={draft.importCt} onChange={set("importCt")} aria-label={t("gridPrices.purchase")} /></td>
			<td className="py-2 pr-2 w-28"><input type="number" min={0} step="0.01" className={INPUT_CLASS} value={draft.exportCt} onChange={set("exportCt")} aria-label={t("gridPrices.feedIn")} /></td>
			<td className="py-2 pr-2">
				<input className={INPUT_CLASS} value={draft.source} onChange={set("source")} aria-label={t("gridPrices.source")} />
				{dirty && errorKey && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{t(errorKey)}</p>}
			</td>
			<td className="py-2 pr-2 text-[11px] text-muted-foreground whitespace-nowrap">{updated ?? ""}</td>
			<td className="py-2 text-right">
				<button
					onClick={save}
					disabled={!dirty || !!errorKey || saving || draft.country.trim() === ""}
					className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-md border border-border bg-card text-foreground hover:bg-muted disabled:opacity-40"
				>
					{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isNew ? <Plus className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
					{isNew ? t("gridPrices.add") : t("gridPrices.save")}
				</button>
			</td>
		</tr>
	);
};

/** Admin tab: the default grid electricity prices per country. */
const GridPricesManagement: React.FC = () => {
	const { t } = useTranslation();
	const [prices, setPrices] = useState<GridPrice[] | null>(null);
	const load = useCallback(() => { fetchGridPrices().then(setPrices).catch(() => setPrices([])); }, []);
	useEffect(load, [load]);

	if (prices === null) return <AdminManagementSkeleton label={t("adminDashboard.loadingContent")} rows={3} />;
	return (
		<div className="bg-card border border-border rounded-lg p-4 space-y-3">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{t("gridPrices.title")}</h3>
				<p className="text-xs text-muted-foreground">{t("gridPrices.description")}</p>
			</div>
			<div className="overflow-x-auto">
				<table className="w-full">
					<thead>
						<tr className="text-left text-[11px] text-muted-foreground">
							<th className="font-medium pb-2">{t("gridPrices.country")}</th>
							<th className="font-medium pb-2">{t("gridPrices.purchase")}</th>
							<th className="font-medium pb-2">{t("gridPrices.feedIn")}</th>
							<th className="font-medium pb-2">{t("gridPrices.source")}</th>
							<th className="font-medium pb-2">{t("gridPrices.lastChanged")}</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{prices.map(p => (
							<PriceRow
								key={`${p.country}-${p.updated_at}`}
								initial={toDraft(p)}
								updated={p.updated_at ? `${formatDateTime24h(p.updated_at)}${p.updated_by ? `, ${p.updated_by}` : ""}` : undefined}
								onSaved={load}
							/>
						))}
						<PriceRow initial={EMPTY_DRAFT} isNew onSaved={load} />
					</tbody>
				</table>
			</div>
		</div>
	);
};

export default GridPricesManagement;
