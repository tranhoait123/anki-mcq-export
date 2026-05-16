import React, { useState } from 'react';
import { Settings as SettingsIcon, Trash2, ChevronDown, ChevronUp, ShieldAlert, Gauge, Zap, Database, RefreshCw, CheckCircle2, AlertCircle, Archive, Eye } from 'lucide-react';
import { AppSettings } from '../types';
import { db } from '../core/db';
import { toast } from 'sonner';
import { validateShopAIKeyConnection } from '../core/brain';
import { AIProvider, coerceModelForProvider, getModelGroups, getShopAIKeyVerifiedModelGroups } from '../utils/models';
import { ConfirmDialogOptions } from '../hooks/useConfirmDialog';
import type { ShopAIKeyValidationResult } from '../core/brain/openAiProvider';

interface SettingsModalProps {
    show: boolean;
    onClose: () => void;
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
    confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ show, onClose, settings, setSettings, confirm }) => {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isCheckingShopAIKey, setIsCheckingShopAIKey] = useState(false);
    const [shopAIKeyValidation, setShopAIKeyValidation] = useState<ShopAIKeyValidationResult | null>(null);
    const [verifiedShopAIKeyModels, setVerifiedShopAIKeyModels] = useState<string[]>([]);
    const modelGroups = settings.provider === 'shopaikey' && verifiedShopAIKeyModels.length > 0
        ? getShopAIKeyVerifiedModelGroups(verifiedShopAIKeyModels)
        : getModelGroups(settings.provider);
    
    if (!show) return null;

    const handleProviderChange = (provider: AIProvider) => {
        const nextModel = coerceModelForProvider(provider, settings.model);
        setShopAIKeyValidation(null);
        setVerifiedShopAIKeyModels([]);
        setSettings({ ...settings, provider, model: nextModel });
        if (nextModel !== settings.model) {
            toast.info("Đã tự đổi model cho khớp provider mới để tránh lỗi endpoint.");
        }
    };

    const handleShopAIKeyCheck = async () => {
        setIsCheckingShopAIKey(true);
        const result = await validateShopAIKeyConnection(settings.shopAIKeyKey, settings.model);
        setShopAIKeyValidation(result);
        setVerifiedShopAIKeyModels(result.models);
        setIsCheckingShopAIKey(false);

        if (result.selectedModelAvailable && result.selectedModel !== settings.model) {
            setSettings({ ...settings, model: result.selectedModel });
        }

        if (result.ok) {
            toast.success(result.message);
        } else {
            toast.error(result.message, { duration: 7000 });
        }
    };

    const handleClearAll = async () => {
        const ok = await confirm({
            title: 'Xóa tất cả dữ liệu?',
            body: 'CẢNH BÁO: Việc này sẽ xóa toàn bộ bộ nhớ đệm, danh sách câu hỏi hiện tại, các file đã tải lên và toàn bộ Thư viện bộ đề (Projects). Các cài đặt và API Key sẽ được giữ nguyên. Bạn có chắc chắn không?',
            confirmLabel: 'Xóa tất cả',
            variant: 'danger',
            onConfirm: async () => {
                await db.clearAll();
                setTimeout(() => window.location.reload(), 1000); // Reload to reset all React state safely
            },
        });
        if (ok) {
            toast.success("Đã xóa sạch toàn bộ dữ liệu ứng dụng.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-2xl shadow-2xl w-full max-w-lg sm:mx-4 overflow-hidden animate-in zoom-in-95 duration-200 border dark:border-slate-800 flex flex-col h-[100dvh] sm:h-auto sm:max-h-[90vh]">
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
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full">
                                    OpenAI-compatible gateway
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-3 p-1 gap-1 bg-gray-100 dark:bg-slate-800 rounded-xl border dark:border-slate-700">
                            <button
                                onClick={() => handleProviderChange('google')}
                                className={`min-h-11 py-2 px-2 rounded-lg text-sm font-bold leading-tight transition-all ${settings.provider === 'google' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                <span className="block">Google</span>
                                <span className="block">Gemini</span>
                            </button>
                            <button
                                onClick={() => handleProviderChange('shopaikey')}
                                className={`min-h-11 py-2 px-2 rounded-lg text-sm font-bold leading-tight transition-all ${settings.provider === 'shopaikey' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                ShopAIKey
                            </button>
                            <button
                                onClick={() => handleProviderChange('openrouter')}
                                className={`min-h-11 py-2 px-2 rounded-lg text-sm font-bold leading-tight transition-all ${settings.provider === 'openrouter' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
                            >
                                OpenRouter
                            </button>
                        </div>
                    </section>

                    {/* API Key - Contextual */}
                    <section className="animate-in slide-in-from-top-2 duration-300">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                            {settings.provider === 'google' ? 'Google Gemini API Key' : settings.provider === 'shopaikey' ? 'ShopAIKey API Key' : 'OpenRouter API Key'}
                        </label>
                        <input
                            type="password"
                            value={settings.provider === 'google' ? settings.apiKey : settings.provider === 'shopaikey' ? settings.shopAIKeyKey : (settings.openRouterKey || '')}
                            onChange={e => {
                                setShopAIKeyValidation(null);
                                setVerifiedShopAIKeyModels([]);
                                if (settings.provider === 'google') setSettings({ ...settings, apiKey: e.target.value });
                                else if (settings.provider === 'shopaikey') setSettings({ ...settings, shopAIKeyKey: e.target.value });
                                else setSettings({ ...settings, openRouterKey: e.target.value });
                            }}
                            placeholder={settings.provider === 'google' ? "Dán key từ Google AI Studio..." : settings.provider === 'shopaikey' ? "Dán key từ shopaikey.com..." : "Dán key từ openrouter.ai..."}
                            className="w-full border dark:border-slate-700 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-800 dark:text-white transition-all shadow-sm"
                        />
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-1.5 flex items-center gap-1">
                            <Zap size={10} className="text-amber-500" />
                            {settings.provider === 'google'
                                ? 'Hệ thống tự động xoay vòng nếu nhập nhiều Key (phân cách bằng dấu phẩy).'
                                : settings.provider === 'shopaikey'
                                    ? 'Dùng key ShopAIKey dạng Bearer token; có thể kiểm tra key/model trước khi quét để tránh lỗi batch.'
                                    : 'Truy cập hàng loạt model đỉnh nhất như Claude 3.7, GPT-4o, DeepSeek.'}
                        </p>
                        {settings.provider === 'shopaikey' && (
                            <div className="mt-3 space-y-2">
                                <button
                                    type="button"
                                    onClick={handleShopAIKeyCheck}
                                    disabled={isCheckingShopAIKey || !settings.shopAIKeyKey.trim()}
                                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                                >
                                    <RefreshCw size={14} className={isCheckingShopAIKey ? 'animate-spin' : ''} />
                                    {isCheckingShopAIKey ? 'Đang kiểm tra ShopAIKey...' : 'Kiểm tra key và model ShopAIKey'}
                                </button>
                                {shopAIKeyValidation && (
                                    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-[11px] leading-relaxed ${
                                        shopAIKeyValidation.ok
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300'
                                            : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-300'
                                    }`}>
                                        {shopAIKeyValidation.ok ? <CheckCircle2 size={14} className="mt-0.5 flex-shrink-0" /> : <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />}
                                        <span>
                                            {shopAIKeyValidation.message}
                                            {shopAIKeyValidation.models.length > 0 && ` Đã tải ${shopAIKeyValidation.models.length} model khả dụng.`}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>

                    {/* Model Selection */}
                    <section>
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">
                            Mô hình AI (Model)
                        </label>
                        <select
                            value={settings.model}
                            onChange={e => {
                                setShopAIKeyValidation(null);
                                setSettings({ ...settings, model: e.target.value });
                            }}
                            className="w-full border dark:border-slate-700 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-indigo-500 outline-none bg-white dark:bg-slate-800 dark:text-white transition-all shadow-sm"
                        >
                            {modelGroups.map(group => (
                                <optgroup key={group.label} label={group.label}>
                                    {group.options.map(option => (
                                        <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                </optgroup>
                            ))}
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

                                <div className="flex items-start justify-between gap-4 border-t border-slate-200/70 pt-4 dark:border-slate-700">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <Archive size={14} className="text-emerald-500" />
                                            Thư viện bộ đề
                                        </label>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Tự lưu/mở bộ đề đã xử lý. Tắt để giảm đọc/ghi IndexedDB và giảm lag trên máy yếu.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={settings.projectLibraryEnabled !== false}
                                        onChange={e => setSettings({ ...settings, projectLibraryEnabled: e.target.checked })}
                                        className="w-5 h-5 text-indigo-600 border-gray-300 rounded-md focus:ring-indigo-500 cursor-pointer"
                                    />
                                </div>

                                <div className="flex items-start justify-between gap-4 border-t border-slate-200/70 pt-4 dark:border-slate-700">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <Eye size={14} className="text-sky-500" />
                                            Xem câu hỏi realtime
                                        </label>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Hiện câu ngay khi AI stream về. Có thể tắt nếu tài liệu lớn hoặc máy yếu bị lag.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={settings.realtimePreviewEnabled !== false}
                                        onChange={e => setSettings({ ...settings, realtimePreviewEnabled: e.target.checked })}
                                        className="w-5 h-5 text-indigo-600 border-gray-300 rounded-md focus:ring-indigo-500 cursor-pointer"
                                    />
                                </div>
                                
                                <div className="flex items-start justify-between gap-4 border-t border-slate-200/70 pt-4 dark:border-slate-700">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <ShieldAlert size={14} className="text-amber-500" />
                                            Chỉ xử lý batch chính (Tắt cứu câu)
                                        </label>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Không tự động chia nhỏ để quét lại các câu bị thiếu. Giúp tiết kiệm Token và tránh request quá nhiều.
                                        </p>
                                    </div>
                                    <input
                                        type="checkbox"
                                        checked={settings.mainBatchOnlyRescue === true}
                                        onChange={e => setSettings({ ...settings, mainBatchOnlyRescue: e.target.checked })}
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
                                            value={settings.concurrencyLimit || 1}
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

                                {/* Adaptive Batching */}
                                <div className="flex items-start justify-between gap-4 border-t border-slate-200/70 pt-4 dark:border-slate-700">
                                    <div className="flex-1">
                                        <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                            <RefreshCw size={14} className="text-indigo-500" />
                                            Adaptive Batch Sizing (Nâng cao)
                                        </label>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                                            Tự động giảm kích thước Batch (số câu/lần) khi hệ thống bị quá tải hoặc gặp lỗi. Giúp tăng độ ổn định tuyệt đối nhưng có thể tốn thêm Token.
                                        </p>
                                    </div>
                                    <div className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={settings.adaptiveBatching !== false}
                                            onChange={e => setSettings({ ...settings, adaptiveBatching: e.target.checked })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-300 dark:peer-focus:ring-indigo-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-indigo-600"></div>
                                    </div>
                                </div>

                                {/* Storage Management */}
                                <div className="pt-2 border-t dark:border-slate-700 space-y-3">
                                    <label className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                        <Database size={14} className="text-red-500" />
                                        Xóa Dữ Liệu Ứng Dụng
                                    </label>
                                    <button
                                        onClick={handleClearAll}
                                        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-red-600 border border-red-700 hover:bg-red-700 transition-colors rounded-lg shadow-sm"
                                    >
                                        <Trash2 size={14} /> Xóa tất cả bộ nhớ & dữ liệu
                                    </button>
                                    <p className="text-[9px] text-gray-500 dark:text-gray-400 text-center leading-relaxed">
                                        Xóa toàn bộ câu hỏi hiện tại, files, bộ nhớ đệm AI (Cache) và toàn bộ Thư viện bộ đề (Projects). Không xóa API Key và Cài đặt.
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
