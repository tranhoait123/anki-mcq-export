import React from 'react';
import { ShieldAlert, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { AuditResult } from '../types';

interface AuditPanelProps {
    audit: AuditResult;
    showAudit: boolean;
    setShowAudit: (show: boolean) => void;
}

const AuditPanel: React.FC<AuditPanelProps> = ({ audit, showAudit, setShowAudit }) => {
    return (
        <div className={`bg-white border rounded-xl overflow-hidden shadow-sm ${audit.status === 'warning' ? 'border-amber-200' : 'border-blue-100'}`}>
            <button
                onClick={() => setShowAudit(!showAudit)}
                className={`w-full p-3 flex items-center justify-between text-left text-sm font-medium ${audit.status === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-blue-50 text-blue-800'}`}
            >
                <div className="flex items-center gap-2">
                    <ShieldAlert size={16} />
                    <span>Báo cáo chất lượng</span>
                </div>
                {showAudit ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </button>

            {showAudit && (
                <div className="p-4 space-y-4 text-xs">
                    <div>
                        <h4 className="font-bold flex items-center gap-2 mb-2 text-slate-700">
                            <AlertTriangle size={12} className="text-amber-500" /> Vấn đề phát hiện:
                        </h4>
                        <ul className="list-disc list-inside space-y-1 text-slate-500 pl-1">
                            {audit.reasons.map((r, i) => <li key={i}>{r}</li>)}
                        </ul>
                    </div>
                    <div className="bg-slate-50 p-2.5 rounded text-slate-500 border border-slate-100 italic">
                        {audit.advice}
                    </div>
                </div>
            )}
        </div>
    );
};

export default AuditPanel;
