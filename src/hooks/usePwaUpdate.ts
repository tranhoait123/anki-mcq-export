import React from 'react';
import { registerSW } from 'virtual:pwa-register';

export const usePwaUpdate = () => {
  const [needRefresh, setNeedRefresh] = React.useState(false);
  const [offlineReady, setOfflineReady] = React.useState(false);
  const updateServiceWorkerRef = React.useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  React.useEffect(() => {
    updateServiceWorkerRef.current = registerSW({
      immediate: true,
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onOfflineReady() {
        setOfflineReady(true);
      },
    });
  }, []);

  const updateApp = React.useCallback(() => {
    void updateServiceWorkerRef.current?.(true);
  }, []);

  const dismissUpdate = React.useCallback(() => {
    setNeedRefresh(false);
    setOfflineReady(false);
  }, []);

  return {
    dismissUpdate,
    needRefresh,
    offlineReady,
    updateApp,
  };
};
