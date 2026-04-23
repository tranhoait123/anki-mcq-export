import { ProcessingController, ProcessingState } from '../types';

export const createProcessingController = (
  onStateChange?: (state: ProcessingState) => void
): ProcessingController => {
  let state: ProcessingState = 'running';
  let waiters: Array<() => void> = [];

  const setState = (nextState: ProcessingState) => {
    if (state === nextState) return;
    state = nextState;
    onStateChange?.(state);
  };

  return {
    requestPause: () => {
      if (state === 'running') setState('pausing');
    },
    resume: () => {
      if (state === 'running') return;
      setState('running');
      const pending = waiters;
      waiters = [];
      pending.forEach((resolve) => resolve());
    },
    getState: () => state,
    isPaused: () => state === 'paused',
    isPauseRequested: () => state === 'pausing' || state === 'paused',
    waitIfPaused: async () => {
      if (state !== 'pausing' && state !== 'paused') return;
      if (state === 'pausing') setState('paused');
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    },
  };
};
