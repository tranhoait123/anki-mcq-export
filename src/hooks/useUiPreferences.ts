import { useEffect, useMemo, useState } from 'react';
import { UploadedFile } from '../types';
import { isDocxFile } from '../utils/appHelpers';

type BeforeInstallPromptEvent = Event & {
  prompt: () => void;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' | string }>;
};

export const useUiPreferences = (files: UploadedFile[], previewFileId?: string | null) => {
  const [isSplitView, setIsSplitView] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
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

  const previewUrl = useMemo(() => {
    if (!isSplitView || files.length === 0) return null;
    const file = files.find(item => item.id === previewFileId) || files[0];
    if (isDocxFile(file) || (!file.type.startsWith('image/') && file.type !== 'application/pdf')) return null;
    try {
      const base64Data = file.content.includes(',') ? file.content.split(',')[1] : file.content;
      const byteCharacters = atob(base64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: file.type });
      return URL.createObjectURL(blob);
    } catch (error) {
      console.error('Failed to generate preview URL', error);
      return null;
    }
  }, [files, isSplitView, previewFileId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
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
