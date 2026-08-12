import { useMemo, useRef, useState } from "react";
import {
  Button,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
} from "@spatialhub/ui";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Download,
  Plus,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import type { WorkflowDefinition, WorkflowStep } from "../types/workflow";
import { defaultModuleInventory } from "../modules/ModuleInventory";
import { WorkflowRegistry, defaultWorkflowRegistry } from "./WorkflowRegistry";

export interface WorkflowBuilderProps {
  /** Registry to register composed/imported workflows into. */
  registry?: WorkflowRegistry;
  /** Called when a workflow is registered (e.g. to refresh a list). */
  onRegistered?: (workflow: WorkflowDefinition) => void;
}

/**
 * Admin UI for composing workflows.
 *
 * Lists all available modules from the catalog, lets the user add/remove/reorder
 * steps (each step picks a moduleId + label + optional skippable/auto flags),
 * sets the workflow metadata, configures optional input/output mappings, and
 * validates the result. Supports exporting the workflow as `workflow.json`
 * (download) and importing from JSON (file upload).
 */
export function WorkflowBuilder({ registry, onRegistered }: WorkflowBuilderProps) {
  const activeRegistry = registry ?? defaultWorkflowRegistry;
  const catalog = useMemo(() => defaultModuleInventory.getCatalogSummary(), []);

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [tags, setTags] = useState("");
  const [followUps, setFollowUps] = useState("");
  const [steps, setSteps] = useState<WorkflowStep[]>([]);
  const [validation, setValidation] = useState<{ valid: boolean; errors: string[] } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const buildWorkflow = (): WorkflowDefinition => ({
    id: id.trim() || "untitled-workflow",
    name: name.trim() || "Untitled Workflow",
    description: description.trim(),
    version: version.trim() || "1.0.0",
    tags: tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    followUpWorkflows: followUps
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean),
    steps,
  });

  const handleValidate = () => {
    const workflow = buildWorkflow();
    const result = defaultModuleInventory.validateWorkflow(workflow);
    setValidation(result);
    setMessage(null);
  };

  const handleRegister = () => {
    const workflow = buildWorkflow();
    const result = defaultModuleInventory.validateWorkflow(workflow);
    setValidation(result);
    if (!result.valid) {
      setMessage("Workflow failed validation — fix the errors before registering.");
      return;
    }
    activeRegistry.register(workflow);
    setMessage(`Workflow "${workflow.id}" registered.`);
    onRegistered?.(workflow);
  };

  const handleExport = () => {
    const workflow = buildWorkflow();
    const json = activeRegistry.exportToJson(workflow);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workflow.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const workflow = activeRegistry.importFromJson(String(reader.result));
        // Populate the form with the imported workflow so it can be edited.
        setId(workflow.id);
        setName(workflow.name);
        setDescription(workflow.description);
        setVersion(workflow.version);
        setTags((workflow.tags ?? []).join(", "));
        setFollowUps((workflow.followUpWorkflows ?? []).join(", "));
        setSteps(workflow.steps);
        setValidation({ valid: true, errors: [] });
        setMessage(`Imported workflow "${workflow.id}".`);
        onRegistered?.(workflow);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
  };

  const addStep = () => {
    const firstModule = catalog[0];
    setSteps((prev) => [
      ...prev,
      {
        moduleId: firstModule?.id ?? "",
        label: firstModule?.name ?? "New Step",
        skippable: false,
        auto: false,
      },
    ]);
  };

  const updateStep = (index: number, patch: Partial<WorkflowStep>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, delta: -1 | 1) => {
    setSteps((prev) => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Workflow Builder</h1>
          <p className="text-sm text-muted-foreground">
            Compose, validate, and export workflows for the ModelBuilder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleImportFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> Import
          </Button>
          <Button variant="outline" onClick={handleExport}>
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-sm">{message}</div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Metadata */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Workflow Metadata</CardTitle>
            <CardDescription>Identity and start behaviour.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="wf-id">ID</Label>
              <Input
                id="wf-id"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="quick-grid-analysis"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-name">Name</Label>
              <Input
                id="wf-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Quick Grid Analysis"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-desc">Description</Label>
              <Input
                id="wf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this workflow does"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-version">Version</Label>
              <Input id="wf-version" value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-tags">Tags (comma-separated)</Label>
              <Input
                id="wf-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="quick, grid"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wf-followups">Follow-up workflows (comma-separated IDs)</Label>
              <Input
                id="wf-followups"
                value={followUps}
                onChange={(e) => setFollowUps(e.target.value)}
                placeholder="full-energy-planning"
              />
            </div>
          </CardContent>
        </Card>

        {/* Steps */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Steps</CardTitle>
              <CardDescription>Ordered list of modules in this workflow.</CardDescription>
            </div>
            <Button size="sm" onClick={addStep}>
              <Plus className="mr-2 h-4 w-4" /> Add step
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {steps.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No steps yet. Add a module to start composing.
              </p>
            )}
            {steps.map((step, index) => (
              <div key={index} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{index + 1}</Badge>
                  <div className="flex-1 space-y-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label>Module</Label>
                        <Select
                          value={step.moduleId}
                          onValueChange={(v) => {
                            const mod = catalog.find((m) => m.id === v);
                            updateStep(index, { moduleId: v, label: mod?.name ?? v });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {catalog.map((m) => (
                              <SelectItem key={m.id} value={m.id}>
                                {m.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <Label>Label</Label>
                        <Input
                          value={step.label}
                          onChange={(e) => updateStep(index, { label: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={step.skippable ?? false}
                          onCheckedChange={(v) => updateStep(index, { skippable: v })}
                        />
                        Skippable
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={step.auto ?? false}
                          onCheckedChange={(v) => updateStep(index, { auto: v })}
                        />
                        Auto
                      </label>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === 0}
                      onClick={() => moveStep(index, -1)}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={index === steps.length - 1}
                      onClick={() => moveStep(index, 1)}
                    >
                      <ArrowDown className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => removeStep(index)}>
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Separator />

      {/* Validation + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" onClick={handleValidate}>
          Validate
        </Button>
        <Button onClick={handleRegister}>Register workflow</Button>
      </div>

      {validation && (
        <div
          className={`rounded-md border p-3 text-sm ${
            validation.valid
              ? "border-green-300 bg-green-50 text-green-700"
              : "border-red-300 bg-red-50 text-red-700"
          }`}
        >
          <div className="flex items-center gap-2 font-medium">
            {validation.valid ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
            {validation.valid ? "Workflow is valid." : "Workflow has errors:"}
          </div>
          {!validation.valid && (
            <ul className="mt-2 list-inside list-disc">
              {validation.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// Re-export the registry singleton for convenience.
export { defaultWorkflowRegistry } from "./WorkflowRegistry";
