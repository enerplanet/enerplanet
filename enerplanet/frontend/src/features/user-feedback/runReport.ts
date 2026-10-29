import { useQuery } from "@tanstack/react-query";
import axios from "@/lib/axios";

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

export const OPEN_RUN_REPORTS_KEY = ["feedback", "open-run-reports"] as const;

/** Ids of the models with an open report that the signed-in user filed or owns. */
export const useOpenRunReports = () =>
  useQuery({
    queryKey: OPEN_RUN_REPORTS_KEY,
    queryFn: async () => {
      const { data } = await axios.get<{ data: { model_ids: number[] } }>("/feedback/my/open-run-reports");
      return new Set(data.data.model_ids);
    },
    staleTime: 60_000,
  });
