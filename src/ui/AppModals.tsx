import React from 'react';
import { AppSettings, DuplicateInfo, MCQ } from '../types';
import DuplicatesReviewModal from './DuplicatesReviewModal';
import SettingsModal from './SettingsModal';

interface AppModalsProps {
  duplicates: DuplicateInfo[];
  handleKeepAllDuplicates: () => void;
  handleReplaceDuplicate: (originalId: string, newMcq: MCQ, dupId: string) => void;
  handleSkipDuplicate: (dupId: string) => void;
  restoreDuplicate: (dupId: string) => void;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
  setShowDuplicates: (show: boolean) => void;
  setShowSettings: (show: boolean) => void;
  settings: AppSettings;
  showDuplicates: boolean;
  showSettings: boolean;
}

const AppModals: React.FC<AppModalsProps> = ({
  duplicates,
  handleKeepAllDuplicates,
  handleReplaceDuplicate,
  handleSkipDuplicate,
  restoreDuplicate,
  setSettings,
  setShowDuplicates,
  setShowSettings,
  settings,
  showDuplicates,
  showSettings,
}) => (
  <>
    <SettingsModal
      show={showSettings}
      onClose={() => setShowSettings(false)}
      settings={settings}
      setSettings={setSettings}
    />
    <DuplicatesReviewModal
      show={showDuplicates}
      onClose={() => setShowDuplicates(false)}
      duplicates={duplicates}
      onRestore={restoreDuplicate}
      onSkip={handleSkipDuplicate}
      onReplace={handleReplaceDuplicate}
      onKeepAll={handleKeepAllDuplicates}
    />
  </>
);

export default AppModals;
