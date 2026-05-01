import { RefreshCw, X } from 'lucide-react';

interface PwaUpdateBannerProps {
  dismissUpdate: () => void;
  needRefresh: boolean;
  offlineReady: boolean;
  updateApp: () => void;
}

const PwaUpdateBanner: React.FC<PwaUpdateBannerProps> = ({
  dismissUpdate,
  needRefresh,
  offlineReady,
  updateApp,
}) => {
  if (!needRefresh && !offlineReady) return null;

  return (
    <div className="fixed inset-x-3 bottom-20 z-[90] rounded-2xl border border-indigo-200 bg-white p-3 shadow-2xl dark:border-indigo-900/50 dark:bg-slate-900 sm:bottom-5 sm:left-auto sm:right-5 sm:max-w-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300">
          <RefreshCw size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black text-slate-900 dark:text-white">
            {needRefresh ? 'Có bản cập nhật mới' : 'App đã sẵn sàng offline'}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {needRefresh ? 'Làm mới để dùng phiên bản mới nhất.' : 'Bạn có thể dùng lại app nhanh hơn ở lần sau.'}
          </div>
        </div>
        {needRefresh && (
          <button
            onClick={updateApp}
            className="rounded-xl bg-indigo-600 px-3 py-2 text-xs font-black text-white transition hover:bg-indigo-500"
          >
            Cập nhật
          </button>
        )}
        <button
          onClick={dismissUpdate}
          className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          title="Đóng"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
};

export default PwaUpdateBanner;
