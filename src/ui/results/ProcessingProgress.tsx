import { Loader2, Pause, Play } from 'lucide-react';
import { AnalysisResult, ProcessingState } from '../../types';

interface ProcessingProgressProps {
  analysis: AnalysisResult | null;
  currentCount: number;
  displayedProgressStatus: string;
  handleTogglePause: (isProcessing: boolean) => void;
  loading: boolean;
  processingState: ProcessingState;
}

const ProcessingProgress: React.FC<ProcessingProgressProps> = ({
  analysis,
  currentCount,
  displayedProgressStatus,
  handleTogglePause,
  loading,
  processingState,
}) => (
  <div className="bg-white p-5 rounded-xl border border-indigo-100 shadow-sm space-y-3">
    <div className="flex justify-between items-center text-sm font-medium text-indigo-900">
      <span className="flex items-center gap-2">
        {processingState === 'running' ? (
          <Loader2 className="animate-spin text-indigo-600" size={16} />
        ) : processingState === 'pausing' ? (
          <Loader2 className="animate-spin text-amber-600" size={16} />
        ) : (
          <Pause className="text-amber-600" size={16} />
        )}
        {displayedProgressStatus}
      </span>
      <span>
        {analysis?.estimatedCount && analysis.estimatedCount > 0
          ? `${Math.round((currentCount / analysis.estimatedCount) * 100)}%`
          : `Đã xong ${currentCount} câu`}
      </span>
    </div>
    <div className="h-2 bg-indigo-50 rounded-full overflow-hidden">
      <div
        className={`h-full bg-indigo-600 transition-all duration-300 ease-out ${(!analysis?.estimatedCount || analysis.estimatedCount === 0) ? 'animate-pulse' : ''}`}
        style={{ width: `${analysis?.estimatedCount && analysis.estimatedCount > 0 ? Math.min(100, (currentCount / analysis.estimatedCount) * 100) : 100}%` }}
      />
    </div>
    <div className="flex justify-end">
      <button
        onClick={() => handleTogglePause(loading)}
        className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black uppercase tracking-wider transition-all ${
          processingState === 'running'
            ? 'bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100'
            : 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
        }`}
      >
        {processingState === 'running' ? <Pause size={14} /> : <Play size={14} />}
        {processingState === 'running' ? 'Tạm dừng' : 'Tiếp tục'}
      </button>
    </div>
  </div>
);

export default ProcessingProgress;
