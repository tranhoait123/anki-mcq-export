import { describe, expect, it, vi } from 'vitest';
import { createProcessingController } from './processingControl';

describe('processing controller', () => {
  it('transitions from running to paused only at a safe checkpoint', async () => {
    const onStateChange = vi.fn();
    const controller = createProcessingController(onStateChange);

    controller.requestPause();
    expect(controller.getState()).toBe('pausing');

    let resumed = false;
    const waiter = controller.waitIfPaused().then(() => {
      resumed = true;
    });

    expect(controller.getState()).toBe('paused');
    expect(resumed).toBe(false);

    controller.resume();
    await waiter;

    expect(controller.getState()).toBe('running');
    expect(resumed).toBe(true);
    expect(onStateChange).toHaveBeenNthCalledWith(1, 'pausing');
    expect(onStateChange).toHaveBeenNthCalledWith(2, 'paused');
    expect(onStateChange).toHaveBeenNthCalledWith(3, 'running');
  });

  it('cancels a pending pause request if resumed before the checkpoint', async () => {
    const controller = createProcessingController();

    controller.requestPause();
    expect(controller.isPauseRequested()).toBe(true);

    controller.resume();
    expect(controller.getState()).toBe('running');

    await expect(controller.waitIfPaused()).resolves.toBeUndefined();
  });
});
