import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProcessingController, ProcessingSession, ProcessingSessionStatus, ProcessingState } from '../types';
import { createProcessingController } from '../utils/processingControl';

export const useProcessingControllerState = (
  activeSessionRef: React.RefObject<ProcessingSession | null>,
  persistSessionSnapshot: (session: ProcessingSession) => void
) => {
  const [processingState, setProcessingState] = useState<ProcessingState>('running');
  const processingControllerRef = useRef<ProcessingController | null>(null);

  const startProcessingController = () => {
    const controller = createProcessingController((state) => {
      setProcessingState(state);
      const active = activeSessionRef.current;
      if (!active) return;
      const status: ProcessingSessionStatus = state === 'paused' ? 'paused' : 'running';
      const next = { ...active, status, updatedAt: Date.now() };
      activeSessionRef.current = next;
      persistSessionSnapshot(next);
    });
    processingControllerRef.current = controller;
    setProcessingState('running');
    return controller;
  };

  const clearProcessingController = () => {
    processingControllerRef.current?.resume();
    processingControllerRef.current = null;
    setProcessingState('running');
  };

  const waitWithController = async (ms: number, controller?: ProcessingController) => {
    let remaining = Math.max(0, ms);
    while (remaining > 0) {
      await controller?.waitIfPaused();
      const step = Math.min(250, remaining);
      await new Promise((resolve) => setTimeout(resolve, step));
      remaining -= step;
    }
  };

  const handleTogglePause = (loading: boolean) => {
    const controller = processingControllerRef.current;
    if (!controller || !loading) return;

    if (controller.isPauseRequested()) {
      controller.resume();
      toast.success('Đã tiếp tục xử lý.');
      return;
    }

    controller.requestPause();
    toast.info('Đã nhận yêu cầu tạm dừng. Hệ thống sẽ dừng ở checkpoint an toàn gần nhất.');
  };

  return {
    processingState,
    startProcessingController,
    clearProcessingController,
    waitWithController,
    handleTogglePause,
  };
};
