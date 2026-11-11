import { useState, type FC, type ReactNode } from "react";
import { ArrowUpDown, ChevronDown, GripVertical, Minus, Plus, Search, type LucideIcon } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import type { Technology } from "@/features/technologies/services/technologyService";
import { asBuildingTechnology, findProducts } from "@/features/technologies/catalogue";

type ProductOrder = "name" | "cost";

/** A constraint's default value when it is a number. */
export const constraintValue = (product: Technology, key: string): number | undefined => {
  const value = product.constraints.find((c) => c.key === key)?.default_value;
  return typeof value === "number" ? value : undefined;
};

/** One line of a product's efficiency, investment cost and lifetime, those it has. */
export const productFacts = (product: Technology, type: string, t: (key: string, options?: Record<string, unknown>) => string): string => {
  // A PV product's yield comes from its module type, not cont_energy_eff.
  const efficiency = type === "pv_supply" ? undefined : constraintValue(product, "cont_energy_eff");
  const cost = constraintValue(product, "cost_energy_cap");
  const lifetime = constraintValue(product, "cont_lifetime");
  return [
    efficiency !== undefined && t("technologies.products.efficiency", { value: efficiency }),
    cost !== undefined && t("technologies.products.cost", { value: Math.round(cost) }),
    lifetime !== undefined && t("technologies.products.lifetime", { value: lifetime }),
  ]
    .filter(Boolean)
    .join(" · ");
};

/** The products by name, or by investment cost (cheapest first, those without one last, ties by name). */
export const sortProducts = (products: Technology[], order: ProductOrder): Technology[] =>
  order === "name"
    ? products
    : [...products].sort((a, b) => (constraintValue(a, "cost_energy_cap") ?? Infinity) - (constraintValue(b, "cost_energy_cap") ?? Infinity));

interface ProductCategoryProps {
  type: string;
  title: string;
  icon: LucideIcon;
  /** The catalogue products of this type. */
  products: Technology[];
  /** Keys of the products some building carries. */
  appliedProducts: string[];
  /** Key of the product being dragged. */
  draggedProduct?: string;
  onDragStart: (e: React.DragEvent<HTMLElement>, tech: Technology) => void;
  onDragEnd: () => void;
  onAddToAll?: (tech: Technology) => void;
  onRemoveFromAll?: (tech: Technology) => void;
}

/** One technology type as a list of its products, closed until opened, each draggable onto a building, with search and sort. */
export const ProductCategory: FC<ProductCategoryProps> = ({
  type, title, icon: Icon, products, appliedProducts, draggedProduct, onDragStart, onDragEnd, onAddToAll, onRemoveFromAll,
}) => {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [order, setOrder] = useState<ProductOrder>("name");
  const [tool, setTool] = useState<"search" | "sort" | null>(null);
  const [open, setOpen] = useState(false);
  // The tools sit in the summary, whose click would otherwise toggle the list; a tool opens it instead.
  const toggleTool = (e: React.MouseEvent, name: "search" | "sort") => {
    e.preventDefault();
    setOpen(true);
    setTool(tool === name ? null : name);
  };
  const shown = sortProducts(findProducts(products, query), order);
  if (products.length === 0) return null;

  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer select-none list-none items-center gap-2 px-2.5 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex-shrink-0 w-7 h-7 rounded-md bg-muted flex items-center justify-center">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">{title} ({products.length})</span>
        <ToolButton label={t("technologies.products.search")} active={tool === "search" || query !== ""} onClick={(e) => toggleTool(e, "search")}>
          <Search className="w-3.5 h-3.5" />
        </ToolButton>
        <ToolButton label={t("technologies.products.sort")} active={tool === "sort" || order !== "name"} onClick={(e) => toggleTool(e, "sort")}>
          <ArrowUpDown className="w-3.5 h-3.5" />
        </ToolButton>
        <ChevronDown className="w-4 h-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>

      <div className="px-2.5 pb-2.5 space-y-2">
        {tool === "search" && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("technologies.products.search")}
            aria-label={t("technologies.products.search")}
            autoFocus
            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary"
          />
        )}
        {tool === "sort" && (
          <select
            value={order}
            onChange={(e) => setOrder(e.target.value as ProductOrder)}
            aria-label={t("technologies.products.sort")}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
          >
            <option value="name">{t("technologies.products.sortName")}</option>
            <option value="cost">{t("technologies.products.sortCost")}</option>
          </select>
        )}
        {shown.length === 0 && <p className="px-1 text-xs text-muted-foreground">{t("technologies.noSearchResults")}</p>}

        {shown.map((product) => {
          const tech = asBuildingTechnology(product);
          const isApplied = appliedProducts.includes(product.key);
          return (
            <div
              key={product.key}
              className={`flex items-center gap-2 p-2 rounded-lg border border-border transition-all duration-200
                ${draggedProduct === product.key ? "opacity-50 scale-95" : "hover:shadow-md"}
                ${isApplied ? "border-primary/50 bg-primary/5" : "bg-background hover:bg-muted/50"}`}
            >
              {onAddToAll && (
                <RowButton label={t("technologies.addToAllBuildings")} onClick={() => onAddToAll(tech)} className="bg-primary/10 hover:bg-primary/20">
                  <Plus className="w-3.5 h-3.5 text-primary" />
                </RowButton>
              )}
              {isApplied && onRemoveFromAll && (
                <RowButton label={t("technologies.removeFromAllBuildings")} onClick={() => onRemoveFromAll(tech)} className="bg-red-100 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50">
                  <Minus className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                </RowButton>
              )}
              <button
                type="button"
                draggable
                onDragStart={(e) => onDragStart(e, tech)}
                onDragEnd={onDragEnd}
                className="flex-1 flex items-center gap-2 cursor-grab active:cursor-grabbing min-w-0 bg-transparent border-none p-0 text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">{product.alias}</div>
                  <div className="text-[10px] text-muted-foreground">{productFacts(product, type, t)}</div>
                </div>
                <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              </button>
            </div>
          );
        })}
      </div>
    </details>
  );
};

/** An icon that shows or hides one of the list's tools; highlighted while open or while its setting is in use. */
const ToolButton: FC<{ label: string; active: boolean; onClick: (e: React.MouseEvent) => void; children: ReactNode }> = ({ label, active, onClick, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    title={label}
    className={`w-7 h-7 rounded-md flex items-center justify-center transition-colors ${active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
  >
    {children}
  </button>
);

/** A small square action on a product row, with its label as a tooltip. */
const RowButton: FC<{ label: string; onClick: () => void; className: string; children: ReactNode }> = ({ label, onClick, className, children }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button onClick={onClick} aria-label={label} className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center transition-colors ${className}`}>
        {children}
      </button>
    </TooltipTrigger>
    <TooltipContent side="top">
      <p className="text-xs">{label}</p>
    </TooltipContent>
  </Tooltip>
);
