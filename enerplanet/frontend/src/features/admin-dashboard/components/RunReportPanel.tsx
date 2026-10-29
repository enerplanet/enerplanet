import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "@spatialhub/i18n";
import axios from "@/lib/axios";
import { formatDateTime24h } from "@/utils/dateHelpers";

/** The failed run attached to a bug report (GET /feedback/{id}/run-report, experts only). */
interface RunReport {
  model_id: number;
  model_title: string;
  failed_stage?: string;
  failed_service?: string;
  error?: string;
  failed_at?: string;
}

/**
 * The failed run a bug report was sent about, with its raw error, or nothing
 * for feedback that reports no run.
 */
export const RunReportPanel: React.FC<{ feedbackId: number }> = ({ feedbackId }) => {
  const { t } = useTranslation();
  const [report, setReport] = useState<RunReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    setReport(null);
    axios
      .get<{ data: RunReport }>(`/feedback/${feedbackId}/run-report`)
      .then((res) => {
        if (!cancelled) setReport(res.data.data);
      })
      .catch((err: { response?: { status?: number } }) => {
        if (err.response?.status !== 404) console.error("[feedback] could not load the run report of feedback", feedbackId, err);
      });
    return () => {
      cancelled = true;
    };
  }, [feedbackId]);

  if (!report) return null;
  const rows: [string, string | undefined][] = [
    [t("feedbackManagement.runReport.model"), `${report.model_title} (#${report.model_id})`],
    [t("feedbackManagement.runReport.stage"), report.failed_stage],
    [t("feedbackManagement.runReport.service"), report.failed_service],
    [t("feedbackManagement.runReport.failedAt"), report.failed_at ? formatDateTime24h(report.failed_at) : undefined],
  ];
  return (
    <div>
      <h5 className="text-sm font-medium text-foreground mb-2">{t("feedbackManagement.runReport.title")}</h5>
      <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-3 text-sm">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          {rows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <React.Fragment key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="text-foreground">{value}</dd>
              </React.Fragment>
            ))}
        </dl>
        {report.error && (
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs text-foreground">{report.error}</pre>
        )}
        <Link to={`/app/model-dashboard/edit/${report.model_id}`} className="inline-block text-primary hover:underline">
          {t("feedbackManagement.runReport.openModel")}
        </Link>
      </div>
    </div>
  );
};
