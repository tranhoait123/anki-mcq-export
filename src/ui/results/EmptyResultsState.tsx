import { BrainCircuit } from 'lucide-react';

const EmptyResultsState: React.FC = () => (
  <div className="h-full flex flex-col items-center justify-center text-slate-300 py-20">
    <BrainCircuit size={64} className="mb-4 text-slate-200" strokeWidth={1} />
    <p className="font-medium text-slate-400">Chọn file để bắt đầu</p>
  </div>
);

export default EmptyResultsState;
