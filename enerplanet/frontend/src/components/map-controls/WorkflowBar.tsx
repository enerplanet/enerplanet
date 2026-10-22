import type { FC } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";

type StepStatus = "complete" | "active" | "available" | "pending";

interface WorkflowBarProps {
	isGeneratingGrid: boolean;
	hasGridData: boolean;
	isRunningPowerFlow: boolean;
	hasPowerFlowResults: boolean;
	/** Custom grid mode: transformers can be added and buildings assigned. */
	siteMode: boolean;
	hasAddedTransformer: boolean;
}

/** The configurator's workflow as one row of steps in its top bar. */
export const WorkflowBar: FC<WorkflowBarProps> = ({
	isGeneratingGrid,
	hasGridData,
	isRunningPowerFlow,
	hasPowerFlowResults,
	siteMode,
	hasAddedTransformer,
}) => {
	const { t } = useTranslation();
	const steps: { key: string; label: string; status: StepStatus; optional?: boolean }[] = [
		{
			key: "grid",
			label: t("workflow.gridGeneration", "Grid Generation"),
			status: isGeneratingGrid ? "active" : hasGridData ? "complete" : "pending",
		},
		{
			key: "powerflow",
			label: t("workflow.powerFlow", "Run Power Flow"),
			status: isRunningPowerFlow ? "active" : hasPowerFlowResults ? "complete" : hasGridData ? "available" : "pending",
		},
		...(siteMode
			? [
					{
						key: "transformer",
						label: t("workflow.addTransformer", "Add Transformer"),
						status: (hasAddedTransformer ? "complete" : hasGridData ? "available" : "pending") as StepStatus,
						optional: true,
					},
				]
			: []),
		...(siteMode && hasAddedTransformer
			? [{ key: "buildings", label: t("workflow.assignBuildings", "Assign Buildings"), status: "available" as StepStatus }]
			: []),
	];

	return (
		<ol aria-label={t("workflow.title", "Workflow")} className="flex min-h-11 flex-wrap items-center gap-2 border-b border-border bg-background px-4 py-1.5 dark:bg-gray-800">
			{steps.map((step, i) => (
				<li key={step.key} className="flex items-center gap-2">
					{i > 0 && (
						<span
							aria-hidden="true"
							className={cn("h-0.5 w-6", step.status === "pending" ? "bg-border" : "bg-primary")}
						/>
					)}
					<span
						className={cn(
							"flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
							step.status === "complete" && "bg-primary text-primary-foreground",
							step.status === "active" && "border-2 border-primary text-primary",
							step.status === "available" && "border-2 border-primary/60 text-foreground",
							step.status === "pending" && "border border-border text-muted-foreground"
						)}
					>
						{step.status === "complete" ? (
							<Check className="h-3.5 w-3.5" aria-hidden="true" />
						) : step.status === "active" ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
						) : (
							i + 1
						)}
					</span>
					<span
						className={cn(
							"whitespace-nowrap text-sm",
							step.status === "pending" ? "text-muted-foreground" : "font-medium text-foreground"
						)}
					>
						{step.label}
					</span>
					{step.optional && step.status !== "complete" && (
						<span className="text-xs text-muted-foreground">{t("workflow.optional", "optional")}</span>
					)}
				</li>
			))}
		</ol>
	);
};
