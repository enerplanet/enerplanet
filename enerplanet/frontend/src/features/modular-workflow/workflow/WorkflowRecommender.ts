import type { ConfiguratorContext } from "../types/context";
import type { WorkflowDefinition } from "../types/workflow";

/**
 * State-driven workflow recommendation engine.
 *
 * Implements the priority-based recommendation logic from §8.3:
 *
 * 1. `followUpWorkflows` from the just-completed workflow
 * 2. Workflows matching the current model state (has grid? has results?)
 *
 * Results are de-duplicated by workflow ID and returned in priority order.
 */
export class WorkflowRecommender {
  /**
   * Returns workflows relevant to the current context.
   *
   * @param context             the current shared workflow context
   * @param completedWorkflowId the workflow that just finished (if any)
   * @param allWorkflows        the full set of workflows to recommend from
   */
  getRecommendations(
    context: ConfiguratorContext,
    completedWorkflowId?: string,
    allWorkflows: WorkflowDefinition[] = [],
  ): WorkflowDefinition[] {
    const byId = new Map(allWorkflows.map((w) => [w.id, w]));
    const recommended: WorkflowDefinition[] = [];
    const seen = new Set<string>();

    const push = (workflow: WorkflowDefinition | undefined) => {
      if (!workflow || seen.has(workflow.id)) return;
      seen.add(workflow.id);
      recommended.push(workflow);
    };

    // 1. Follow-up workflows from the just-completed workflow.
    if (completedWorkflowId) {
      const completed = byId.get(completedWorkflowId);
      for (const id of completed?.followUpWorkflows ?? []) {
        push(byId.get(id));
      }
    }

    // 2. Workflows matching the current model state.
    const hasGrid = Boolean(context.gridData || context.gridResultIds);
    const hasResults = Boolean(
      context.gridStatistics || context.powerFlowResult || context.costBreakdown,
    );
    for (const workflow of allWorkflows) {
      if (this.matchesState(workflow, hasGrid, hasResults)) {
        push(workflow);
      }
    }

    return recommended;
  }

  /**
   * A workflow "matches the current model state" when its tags or step modules
   * align with what the user already has. This is intentionally heuristic:
   * workflows that build on an existing grid/results are surfaced once the
   * user has produced them.
   */
  private matchesState(
    workflow: WorkflowDefinition,
    hasGrid: boolean,
    hasResults: boolean,
  ): boolean {
    const tags = workflow.tags ?? [];
    const moduleIds = workflow.steps.map((s) => s.moduleId);

    // Workflows that need an existing grid to be useful.
    if (hasGrid && (tags.includes("optimization") || moduleIds.includes("power-flow"))) {
      return true;
    }
    // Workflows that analyse existing results.
    if (hasResults && tags.includes("analysis")) {
      return true;
    }
    return false;
  }
}

// ---------------------------------------------------------------------------
// Singleton default instance
// ---------------------------------------------------------------------------

/** The default workflow recommender singleton. */
export const defaultWorkflowRecommender = new WorkflowRecommender();
