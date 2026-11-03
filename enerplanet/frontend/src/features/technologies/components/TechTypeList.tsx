import { useEffect, useState, type FC } from "react";
import { Flame, Loader2, Search, Zap } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { ELECTRICITY_TYPES, HEAT_TYPES, asBuildingTechnology, defaultProduct, loadCatalogue } from "@/features/technologies/catalogue";
import type { Technology } from "@/features/technologies/services/technologyService";

interface TechTypeListProps {
  /** The building's technologies by type key; these are shown as added and cannot be picked. */
  added: Record<string, unknown>;
  onPick: (tech: Technology) => void;
}

/**
 * EnerPlanET's predefined technology types to add to a building, split into
 * electricity and heat and searchable by name. The caller supplies the frame
 * and its scroll height.
 */
export const TechTypeList: FC<TechTypeListProps> = ({ added, onPick }) => {
  const { t } = useTranslation();
  const [electricity, setElectricity] = useState<Technology[]>([]);
  const [heat, setHeat] = useState<Technology[]>([]);
  const [loading, setLoading] = useState(true);
  const [carrier, setCarrier] = useState<"electricity" | "heat">("electricity");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let current = true;
    loadCatalogue()
      .then((catalogue) => {
        if (!current) return;
        const typeCards = (types: string[]) =>
          types.flatMap((type) => {
            const product = defaultProduct(catalogue, type);
            return product ? [{ ...asBuildingTechnology(product), alias: t(`technologies.types.${type}`, { defaultValue: product.alias }) }] : [];
          });
        setElectricity(typeCards(ELECTRICITY_TYPES));
        setHeat(typeCards(HEAT_TYPES));
      })
      .catch((err) => console.error("Failed to load technologies:", err))
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [t]);

  const pool = carrier === "heat" ? heat : electricity;
  const q = search.trim().toLowerCase();
  const filtered = q === "" ? pool : pool.filter((tech) => tech.alias.toLowerCase().includes(q) || tech.key.toLowerCase().includes(q));

  const body = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center py-4">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (pool.length === 0) {
      return (
        <div className="px-3 py-3 text-sm text-muted-foreground">
          {carrier === "heat" ? t("technologies.noHeatTechnologies") : t("technologies.noTechnologies")}
        </div>
      );
    }
    if (filtered.length === 0) {
      return <div className="px-3 py-3 text-sm text-muted-foreground">{t("technologies.noSearchResults")}</div>;
    }
    return filtered.map((tech) => {
      const alreadyAdded = added[tech.key] !== undefined;
      return (
        <button
          key={tech.key}
          type="button"
          disabled={alreadyAdded}
          onClick={() => onPick(tech)}
          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${alreadyAdded ? "cursor-default opacity-40" : "hover:bg-muted"}`}
        >
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
            {(tech.alias || tech.key).charAt(0).toUpperCase()}
          </span>
          <span className="flex-1 truncate">{tech.alias}</span>
          {alreadyAdded && (
            <span className="text-[10px] text-muted-foreground">{t("regionSelector.buildingDialog.added")}</span>
          )}
        </button>
      );
    });
  };

  return (
    <>
      <div className="sticky top-0 z-10 bg-background px-2 pt-1 pb-1 border-b border-border">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("technologies.searchPlaceholder")}
            className="w-full rounded border border-border bg-background pl-6 pr-2 py-1 text-[11px] text-foreground outline-none focus:border-primary"
          />
        </div>
      </div>
      <div className="sticky top-0 z-10 flex items-center gap-0.5 bg-background px-2 pt-1 pb-1 border-b border-border">
        {([
          ["electricity", "technologies.carriers.electricity", Zap],
          ["heat", "technologies.carriers.heat", Flame],
        ] as const).map(([view, label, Icon]) => (
          <button
            key={view}
            type="button"
            onClick={() => setCarrier(view)}
            className={`flex flex-1 items-center justify-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              carrier === view ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50"
            }`}
          >
            <Icon className={`h-3 w-3 ${view === "heat" ? "text-orange-500" : "text-primary"}`} />
            {t(label)}
          </button>
        ))}
      </div>
      {body()}
    </>
  );
};
