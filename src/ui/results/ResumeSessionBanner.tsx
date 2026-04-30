import { ProcessingSession } from '../../types';
import { formatSessionPhase } from '../../utils/appHelpers';

interface ResumeSessionBannerProps {
  handleDiscardResumeSession: () => void;
  handleResumeSession: () => void;
  resumeSession: ProcessingSession;
}

const ResumeSessionBanner: React.FC<ResumeSessionBannerProps> = ({
  handleDiscardResumeSession,
  handleResumeSession,
  resumeSession,
}) => (
  <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm dark:border-amber-900/40 dark:bg-amber-950/20">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1">
        <h3 className="text-sm font-black uppercase tracking-wider text-amber-800 dark:text-amber-300">
          Phát hiện phiên dang dở
        </h3>
        <p className="text-sm text-amber-900 dark:text-amber-100">
          {formatSessionPhase(resumeSession.phase)} • {resumeSession.completedBatchIndices.length}/{resumeSession.totalTopLevelBatches || '?'} batch • {resumeSession.settingsSnapshot.provider} / {resumeSession.settingsSnapshot.model}
        </p>
        <p className="text-xs text-amber-700/80 dark:text-amber-200/80">
          Cập nhật lần cuối: {new Date(resumeSession.updatedAt).toLocaleString('vi-VN')}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleDiscardResumeSession}
          className="rounded-xl border border-amber-300 px-4 py-2 text-xs font-black uppercase tracking-wider text-amber-800 transition hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300 dark:hover:bg-amber-900/30"
        >
          Bỏ phiên cũ
        </button>
        <button
          onClick={handleResumeSession}
          className="rounded-xl bg-amber-500 px-4 py-2 text-xs font-black uppercase tracking-wider text-white transition hover:bg-amber-600"
        >
          Tiếp tục phiên dang dở
        </button>
      </div>
    </div>
  </div>
);

export default ResumeSessionBanner;
