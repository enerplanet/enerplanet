/**
 * The failed run the feedback form reports: the dashboard's Report button
 * passes it as router state under RUN_REPORT_STATE_KEY. The backend copies the
 * failure details from the model; the form only sends its id.
 */
export interface RunReportTarget {
  id: number;
  title: string;
  /** results.failed_stage of the run. */
  stage?: string;
}

export const RUN_REPORT_STATE_KEY = "reportRun";
