import { useEffect, useState, type FC } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
} from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import type { Technology } from "@/features/technologies/services/technologyService";
import { loadCatalogue, productsOfType } from "@/features/technologies/catalogue";
import { DEFAULT_USABLE_SHARE } from "@/features/configurator/building-config/usePvMode";

interface ProductPickerDialogProps {
  open: boolean;
  /** The technology type to choose a product for. */
  type: string | null;
  /** The product the building already uses, preselected. */
  current?: string;
  applyToAll: boolean;
  /** usableShare is set for PV applied to all buildings: the share of each roof its panels may cover. */
  onPick: (product: Technology, usableShare?: number) => void;
  onDefineOwn: (product: Technology) => void;
  onClose: () => void;
}

const constraintValue = (product: Technology, key: string): number | undefined => {
  const value = product.constraints.find((c) => c.key === key)?.default_value;
  return typeof value === "number" ? value : undefined;
};

/**
 * Lists the catalogue products of one technology type to choose from; a type's
 * only product is applied without asking, except PV for all buildings, which
 * asks for the usable roof share.
 */
export const ProductPickerDialog: FC<ProductPickerDialogProps> = ({ open, type, current, applyToAll, onPick, onDefineOwn, onClose }) => {
  const { t } = useTranslation();
  const [products, setProducts] = useState<Technology[] | null>(null);
  const [selected, setSelected] = useState<string | undefined>(current);
  const [sharePercent, setSharePercent] = useState(DEFAULT_USABLE_SHARE * 100);
  const asksShare = applyToAll && type === "pv_supply";

  useEffect(() => {
    setProducts(null);
    if (!open || !type) return;
    let cancelled = false;
    loadCatalogue().then((all) => {
      if (cancelled) return;
      const ofType = productsOfType(all, type);
      setSharePercent(DEFAULT_USABLE_SHARE * 100);
      if (ofType.length === 1 && !asksShare) {
        onPick(ofType[0]);
        return;
      }
      setProducts(ofType);
      setSelected(current && ofType.some((p) => p.key === current) ? current : ofType[0]?.key);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onPick is a new function every render
  }, [open, type, current, asksShare]);

  const chosen = products?.find((p) => p.key === selected);
  const shareValid = sharePercent > 0 && sharePercent <= 100;
  const pick = () => chosen && onPick(chosen, asksShare ? sharePercent / 100 : undefined);
  if (!products) return null;

  return (
    <AlertDialog open={open} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent className="max-w-2xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{t("technologies.products.title", { type: type ? t(`technologies.types.${type}`, { defaultValue: type }) : "" })}</AlertDialogTitle>
          <AlertDialogDescription>
            {applyToAll ? t("technologies.products.applyToAll") : t("technologies.products.applyToBuilding")}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="max-h-[55dvh] overflow-auto border-y border-border py-2">
          {products.map((product) => {
            // A PV product's yield comes from its module type, not cont_energy_eff.
            const efficiency = type === "pv_supply" ? undefined : constraintValue(product, "cont_energy_eff");
            const cost = constraintValue(product, "cost_energy_cap");
            const lifetime = constraintValue(product, "cont_lifetime");
            return (
              <label
                key={product.key}
                className={`flex gap-3 px-3 py-2.5 rounded-lg cursor-pointer hover:bg-muted/40 ${selected === product.key ? "bg-primary/5" : ""}`}
              >
                <input
                  type="radio"
                  name="product"
                  checked={selected === product.key}
                  onChange={() => setSelected(product.key)}
                  className="mt-1 accent-primary"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{product.alias}</p>
                  <p className="text-xs text-muted-foreground">
                    {[
                      efficiency !== undefined && t("technologies.products.efficiency", { value: efficiency }),
                      cost !== undefined && t("technologies.products.cost", { value: Math.round(cost) }),
                      lifetime !== undefined && t("technologies.products.lifetime", { value: lifetime }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {(product.manufacturer || product.source) && (
                    <p className="text-[10px] text-muted-foreground/80 truncate">
                      {[product.manufacturer, product.source].filter(Boolean).join(" · ")}
                    </p>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {asksShare && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t("technologies.products.usableShare")}</span>
            <span className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                step={5}
                value={sharePercent}
                onChange={(e) => setSharePercent(e.target.valueAsNumber)}
                aria-invalid={!shareValid}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-foreground"
              />
              <span className="text-muted-foreground">%</span>
            </span>
            <span className="text-xs text-muted-foreground">{t("technologies.products.usableShareHint")}</span>
          </label>
        )}

        <AlertDialogFooter className="gap-3">
          <Button variant="ghost" onClick={onClose} className="cursor-pointer">
            {t("common.cancel")}
          </Button>
          <Button variant="outline" disabled={!chosen} onClick={() => chosen && onDefineOwn(chosen)} className="cursor-pointer">
            {t("technologies.products.defineOwn")}
          </Button>
          <Button disabled={!chosen || (asksShare && !shareValid)} onClick={pick} className="cursor-pointer">
            {applyToAll ? t("technologies.paramDialog.applyToAllBuildings") : t("technologies.paramDialog.applyTechnology")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
