import { normalizeFClassToken } from "@/features/configurator/utils/buildingFeatureExtraction";

export interface FClassDetail {
    fClass: string;
    yearlyDemandKwh: number;
    peakLoadKw: number;
}

const parseFlexibleNumberString = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const compact = trimmed.replace(/[\s\u00A0\u202F]/g, "");

    // 1,234.56
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }

    // 1.234,56
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/\./g, "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
    }

    const normalized = compact.includes(",") && !compact.includes(".")
        ? compact.replace(",", ".")
        : compact;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        return parseFlexibleNumberString(value);
    }
    return null;
};

const parseStoredFClassDetails = (
    storedDetails: unknown,
    fClasses: string[],
    totalYearlyDemandKwh: number,
    totalPeakLoadKw: number,
): FClassDetail[] | null => {
    if (!storedDetails) return null;

    let parsed: unknown = storedDetails;
    if (typeof storedDetails === "string") {
        try {
            parsed = JSON.parse(storedDetails);
        } catch {
            return null;
        }
    }

    if (!Array.isArray(parsed) || parsed.length === 0) return null;

    const normalizedClasses = fClasses
        .map((value) => normalizeFClassToken(value))
        .filter(Boolean);
    const classOrder = normalizedClasses.length > 0 ? normalizedClasses : ["unknown"];

    const byClass = new Map<string, FClassDetail>();
    for (const [index, raw] of parsed.entries()) {
        if (!raw || typeof raw !== "object") continue;
        const record = raw as Record<string, unknown>;
        const fallbackClass = classOrder[index] ?? classOrder[0] ?? "unknown";
        const fClass =
            normalizeFClassToken(record.fClass ?? record.f_class ?? record.class) || fallbackClass;
        if (!fClass) continue;

        const yearlyDemandKwh =
            toFiniteNumber(
                record.yearlyDemandKwh ??
                record.yearly_demand_kwh ??
                record.demand_energy ??
                record.demandKwh,
            ) ?? 0;
        const peakLoadKw =
            toFiniteNumber(record.peakLoadKw ?? record.peak_load_kw ?? record.peak_kw) ?? 0;

        const existing = byClass.get(fClass);
        if (existing) {
            existing.yearlyDemandKwh += yearlyDemandKwh;
            existing.peakLoadKw += peakLoadKw;
            continue;
        }

        byClass.set(fClass, { fClass, yearlyDemandKwh, peakLoadKw });
    }

    if (byClass.size === 0) return null;

    const details: FClassDetail[] = [];
    for (const cls of classOrder) {
        const detail = byClass.get(cls);
        if (detail) {
            details.push(detail);
            byClass.delete(cls);
        } else {
            details.push({ fClass: cls, yearlyDemandKwh: 0, peakLoadKw: 0 });
        }
    }
    details.push(...byClass.values());

    const hasYearlyValue = details.some((detail) => detail.yearlyDemandKwh > 0);
    if (!hasYearlyValue && totalYearlyDemandKwh > 0) {
        const perClassDemand = Math.round((totalYearlyDemandKwh / details.length) * 100) / 100;
        for (const detail of details) {
            detail.yearlyDemandKwh = perClassDemand;
        }
    }

    const hasPeakValue = details.some((detail) => detail.peakLoadKw > 0);
    if (!hasPeakValue && totalPeakLoadKw > 0) {
        const perClassPeak = Math.round((totalPeakLoadKw / details.length) * 100) / 100;
        for (const detail of details) {
            detail.peakLoadKw = perClassPeak;
        }
    }

    return details;
};

export const buildFClassDetails = (
    fClasses: string[],
    totalYearlyDemandKwh: number,
    totalPeakLoadKw: number,
    storedDetails?: unknown,
): FClassDetail[] => {
    const normalizedClasses = fClasses
        .map((value) => normalizeFClassToken(value))
        .filter(Boolean);

    const classList = normalizedClasses.length > 0 ? normalizedClasses : ["unknown"];

    const stored = parseStoredFClassDetails(
        storedDetails,
        classList,
        totalYearlyDemandKwh,
        totalPeakLoadKw,
    );
    if (stored) return stored;

    const count = classList.length || 1;
    const perClassDemand = Math.round((totalYearlyDemandKwh / count) * 100) / 100;
    const perClassPeak = Math.round((totalPeakLoadKw / count) * 100) / 100;
    return classList.map((fc) => ({
        fClass: fc,
        yearlyDemandKwh: perClassDemand,
        peakLoadKw: perClassPeak,
    }));
};
