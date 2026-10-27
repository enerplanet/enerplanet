/**
 * The tooltip of a failed run: a title from the stage it failed in, one line
 * from the service that failed, and the next step. The service lines live in
 * the locale files under model.failure.service, one entry per service the
 * backend records in results.failed_service; a service without an entry gets
 * model.failure.unknown. A service whose failure a rerun does not fix has its
 * own next step under model.failure.nextFor. The raw error is never shown.
 */

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** The run stages a failure is recorded in (results.failed_stage), by the status the run had. */
const FAILED_STAGES = new Set(["queue", "running", "processing"]);

export interface FailureMessage {
  title: string;
  body: string;
  /** The next step, or undefined when body already says it. */
  next?: string;
}

/** The failed badge's label naming the stage, or undefined to show plain "Failed". */
export const failedStageLabel = (stage: unknown, t: Translate): string | undefined =>
  typeof stage === "string" && FAILED_STAGES.has(stage) ? t(`modelStatus.failedAt.${stage}`) : undefined;

export function failureMessage(results: Record<string, unknown> | undefined, t: Translate): FailureMessage {
  const title = failedStageLabel(results?.failed_stage, t) ?? t("model.failed");
  const service = results?.failed_service;
  const unknown = t("model.failure.unknown");
  const body = typeof service === "string" && service !== "" ? t(`model.failure.service.${service}`, { defaultValue: unknown }) : unknown;
  return body === unknown ? { title, body } : { title, body, next: t(`model.failure.nextFor.${service}`, { defaultValue: t("model.failure.next") }) };
}
