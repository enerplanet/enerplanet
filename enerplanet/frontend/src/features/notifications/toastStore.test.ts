import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useToastStore } from './toastStore';

const messages = () => useToastStore.getState().toasts.map((t) => t.message);

describe('toast store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it('closes an info toast after 5 s and an error after 10 s', () => {
    const { push } = useToastStore.getState();
    push({ severity: 'info', message: 'saved' });
    push({ severity: 'error', message: 'failed' });

    vi.advanceTimersByTime(5000);
    expect(messages()).toEqual(['failed']);

    vi.advanceTimersByTime(4999);
    expect(messages()).toEqual(['failed']);

    vi.advanceTimersByTime(1);
    expect(messages()).toEqual([]);
  });
});
