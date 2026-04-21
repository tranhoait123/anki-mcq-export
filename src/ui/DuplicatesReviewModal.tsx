import React, { useState } from 'react';
import { X, ArrowRight, CheckCircle2, Trash2, RotateCcw, Info, Hash, FileText } from 'lucide-react';
import { DuplicateInfo, MCQ } from '../types';

interface DuplicatesReviewModalProps {
    show: boolean;
    onClose: () => void;
    duplicates: DuplicateInfo[];
    onRestore: (dupId: string) => void;
    onSkip: (dupId: string) => void;
    onReplace: (originalId: string, newMcq: MCQ, dupId: string) => void;
    onKeepAll: () => void;
}

const CompareCard: React.FC<{ title: string; mcq: MCQ | any; type: 'original' | 'new' }> = ({ title, mcq, type }) => {
    if (!mcq) return <div className="p-10 text-center text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900/50 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 uppercase text-[10px] font-black tracking-widest">Không có dữ liệu đối xứng</div>;

    const isOriginal = type === 'original';

    return (
        <div className={`p-6 rounded-3xl border-2 transition-all ${isOriginal ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800' : 'bg-indigo-50/30 dark:bg-indigo-900/10 border-indigo-100 dark:border-indigo-900/30'}`}>
            <div className="flex items-center gap-3 mb-4">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-white shadow-sm ${isOriginal ? 'bg-slate-500' : 'bg-indigo-600'}`}>
                    <Hash size={14} />
                </div>
                <div>
                    <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest block leading-none">{title}</span>
                    <span className={`text-xs font-bold ${isOriginal ? 'text-slate-700 dark:text-slate-300' : 'text-indigo-700 dark:text-indigo-400'}`}>ID: {mcq.id?.substring(0, 8)}...</span>
                </div>
            </div>

            <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-relaxed mb-4">
                {mcq.question}
            </h3>

            <div className="space-y-2 mb-6">
                {(mcq.options || []).map((opt: string, i: number) => {
                    const isCorrect = (mcq.correctAnswer || "").includes(opt) || (mcq.correctAnswer || "").charAt(0) === String.fromCharCode(65 + i);
                    return (
                        <div key={i} className={`flex items-center gap-2 p-2 rounded-xl text-xs border ${isCorrect ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400' : 'bg-slate-50/50 dark:bg-slate-800/50 border-transparent text-slate-500 dark:text-slate-400'}`}>
                            <span className={`w-5 h-5 rounded-lg flex items-center justify-center font-black ${isCorrect ? 'bg-emerald-500 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-400 dark:text-slate-500'}`}>
                                {String.fromCharCode(65 + i)}
                            </span>
                            <span className="flex-1">{opt}</span>
                        </div>
                    );
                })}
            </div>

            <div className={`p-4 rounded-2xl text-[11px] leading-relaxed ${isOriginal ? 'bg-slate-100/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400' : 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-800 dark:text-indigo-300'}`}>
                <span className="font-black uppercase tracking-tighter block mb-1">Giải thích vắn tắt:</span>
                {mcq.explanation?.core || "Không có nội dung giải thích."}
            </div>
        </div>
    );
};

const DuplicatesReviewModal: React.FC<DuplicatesReviewModalProps> = ({ 
    show, 
    onClose, 
    duplicates, 
    onRestore, 
    onSkip, 
    onReplace,
    onKeepAll
}) => {
    const [currentIndex, setCurrentIndex] = useState(0);

    if (!show) return null;

    const currentDup = duplicates[currentIndex];
    const total = duplicates.length;

    if (total === 0) {
        return (
            <div className="fixed inset-0 z-[100] bg-slate-900/40 dark:bg-black/60 backdrop-blur-sm flex items-center justify-center p-6">
                <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-3xl p-10 text-center shadow-2xl border dark:border-slate-800">
                    <div className="w-20 h-20 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={40} />
                    </div>
                    <h2 className="text-2xl font-black text-slate-900 dark:text-white mb-2">Đã hoàn thành!</h2>
                    <p className="text-slate-500 dark:text-slate-400 text-sm mb-8">Tất cả các câu hỏi trùng lặp đã được xử lý xong.</p>
                    <button onClick={onClose} className="w-full py-4 pro-gradient text-white font-black rounded-2xl shadow-lg">XÁC NHẬN</button>
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[100] bg-slate-900/60 dark:bg-black/70 backdrop-blur-md flex items-center justify-center p-4">
            <div className="bg-[#F8FAFC] dark:bg-slate-950 w-full max-w-5xl h-[90vh] rounded-[2.5rem] shadow-2xl flex flex-col overflow-hidden border border-white/20 dark:border-slate-800">
                {/* Header */}
                <div className="px-8 py-6 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <div className="flex items-center gap-5">
                        <div className="bg-orange-100 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 w-12 h-12 rounded-2xl flex items-center justify-center shadow-inner">
                            <Info size={24} />
                        </div>
                        <div>
                            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight leading-none">Trung tâm Xử lý Trùng lặp</h2>
                            <p className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest mt-1">Reviewing {currentIndex + 1} of {total} candidates</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button 
                            onClick={onKeepAll}
                            className="px-5 py-2.5 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-indigo-600 hover:text-white transition-all border border-indigo-100 dark:border-indigo-800"
                        >
                            Khôi phục tất cả
                        </button>
                        <button 
                            onClick={onClose}
                            className="p-3 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-2xl hover:bg-slate-200 dark:hover:bg-slate-700 transition-all shadow-inner"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 flex overflow-hidden">
                    {/* List Sidebar */}
                    <div className="w-72 border-r border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 overflow-y-auto p-4 space-y-2 shrink-0">
                        {duplicates.map((dup, idx) => (
                            <button
                                key={dup.id}
                                onClick={() => setCurrentIndex(idx)}
                                className={`w-full text-left p-4 rounded-2xl transition-all border-2 ${currentIndex === idx ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white dark:bg-slate-800/50 border-slate-50 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:border-slate-200 dark:hover:border-slate-700'}`}
                            >
                                <div className={`text-[9px] font-black uppercase tracking-tighter mb-1 ${currentIndex === idx ? 'text-indigo-200' : 'text-slate-400 dark:text-slate-500'}`}>
                                    Candidate #{idx + 1}
                                </div>
                                <div className="text-xs font-bold truncate leading-relaxed">
                                    {dup.question}...
                                </div>
                                <div className={`text-[10px] mt-2 flex items-center gap-1 ${currentIndex === idx ? 'text-white/80' : 'text-orange-600 dark:text-orange-400'}`}>
                                    <RotateCcw size={10} /> {dup.reason.split(' & ')[0]}
                                </div>
                            </button>
                        ))}
                    </div>

                    {/* Compare Area */}
                    <div className="flex-1 flex flex-col p-8 overflow-y-auto bg-slate-50/50 dark:bg-slate-950">
                        <div className="bg-orange-50 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/30 rounded-2xl p-4 flex items-center justify-between mb-8 shadow-sm">
                            <div className="flex items-center justify-between w-full">
                                <div className="flex items-center gap-3">
                                    <div className="bg-orange-500 text-white p-2 rounded-xl shadow-sm">
                                        <Info size={16} />
                                    </div>
                                    <div>
                                        <span className="text-[10px] font-black text-orange-600 dark:text-orange-400 uppercase tracking-widest block">Lý do phát hiện trùng</span>
                                        <span className="text-sm font-bold text-orange-900 dark:text-orange-200">{currentDup.reason.replace(/ \(~\d+%\)/, '')}</span>
                                    </div>
                                </div>
                                {currentDup.reason.match(/~(\d+)%/) && (
                                    <div className="bg-orange-500 text-white px-4 py-2 rounded-xl shadow-md flex items-center justify-center shrink-0">
                                        <div className="text-center">
                                            <span className="block text-[10px] font-black uppercase tracking-widest opacity-80 mb-0.5">Mức độ giống</span>
                                            <span className="block text-2xl font-black leading-none">{currentDup.reason.match(/~(\d+)%/)?.[1]}%</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-8 items-start relative">
                            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center shadow-xl border border-slate-100 dark:border-slate-700 z-10 text-slate-300 dark:text-slate-600">
                                <ArrowRight size={24} strokeWidth={3} />
                            </div>

                            <CompareCard 
                                title="Câu hỏi cũ (Đã có trong list)" 
                                mcq={currentDup.matchedData} 
                                type="original"
                            />

                            <CompareCard 
                                title="Câu hỏi mới (Phát hiện trùng)" 
                                mcq={currentDup.fullData} 
                                type="new"
                            />
                        </div>

                        {/* Analysis Warning for medical logic */}
                        <div className="mt-8 p-6 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl pro-shadow">
                            <div className="flex items-start gap-4">
                                <div className="bg-amber-100 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 p-2.5 rounded-xl">
                                    <RotateCcw size={20} />
                                </div>
                                <div className="flex-1">
                                    <h4 className="font-bold text-slate-900 dark:text-white mb-1">Gợi ý từ Hệ thống</h4>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                        Nếu hai câu này có cùng số thứ tự nhưng nội dung lâm sàng giải quyết các khía cạnh khác nhau (ví dụ: một câu hỏi về chẩn đoán, một câu hỏi về điều trị), hãy chọn <span className="font-bold text-indigo-700 dark:text-indigo-400">"GIỮ LẠI"</span> để lưu cả hai. Nếu chúng thực sự giống nhau, hãy chọn <span className="font-bold text-rose-600 dark:text-rose-400">"BỎ QUA"</span>.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="px-8 py-6 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex justify-between items-center shrink-0">
                    <button 
                        onClick={() => {
                            const next = (currentIndex + 1) % total;
                            onSkip(currentDup.id);
                            if (total > 1) setCurrentIndex(next >= total ? 0 : next);
                        }}
                        className="flex items-center gap-3 px-8 py-4 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-rose-50 dark:hover:bg-rose-900/30 hover:text-rose-600 dark:hover:text-rose-400 transition-all hover:border-rose-100 dark:hover:border-rose-900/50 border border-transparent"
                    >
                        <Trash2 size={16} /> Bỏ qua (Xóa)
                    </button>

                    <div className="flex gap-4">
                        <button 
                            onClick={() => {
                                const next = (currentIndex + 1) % total;
                                onRestore(currentDup.id);
                                if (total > 1) setCurrentIndex(next >= total ? 0 : next);
                            }}
                            className="flex items-center gap-3 px-10 py-4 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-black text-xs uppercase tracking-widest rounded-2xl hover:bg-indigo-600 hover:text-white transition-all shadow-lg shadow-indigo-100 dark:shadow-none border border-indigo-100 dark:border-indigo-800"
                        >
                            <FileText size={16} /> Giữ lại cả hai
                        </button>
                        
                        <button 
                            onClick={() => {
                                if (currentDup.matchedData?.id) {
                                    const next = (currentIndex + 1) % total;
                                    onReplace(currentDup.matchedData.id, currentDup.fullData as any, currentDup.id);
                                    if (total > 1) setCurrentIndex(next >= total ? 0 : next);
                                }
                            }}
                            className="flex items-center gap-3 px-10 py-4 pro-gradient text-white font-black text-xs uppercase tracking-widest rounded-2xl hover:scale-105 transition-all shadow-xl shadow-indigo-200"
                        >
                            <CheckCircle2 size={16} /> Ghi đè (Dùng câu mới)
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DuplicatesReviewModal;
