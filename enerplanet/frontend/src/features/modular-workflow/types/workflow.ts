export type WorkflowStartType = "from-scratch" | "from-existing-model";

export interface WorkflowStep {
  /** Module ID from the catalog */
  moduleId: string;
  /** Human-readable label for this step */
  label: string;
  /** Optional description shown in the UI */
  description?: string;
  /** Data mapping: context key → module input key */
  inputMapping?: Record<string, string>;
  /** Data mapping: module output key → context key */
  outputMapping?: Record<string, string>;
  /** If true, user can skip this step (uses defaults) */
  skippable?: boolean;
  /** If true, this step runs automatically without user interaction */
  auto?: boolean;
}

export interface WorkflowDefinition {
  /** Unique workflow ID */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this workflow does */
  description: string;
  /** What kind of start this workflow supports */
  startType: WorkflowStartType;
  /** Ordered list of steps */
  steps: WorkflowStep[];
  /** Workflow IDs to recommend after this one completes (context-dependent) */
  followUpWorkflows?: string[];
  /** Tags for categorization and recommendation matching */
  tags?: string[];
  /** Version for migration support */
  version: string;
}
