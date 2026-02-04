import React from 'react';
import { Settings as SettingsIcon } from 'lucide-react';
import { AppSettings } from '../types';

interface SettingsModalProps {
    show: boolean;
    onClose: () => void;
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ show, onClose, settings, setSettings }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border dark:border-slate-800">
                <div className="p-6 border-b dark:border-slate-800 flex justify-between items-center bg-gray-50 dark:bg-slate-800/50">
                    <h3 className="tex-xl font-bold flex items-center gap-2 text-slate-800 dark:text-white">
                        <SettingsIcon className="text-indigo-600 dark:text-indigo-400" /> Cài đặt hệ thống
                    </h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-200"
                    >
                        ✕
                    </button>
                </div>

                <div className="p-6 space-y-5">
                    {/* API Key */}
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Google Gemini API Key
                        </label>
                        <input
                            type="password"
                            value={settings.apiKey}
                            onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
                            placeholder="Nhập API Key (có thể nhập nhiều key cách nhau bằng dấu phẩy để tự động xoay vòng)"
                            className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                            Hệ thống đã loại bỏ Key mặc định. Vui lòng nhập ít nhất 1 Key để sử dụng. Nhập nhiều Key phân cách bằng dấu phẩy để bypass giới hạn miễn phí.
                        </p>
                    </div>

                    {/* Model Selection */}
                    <div>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1">
                            Mô hình AI (Model)
                        </label>
                        <select
                            value={settings.model}
                            onChange={e => setSettings({ ...settings, model: e.target.value })}
                            className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-white"
                        >
                            <option value="gemini-1.5-flash">Gemini 1.5 Flash (Nhanh & Tiết kiệm)</option>
                            <option value="gemini-1.5-pro">Gemini 1.5 Pro (Thông minh nhất - Tư duy Y khoa sâu)</option>
                            <option value="gemini-2.0-flash-exp">Gemini 2.0 Flash (Thế hệ mới - Cực nhanh)</option>
                        </select>
                    </div>

                    {/* Custom Prompt */}
                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">
                                Vai trò AI (System Instruction)
                            </label>
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        setSettings({ ...settings, customPrompt: e.target.value });
                                    }
                                }}
                                className="text-xs border rounded p-1 text-slate-600 dark:text-slate-300 dark:bg-slate-800 dark:border-slate-700 outline-none"
                                defaultValue=""
                            >
                                <option value="" disabled>Chọn mẫu có sẵn...</option>
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
                            rows={4}
                            className="w-full border rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200"
                        />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1">
                            Thay đổi vai trò để phù hợp môn học khác (VD: "Giáo viên Tiếng Anh", "Luật sư"). Để trống để dùng mặc định.
                        </p>
                    </div>
                </div>

                <div className="p-4 border-t bg-gray-50 dark:bg-slate-800/50 dark:border-slate-800 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-6 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 shadow-sm transition-all"
                    >
                        Đã Xong
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SettingsModal;
