import React, { useState } from 'react';
import { Settings as SettingsIcon, Trash2, ChevronDown, ChevronUp, ShieldAlert, Gauge, Zap, Database } from 'lucide-react';
import { AppSettings } from '../types';
import { db } from '../core/db';
import { toast } from 'sonner';

interface SettingsModalProps {
    show: boolean;
    onClose: () => void;
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ show, onClose, settings, setSettings }) => {
    const [showAdvanced, setShowAdvanced] = useState(false);
    
    if (!show) return null;

    const handleClearCaches = async () => {
        if (confirm("Bạn có chắc chắn muốn xóa toàn bộ bộ nhớ đệm (Context Caches)? Việc này giúp làm mới dữ liệu nhưng sẽ làm AI xử lý chậm hơn và tốn phí hơn ở lần chạy tiếp theo.")) {
            await db.clearAll(); // Clears MCQs and Caches
            toast.success("Đã xóa sạch bộ nhớ đệm.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border dark:border-slate-800 flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50 flex-shrink-0">
                    <h3 className="text-xl font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                        <SettingsIcon className="text-indigo-600 dark:text-indigo-400" /> Cài đặt hệ thống
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                    >
                        <span className="text-2xl">✕</span>
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                    {/* Provider Selection */}
                    <section>
                        <div className="flex justify-between items-center mb-3">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                                AI Engine
                            </label>
                            {settings.provider === 'shopaikey' && (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded-full animate-pulse">
                                    Tính năng dành riêng cho Admin
                                </span>
                            )}
                        </div>
                        <div className="flex p-1 gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl border dark:border-slate-700">
                            <button
                                onClick={() => setSettings({ ...settings, provider: 'google' })}
                                className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${settings.provider === 'google' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                Google Gemini
                            </button>
                            <button
                                onClick={() => setSettings({ ...settings, provider: 'shopaikey' })}
                                className={`flex-1 py-2 px-4 rounded-lg text-sm font-bold transition-all ${settings.provider === 'shopaikey' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                ShopAIKey
                            </button>
                        </div>
                    </section>

                    {/* API Key - Contextual */}
                    <section className="animate-in slide-in-from-top-2 duration-300">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                            {settings.provider === 'google' ? 'Google Gemini API Key' : 'ShopAIKey API Key'}
                        </label>
                        <input
                            type="password"
                            value={settings.provider === 'google' ? settings.apiKey : settings.shopAIKeyKey}
                            onChange={e => {
                                if (settings.provider === 'google') setSettings({ ...settings, apiKey: e.target.value });
                                else setSettings({ ...settings, shopAIKeyKey: e.target.value });
                            }}
                            placeholder={settings.provider === 'google' ? "Dán key từ Google AI Studio..." : "Dán key từ shopaikey.com..."}
                            className="w-full border dark:border-slate-700 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-800 dark:text-white transition-all shadow-sm"
                        />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1">
                            <Zap size={10} className="text-amber-500" />
                            {settings.provider === 'google' 
                                ? 'Hệ thống tự động xoay vòng nếu nhập nhiều Key (phân cách bằng dấu phẩy).' 
                                : 'Này của Admin và phải tốn tiền nên các bạn đừng quan tâm nhé!'}
                        </p>
                    </section>

                    {/* Model Selection */}
                    <section>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                            Mô hình AI (Model)
                        </label>
                        <select
                            value={settings.model}
                            onChange={e => setSettings({ ...settings, model: e.target.value })}
                            className="w-full border dark:border-slate-700 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white dark:bg-slate-800 dark:text-white transition-all shadow-sm"
                        >
                            {settings.provider === 'google' ? (
                                <>
                                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Mạnh nhất - Tư duy Y khoa sâu)</option>
                                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (Khuyên dùng - Nhanh & Mượt)</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Ổn định - Tương thích cao)</option>
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Sắp xếp dự phòng - Tương thích)</option>
                                    <option value="gemini-2.0-flash">Gemini 2.0 Flash (Cực nhanh)</option>
                                </>
                            ) : (
                                <optgroup label="Hệ thống ShopAIKey (2026)">
                                    <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (Mạnh nhất 2026)</option>
                                    <option value="gemini-3.1-flash-lite-preview">Gemini 3.1 Flash-Lite (Tối ưu chi phí)</option>
                                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Rất ổn định)</option>
                                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Cân bằng hiệu suất)</option>
                                </optgroup>
                            )}
                        </select>
                    </section>

                    {/* UI Redesign Section: System Instruction (Wait, user wanted "Advanced" button) */}
                     <section>
                        <div className="flex justify-between items-center mb-1.5">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                                Vai trò AI (System Instruction)
                            </label>
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        setSettings({ ...settings, customPrompt: e.target.value });
                                    }
                                }}
                                className="text-[10px] font-bold border dark:border-slate-700 rounded px-1.5 py-0.5 text-indigo-600 dark:text-indigo-400 bg-white dark:bg-slate-800 outline-none shadow-sm"
                                defaultValue=""
                            >
                                <option value="" disabled>Chọn mẫu...</option>
                                <option value="Bạn là GIÁO SƯ Y KHOA ĐẦU NGÀNH. Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Y khoa, giải thích chi tiết cơ chế bệnh sinh, chẩn đoán phân biệt và trích dẫn nguồn uy tín (Harrison, Bộ Y tế).">Y Khoa (Medical)</option>
                                <option value="Bạn là GIÁO VIÊN TIẾNG ANH (IELTS EXAMINER). Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Tiếng Anh, giải thích ngữ pháp, từ vựng, collocations và lỗi sai thường gặp.">Tiếng Anh (English)</option>
                                <option value="Bạn là LUẬT SƯ CẤP CAO. Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Luật, trích dẫn điều khoản luật chính xác và giải thích tình huống pháp lý.">Luật (Law)</option>
                                <option value="Bạn là CHUYÊN GIA CÔNG NGHỆ THÔNG TIN. Nhiệm vụ: Trích xuất câu hỏi IT/Coding, giải thích code, thuật toán và kiến thức hệ thống.">CNTT (IT/Coding)</option>
                            </select>
                        </div>
                        <textarea
                            value={settings.customPrompt}
                            onChange={e => setSettings({ ...settings, customPrompt: e.target.value })}
                            placeholder="Mặc định: Giáo sư Y khoa..."
                            rows={3}
                            className="w-full border dark:border-slate-700 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none dark:bg-slate-800 dark:text-slate-200 shadow-sm"
                        />
                    </section>

                    {/* NEW: ADVANCED SECTION TOGGLE */}
                    <section className="pt-2">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className="w-full flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 hover:border-indigo-200 dark:hover:border-indigo-900 transition-all group"
                        >
                            <span className="flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-300">
                                <ShieldAlert size={16} className={showAdvanced ? "text-indigo-600" : "text-slate-400"} />
                                Thiết lập nâng cao
                            </span>
                            {showAdvanced ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400 group-hover:translate-y-0.5 transition-transform" />}
                        </button>

                        {showAdvanced && (
                            <div className="mt-4 p-4 rounded-xl border border-dashed border-slate-200 dark:border-slate-700 space-y-5 animate-in slide-in-from-top-4 duration-300">
                                {/* Fast Extraction */}
                                <div className="flex items-start justify-between gap-4">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <Zap size={14} className="text-amber-500" />
                                            Trích xuất nhanh (Skip Analysis)
                                        </label>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Bỏ qua bước quét đếm câu để tiết kiệm Token và tăng tốc độ xử lý ban đầu.
                                        </p>
                                    </div>
                                    <input 
                                        type="checkbox"
                                        checked={settings.skipAnalysis}
                                        onChange={e => setSettings({ ...settings, skipAnalysis: e.target.checked })}
                                        className="w-5 h-5 text-indigo-600 border-gray-300 rounded-md focus:ring-indigo-500 cursor-pointer"
                                    />
                                </div>

                                {/* Concurrency */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <Gauge size={14} className="text-indigo-500" />
                                            Số luồng xử lý song song (Concurrency)
                                        </label>
                                        <select
                                            value={settings.concurrencyLimit || 2}
                                            onChange={e => setSettings({ ...settings, concurrencyLimit: parseInt(e.target.value) })}
                                            className="text-xs font-bold border dark:border-slate-700 rounded px-2 py-1 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 outline-none"
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                <option key={n} value={n}>{n} luồng</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic leading-tight">
                                        * Khuyên dùng: 1-2 luồng (Key MIỄN PHÍ) hoặc 4-8 luồng (Key TRẢ PHÍ). Tăng quá cao sẽ dễ lỗi quá tải (429).
                                    </p>
                                </div>

                                {/* Cache Management */}
                                <div className="pt-2 border-t dark:border-slate-700 space-y-3">
                                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                        <Database size={14} className="text-emerald-500" />
                                        Quản lý bộ nhớ AI (Context Cache)
                                    </label>
                                    <button
                                        onClick={handleClearCaches}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-red-600 bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 hover:bg-red-100 transition-colors rounded-lg"
                                    >
                                        <Trash2 size={14} /> Xóa bộ nhớ đệm
                                    </button>
                                    <p className="text-[9px] text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                        Giúp làm mới dữ liệu đọc file. Việc xóa cache sẽ làm AI quét lại file từ đầu (tốn Quota hơn).
                                    </p>
                                </div>
                            </div>
                        )}
                    </section>
                </div>

                {/* Footer */}
                <div className="p-4 border-t bg-gray-50 dark:bg-slate-800/50 dark:border-slate-800 flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 shadow-md active:scale-[0.98] transition-all"
                    >
                        Lưu và Đóng
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
