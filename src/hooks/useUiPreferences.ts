import { useEffect, useMemo, useState } from 'react';
import { UploadedFile } from '../types';
import { isDocxFile } from '../utils/appHelpers';
import { measureAsync, scheduleIdleTask } from '../utils/performance';

type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' | string }>;
};

export const useUiPreferences = (files: UploadedFile[], previewFileId?: string | null) => {
  const [isSplitView, setIsSplitView] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('anki_dark_mode') === 'true';
    }
    return false;
  });

  useEffect(() => {
    localStorage.setItem('anki_dark_mode', String(darkMode));
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [darkMode]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      console.log('✅ PWA Install Prompt detected');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      console.log('User accepted the install prompt');
      setDeferredPrompt(null);
    }
  };

  const previewFile = useMemo(() => {
    if (!isSplitView || files.length === 0) return null;
    const file = files.find(item => item.id === previewFileId) || files[0];
    if (isDocxFile(file) || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) return null;
    return file;
  }, [files, isSplitView, previewFileId]);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(null);
    if (!previewFile) return undefined;

    const cancelIdleTask = scheduleIdleTask(() => {
      void measureAsync(`preview.createObjectUrl(${previewFile.name})`, async () => {
        try {
          const base64Data = previewFile.content.includes(',') ? previewFile.content.split(',')[1] : previewFile.content;
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: previewFile.type });
          const nextUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(nextUrl);
            return;
          }
          setPreviewUrl(previousUrl => {
            if (previousUrl) URL.revokeObjectURL(previousUrl);
            return nextUrl;
          });
        } catch (error) {
          console.error('Failed to generate preview URL', error);
        }
      });
    }, 300);

    return () => {
      cancelled = true;
      cancelIdleTask();
    };
  }, [previewFile]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  return {
    darkMode,
    deferredPrompt,
    handleInstallApp,
    isSplitView,
    previewUrl,
    setDarkMode,
    setIsSplitView,
  };
};
