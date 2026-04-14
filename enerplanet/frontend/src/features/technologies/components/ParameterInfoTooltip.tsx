import { Info } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";

interface ParameterInfoTooltipProps {
  alias: string;
  paramKey: string;
  description?: string;
}

// Parameter description keys for translation
const parameterDescriptionKeys: Record<string, string> = {
  cont_energy_cap_max: "parameters.cont_energy_cap_max",
  cont_energy_cap_max_systemwide: "parameters.cont_energy_cap_max_systemwide",
  cont_energy_cap_min: "parameters.cont_energy_cap_min",
  cont_energy_cap_scale: "parameters.cont_energy_cap_scale",
  cont_energy_eff: "parameters.cont_energy_eff",
  cont_export_cap: "parameters.cont_export_cap",
  cont_lifetime: "parameters.cont_lifetime",
  cont_storage_cap_max: "parameters.cont_storage_cap_max",
  cont_storage_cap_min: "parameters.cont_storage_cap_min",
  cont_storage_loss_rate: "parameters.cont_storage_loss_rate",
  cont_om_annual: "parameters.cont_om_annual",
  cont_om_annual_fixed: "parameters.cont_om_annual_fixed",
  cont_om_prod: "parameters.cont_om_prod",
  monetary_depreciation_rate: "parameters.monetary_depreciation_rate",
  monetary_discount_rate: "parameters.monetary_discount_rate",
  monetary_interest_rate: "parameters.monetary_interest_rate",
  monetary_inv_cost_energy_cap: "parameters.monetary_inv_cost_energy_cap",
  monetary_inv_cost_storage_cap: "parameters.monetary_inv_cost_storage_cap",
  monetary_purchase_cost_sum: "parameters.monetary_purchase_cost_sum",
  monetary_sale_cost_sum: "parameters.monetary_sale_cost_sum",
};

export default function ParameterInfoTooltip({
  alias,
  paramKey,
  description,
}: Readonly<ParameterInfoTooltipProps>) {
  const { t } = useTranslation();
  
  const getDescription = (key: string, aliasText: string, customDescription?: string): string => {
    if (customDescription) return customDescription;
    if (parameterDescriptionKeys[key]) {
      return t(parameterDescriptionKeys[key], { defaultValue: `${aliasText} - Configure this parameter based on your technology specifications.` });
    }
    return t('parameters.defaultDescription', { alias: aliasText, defaultValue: `${aliasText} - Configure this parameter based on your technology specifications.` });
  };
  
  const tooltipDescription = getDescription(paramKey, alias, description);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className="p-1 rounded hover:bg-muted transition-colors">
          <Info className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </TooltipTrigger>
      <TooltipContent 
        side="top" 
        className="max-w-xs p-3 bg-popover border border-border rounded-lg shadow-lg"
      >
        <div className="space-y-1.5">
          <p className="text-sm font-medium text-foreground">{alias}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{tooltipDescription}</p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
