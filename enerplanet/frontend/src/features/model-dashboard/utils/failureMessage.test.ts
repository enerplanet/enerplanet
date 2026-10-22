import { describe, expect, it } from 'vitest';
import { failureMessage } from './failureMessage';

const SIMULATION_FAILED = 'Simulation failed';
const UNKNOWN = 'The process failed. Try again after some time.';

const strings: Record<string, string> = {
  'modelStatus.failedAt.running': SIMULATION_FAILED,
  'model.failed': 'Failed',
  'model.failure.service.meme': 'The energy system simulation (MEME) stopped before it finished.',
  'model.failure.unknown': UNKNOWN,
  'model.failure.next': 'Run it again.',
};
const t = (key: string, options?: Record<string, unknown>) => strings[key] ?? (options?.defaultValue as string) ?? key;

describe('failureMessage', () => {
  it('names the stage and the service, with the next step', () => {
    expect(failureMessage({ failed_stage: 'running', failed_service: 'meme', error: 'meme job 8974 via TentaCron' }, t)).toEqual({
      title: SIMULATION_FAILED,
      body: 'The energy system simulation (MEME) stopped before it finished.',
      next: 'Run it again.',
    });
  });

  it("uses a service's own next step when it has one", () => {
    const own: Record<string, string> = { ...strings, 'model.failure.service.city2tabula': 'No 3D building data was found.', 'model.failure.nextFor.city2tabula': 'Choose an area with 3D data.' };
    const tOwn = (key: string, options?: Record<string, unknown>) => own[key] ?? (options?.defaultValue as string) ?? key;
    expect(failureMessage({ failed_stage: 'queue', failed_service: 'city2tabula' }, tOwn).next).toBe('Choose an area with 3D data.');
  });

  it('falls back for a service without an entry, never showing the raw error', () => {
    const msg = failureMessage({ failed_stage: 'running', failed_service: 'ignis', error: 'raw chain' }, t);
    expect(msg).toEqual({ title: SIMULATION_FAILED, body: UNKNOWN });
  });

  it('falls back when no service or stage is recorded', () => {
    expect(failureMessage({ error: 'Calculation failed on webservice' }, t)).toEqual({
      title: 'Failed',
      body: UNKNOWN,
    });
    expect(failureMessage(undefined, t).title).toBe('Failed');
  });
});
