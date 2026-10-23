import type { FC } from "react";
import { Check, Loader2 } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";

type StepStatus = "complete" | "active" | "available" | "pending";

interface WorkflowBarProps {
	/** Areas drawn so far; the first step is done once there is one. */
	polygonCount: number;
	isGeneratingGrid: boolean;
	hasGridData: boolean;
	/** Custom grid mode: transformers can be added and buildings assigned. */
	siteMode: boolean;
	hasAddedTransformer: boolean;
}

/** Centres an overlay on the part of the map the sidebar does not cover. */
export const MAP_TOP_CENTRE = { left: "calc((100% - var(--sidebar-offset, 0rem)) / 2)" } as const;

/** The configurator's workflow as a pill of numbered steps over the map. */
export const WorkflowBar: FC<WorkflowBarProps> = ({
	polygonCount,
	isGeneratingGrid,
	hasGridData,
	siteMode,
	hasAddedTransformer,
}) => {
	const { t } = useTranslation();
	const steps: { key: string; label: string; status: StepStatus; optional?: boolean }[] = [
		{
			key: "area",
			label: t("workflow.drawArea", "Draw area"),
			status: polygonCount > 0 ? "complete" : "available",
		},
		{
			key: "grid",
			label: t("workflow.gridGeneration", "Grid Generation"),
			status: isGeneratingGrid ? "active" : hasGridData ? "complete" : "pending",
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
		<ol aria-label={t("workflow.title", "Workflow")} className="flex items-center gap-1.5 rounded-full border border-border bg-card/95 px-2.5 py-1 shadow-md backdrop-blur-sm">
			{steps.map((step, i) => (
				<li key={step.key} className="flex items-center gap-2">
					{i > 0 && (
						<span
							aria-hidden="true"
							className={cn("h-px w-4", step.status === "pending" ? "bg-border" : "bg-primary")}
						/>
					)}
					<span
						className={cn(
							"flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold",
							step.status === "complete" && "bg-primary text-primary-foreground",
							step.status === "active" && "border-2 border-primary text-primary",
							step.status === "available" && "border-2 border-primary/60 text-foreground",
							step.status === "pending" && "border border-border text-muted-foreground"
						)}
					>
						{step.status === "complete" ? (
							<Check className="h-3 w-3" aria-hidden="true" />
						) : step.status === "active" ? (
							<Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
						) : (
							i + 1
						)}
					</span>
					<span
						className={cn(
							"whitespace-nowrap text-xs",
							step.status === "pending" ? "text-muted-foreground" : "font-medium text-foreground"
						)}
					>
						{step.label}
					</span>
					{step.optional && step.status !== "complete" && (
						<span className="text-[11px] text-muted-foreground">{t("workflow.optional", "optional")}</span>
					)}
				</li>
			))}
		</ol>
	);
};
