import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import { ConfirmDialogState } from '../hooks/useConfirmDialog';

interface ConfirmModalProps {
  state: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ state, onCancel, onConfirm }) => {
  if (!state.open) return null;

  const isDanger = state.variant === 'danger';

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="w-full rounded-t-[2rem] border border-white/20 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:max-w-md sm:rounded-3xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isDanger ? 'bg-rose-100 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300' : 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-300'}`}>
              {isDanger ? <AlertTriangle size={22} /> : <CheckCircle2 size={22} />}
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950 dark:text-white">{state.title}</h2>
              <p className="mt-1 text-sm leading-relaxed text-slate-500 dark:text-slate-400">{state.body}</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            disabled={state.busy}
            className="rounded-xl p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-slate-200"
            title="Đóng"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            disabled={state.busy}
            className="rounded-2xl border border-slate-200 bg-white px-5 py-3 text-sm font-black text-slate-600 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {state.cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            data-testid="confirm-submit-button"
            disabled={state.busy}
            className={`inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-black text-white transition disabled:opacity-60 ${isDanger ? 'bg-rose-600 hover:bg-rose-500' : 'bg-indigo-600 hover:bg-indigo-500'}`}
          >
            {state.busy && <Loader2 size={16} className="animate-spin" />}
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
