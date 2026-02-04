import React from 'react';
import { Info, ChevronUp, ChevronDown } from 'lucide-react';
import { DuplicateInfo } from '../types';

interface DuplicatesPanelProps {
    duplicates: DuplicateInfo[];
    showDuplicates: boolean;
    setShowDuplicates: (show: boolean) => void;
    onRestore: (id: string) => void;
}

const DuplicatesPanel: React.FC<DuplicatesPanelProps> = ({ duplicates, showDuplicates, setShowDuplicates, onRestore }) => {
    return (
        <div className="bg-white border border-orange-200 rounded-xl overflow-hidden shadow-sm">
            <button
                onClick={() => setShowDuplicates(!showDuplicates)}
                className="w-full p-3 flex items-center justify-between text-left text-sm font-medium bg-orange-50 text-orange-800"
            >
                <div className="flex items-center gap-2">
                    <Info size={16} />
                    <span>Câu hỏi bị loại ({duplicates.length})</span>
                </div>
                {showDuplicates ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showDuplicates && (
                <div className="p-4 max-h-64 overflow-y-auto">
                    <div className="space-y-2">
                        {duplicates.map((d, i) => (
                            <div key={i} className="text-xs p-2 bg-orange-50 border border-orange-100 rounded">
                                <div className="flex justify-between items-start gap-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium text-slate-700 truncate" title={d.question}>
                                            {i + 1}. {d.question}...
                                        </div>
                                        <div className="text-orange-600 mt-1">
                                            ➜ {d.reason}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => onRestore(d.id)}
                                        className="shrink-0 px-2 py-1 text-xs bg-emerald-100 text-emerald-700 rounded hover:bg-emerald-200 transition-colors"
                                        title="Khôi phục câu hỏi này"
                                    >
                                        🔄 Khôi phục
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default DuplicatesPanel;
