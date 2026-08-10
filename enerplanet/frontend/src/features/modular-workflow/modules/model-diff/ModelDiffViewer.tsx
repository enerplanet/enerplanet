import { useMemo, useState } from "react";
import { Button } from "@spatialhub/ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@spatialhub/ui";
import { ChevronDown, ChevronRight, FileCode2, AlertTriangle } from "lucide-react";
import type { ModuleProps } from "../../types/module";
import { serialiseModel } from "./serialiseModel";
import { diffLines, diffStats, type DiffLine } from "./diffModel";
import { parseModelYaml, type YamlParseError } from "./parseModelYaml";

/**
 * Collapsible YAML diff panel rendered at the bottom of every workflow step.
 *
 * - Collapsed by default — only a "Show model YAML" link is visible.
 * - View mode — shows the diff between the previous and current model YAML
 *   with additions/removals highlighted.
 * - Edit mode — disabled by default. "Enable editing" shows a warning dialog,
 *   then turns the YAML into an editable textarea. On save the YAML is
 *   validated; invalid YAML is rejected with line-level errors.
 */
export function ModelDiffViewer({ context, onUpdate }: ModuleProps) {
  const [expanded, setExpanded] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [draft, setDraft] = useState("");
  const [errors, setErrors] = useState<YamlParseError[]>([]);

  const currentYaml = useMemo(() => serialiseModel(context), [context]);
  const previousYaml = context.previousModelYaml ?? "";

  const diff: DiffLine[] = useMemo(
    () => diffLines(previousYaml, currentYaml),
    [previousYaml, currentYaml]
  );
  const stats = useMemo(() => diffStats(diff), [diff]);

  const handleEnableEditing = () => {
    setShowWarning(true);
  };

  const confirmEnableEditing = () => {
    setShowWarning(false);
    setDraft(currentYaml);
    setErrors([]);
    setEditMode(true);
  };

  const handleSave = () => {
    const result = parseModelYaml(draft);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    // Merge the edited YAML back into the context. The parsed value is the
    // authoritative model; we store the raw YAML for display and diffing.
    onUpdate({
      modelYaml: draft,
      previousModelYaml: currentYaml,
      modelYamlEditMode: false,
    });
    setErrors([]);
    setEditMode(false);
  };

  const handleCancelEdit = () => {
    setEditMode(false);
    setErrors([]);
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <FileCode2 className="h-4 w-4" />
          Show model YAML
        </span>
        {!expanded && stats.added + stats.removed > 0 && (
          <span className="text-xs">
            <span className="text-green-600">+{stats.added}</span>{" "}
            <span className="text-red-600">-{stats.removed}</span>
          </span>
        )}
      </button>

      {expanded && (
        <div className="border-t border-border p-4">
          {editMode ? (
            <div className="space-y-3">
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setErrors([]);
                }}
                spellCheck={false}
                className="min-h-[240px] w-full rounded-md border border-border bg-muted/40 p-3 font-mono text-xs"
                aria-label="Model YAML editor"
              />
              {errors.length > 0 && (
                <div className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700">
                  <p className="mb-1 flex items-center gap-1 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" /> Invalid YAML
                  </p>
                  <ul className="list-inside list-disc space-y-0.5">
                    {errors.map((err, i) => (
                      <li key={i}>
                        Line {err.line}: {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={handleCancelEdit}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <pre className="max-h-[320px] overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs leading-relaxed">
                {diff.map((line, i) => (
                  <div
                    key={i}
                    className={
                      line.type === "added"
                        ? "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300"
                        : line.type === "removed"
                          ? "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300"
                          : ""
                    }
                  >
                    {line.type === "added" ? "+ " : line.type === "removed" ? "- " : "  "}
                    {line.text}
                  </div>
                ))}
              </pre>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={handleEnableEditing}>
                  Enable editing
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog open={showWarning} onOpenChange={setShowWarning}>
        <AlertDialogContent>
          <AlertDialogHeader icon={AlertTriangle}>
            <AlertDialogTitle>Enable raw model editing?</AlertDialogTitle>
            <AlertDialogDescription>
              Editing the raw model may produce invalid configurations. Are you sure you want to
              continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmEnableEditing}>Enable editing</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
