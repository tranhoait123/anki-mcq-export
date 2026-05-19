import React, { useState } from 'react';
import { Settings as SettingsIcon, Trash2, ChevronDown, ShieldAlert, Gauge, Zap, Database, RefreshCw, CheckCircle2, AlertCircle, Archive, Eye, ShieldCheck, Lock } from 'lucide-react';
import { AppSettings } from '../types';
import { db } from '../core/db';
import { toast } from 'sonner';
import { validateShopAIKeyConnection } from '../core/brain';
import { AIProvider, coerceModelForProvider, getModelGroups, getShopAIKeyVerifiedModelGroups } from '../utils/models';
import { ConfirmDialogOptions } from '../hooks/useConfirmDialog';
import type { ShopAIKeyValidationResult } from '../core/brain/openAiProvider';
import { GOOGLE_RPM_PRESETS, normalizeGoogleRpmLimit } from '../utils/rateLimitSettings';

interface SettingsModalProps {
    show: boolean;
    onClose: () => void;
    settings: AppSettings;
    setSettings: (settings: AppSettings) => void;
    confirm: (options: ConfirmDialogOptions) => Promise<boolean>;
}

interface ToggleProps {
    enabled: boolean;
    onChange: (enabled: boolean) => void;
    icon: React.ReactNode;
    label: string;
    description: string;
    colorClass?: string;
}

const Toggle: React.FC<ToggleProps> = ({ enabled, onChange, icon, label, description, colorClass = "text-indigo-500" }) => (
    <div className="flex items-start justify-between gap-4 py-1">
        <div className="flex-1">
            <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <span className={`${colorClass} filter drop-shadow-[0_0_3px_rgba(var(--color-rgb),0.5)]`}>
                    {icon}
                </span>
                {label}
            </label>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
                {description}
            </p>
        </div>
        <button
            type="button"
            onClick={() => onChange(!enabled)}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${enabled ? 'bg-indigo-600' : 'bg-gray-200 dark:bg-slate-700'}`}
        >
            <span
                aria-hidden="true"
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${enabled ? 'translate-x-5' : 'translate-x-0'}`}
            />
        </button>
    </div>
);

const SettingsModal: React.FC<SettingsModalProps> = ({ show, onClose, settings, setSettings, confirm }) => {
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [isCheckingShopAIKey, setIsCheckingShopAIKey] = useState(false);
    const [shopAIKeyValidation, setShopAIKeyValidation] = useState<ShopAIKeyValidationResult | null>(null);
    const [verifiedShopAIKeyModels, setVerifiedShopAIKeyModels] = useState<string[]>([]);
    const modelGroups = settings.provider === 'shopaikey' && verifiedShopAIKeyModels.length > 0
        ? getShopAIKeyVerifiedModelGroups(verifiedShopAIKeyModels)
        : getModelGroups(settings.provider);
    const googleRpmLimiterEnabled = settings.googleRpmLimiterEnabled !== false;
    const googleRpmLimit = normalizeGoogleRpmLimit(settings.googleRpmLimitPerMinute);
    
    if (!show) return null;

    const setGoogleRpmLimit = (value: unknown) => {
        setSettings({ ...settings, googleRpmLimitPerMinute: normalizeGoogleRpmLimit(value) });
    };

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
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md flex items-center justify-center z-50 animate-in fade-in duration-300">
            <div className="bg-white dark:bg-slate-900 rounded-none sm:rounded-3xl shadow-2xl w-full max-w-lg sm:mx-4 overflow-hidden animate-in zoom-in-95 duration-300 border dark:border-slate-800 flex flex-col h-[100dvh] sm:h-auto sm:max-h-[92vh]">
                {/* Header */}
                <div className="p-6 border-b dark:border-slate-800 flex justify-between items-center bg-gray-50/50 dark:bg-slate-800/30 flex-shrink-0">
                    <h3 className="text-xl font-black flex items-center gap-3 text-slate-800 dark:text-white tracking-tight">
                        <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl">
                            <SettingsIcon className="text-indigo-600 dark:text-indigo-400 w-5 h-5" />
                        </div>
                        Cài đặt hệ thống
                    </h3>
                    <button
                        onClick={onClose}
                        className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-slate-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-all"
                    >
                        <span className="text-xl font-light">✕</span>
                    </button>
                </div>

                {/* Body - Scrollable */}
                <div className="p-6 space-y-7 overflow-y-auto custom-scrollbar">
                    {/* Provider Selection */}
                    <section>
                        <div className="flex justify-between items-center mb-3">
                            <label className="block text-sm font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                                AI Engine
                            </label>
                            {settings.provider === 'shopaikey' && (
                                <span className="text-[10px] font-black px-2.5 py-1 bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 rounded-full shadow-sm">
                                    GATEWAY VERIFIED
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-3 p-1.5 gap-1.5 bg-gray-100/80 dark:bg-slate-800 rounded-2xl border dark:border-slate-700">
                            <button
                                onClick={() => handleProviderChange('google')}
                                className={`min-h-12 py-2 px-2 rounded-xl text-sm font-bold leading-tight transition-all duration-300 ${settings.provider === 'google' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md ring-1 ring-black/5' : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-700/50'}`}
                            >
                                <span className="block opacity-70 text-[10px] uppercase mb-0.5">Google</span>
                                <span className="block">Gemini</span>
                            </button>
                            <button
                                onClick={() => handleProviderChange('shopaikey')}
                                className={`min-h-12 py-2 px-2 rounded-xl text-sm font-bold leading-tight transition-all duration-300 ${settings.provider === 'shopaikey' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md ring-1 ring-black/5' : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-700/50'}`}
                            >
                                <span className="block opacity-70 text-[10px] uppercase mb-0.5">Store</span>
                                <span className="block">ShopAIKey</span>
                            </button>
                            <button
                                onClick={() => handleProviderChange('openrouter')}
                                className={`min-h-12 py-2 px-2 rounded-xl text-sm font-bold leading-tight transition-all duration-300 ${settings.provider === 'openrouter' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-md ring-1 ring-black/5' : 'text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-slate-700/50'}`}
                            >
                                <span className="block opacity-70 text-[10px] uppercase mb-0.5">Global</span>
                                <span className="block">OpenRouter</span>
                            </button>
                        </div>
                    </section>

                    {/* API Key - Contextual */}
                    <section className="animate-in slide-in-from-top-2 duration-300">
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">
                            {settings.provider === 'google' ? 'Google Gemini API Key' : settings.provider === 'shopaikey' ? 'ShopAIKey API Key' : 'OpenRouter API Key'}
                        </label>
                        <div className="relative group">
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
                                className="w-full border dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none dark:bg-slate-800 dark:text-white transition-all shadow-sm group-hover:border-indigo-300 dark:group-hover:border-indigo-800"
                            />
                        </div>
                        <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1.5 px-1">
                            <Zap size={11} className="text-amber-500 fill-amber-500/20" />
                            {settings.provider === 'google'
                                ? 'Tự động xoay vòng nếu nhập nhiều Key (phân cách bằng dấu phẩy).'
                                : settings.provider === 'shopaikey'
                                    ? 'Dùng key ShopAIKey dạng Bearer token; nên kiểm tra model trước khi quét.'
                                    : 'Truy cập hàng loạt model đỉnh nhất như Claude 3.7, GPT-4o, DeepSeek.'}
                        </p>
                    </section>

                    {/* Model Selection */}
                    <section>
                        <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide text-[11px]">
                            Mô hình trí tuệ nhân tạo
                        </label>
                        <div className="relative">
                            <select
                                value={settings.model}
                                onChange={e => {
                                    setShopAIKeyValidation(null);
                                    setSettings({ ...settings, model: e.target.value });
                                }}
                                className="w-full border dark:border-slate-700 rounded-xl p-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500 outline-none bg-white dark:bg-slate-800 dark:text-white transition-all shadow-sm appearance-none cursor-pointer"
                            >
                                {modelGroups.map(group => (
                                    <optgroup key={group.label} label={group.label}>
                                        {group.options.map(option => (
                                            <option key={option.value} value={option.value}>{option.label}</option>
                                        ))}
                                    </optgroup>
                                ))}
                            </select>
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                                <ChevronDown size={18} />
                            </div>
                        </div>
                    </section>

                    {/* Vai trò AI */}
                     <section>
                        <div className="flex justify-between items-center mb-2">
                            <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide text-[11px]">
                                Vai trò AI (System)
                            </label>
                            <div className="flex items-center gap-1.5">
                                <span className="text-[9px] text-slate-400 font-bold">MẪU:</span>
                                <select
                                    onChange={(e) => {
                                        if (e.target.value) {
                                            setSettings({ ...settings, customPrompt: e.target.value });
                                        }
                                    }}
                                    className="text-[10px] font-black border dark:border-slate-700 rounded-lg px-2 py-1 text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 outline-none shadow-sm cursor-pointer hover:bg-indigo-100 transition-colors"
                                    defaultValue=""
                                >
                                    <option value="" disabled>Chọn mẫu...</option>
                                    <option value="Bạn là GIÁO SƯ Y KHOA ĐẦU NGÀNH. Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Y khoa, giải thích chi tiết cơ chế bệnh sinh, chẩn đoán phân biệt và trích dẫn nguồn uy tín (Harrison, Bộ Y tế).">Y Khoa</option>
                                    <option value="Bạn là GIÁO VIÊN TIẾNG ANH (IELTS EXAMINER). Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Tiếng Anh, giải thích ngữ pháp, từ vựng, collocations và lỗi sai thường gặp.">Tiếng Anh</option>
                                    <option value="Bạn là LUẬT SƯ CẤP CAO. Nhiệm vụ: Trích xuất câu hỏi trắc nghiệm Luật, trích dẫn điều khoản luật chính xác và giải thích tình huống pháp lý.">Luật Pháp</option>
                                    <option value="Bạn là CHUYÊN GIA CÔNG NGHỆ THÔNG TIN. Nhiệm vụ: Trích xuất câu hỏi IT/Coding, giải thích code, thuật toán và kiến thức hệ thống.">IT/Coding</option>
                                </select>
                            </div>
                        </div>
                        <textarea
                            value={settings.customPrompt}
                            onChange={e => setSettings({ ...settings, customPrompt: e.target.value })}
                            placeholder="Mặc định: Giáo sư Y khoa..."
                            rows={3}
                            className="w-full border dark:border-slate-700 rounded-xl p-3 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none dark:bg-slate-800 dark:text-slate-200 shadow-inner group-hover:border-indigo-300 transition-all font-medium leading-relaxed"
                        />
                    </section>

                    {/* ADVANCED SECTION */}
                    <section className="pt-2">
                        <button
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all duration-300 group ${showAdvanced ? 'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-200 dark:border-indigo-800' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-700'}`}
                        >
                            <span className="flex items-center gap-3 text-sm font-black text-slate-700 dark:text-slate-300">
                                <ShieldAlert size={18} className={`${showAdvanced ? "text-indigo-600 drop-shadow-[0_0_5px_rgba(79,70,229,0.5)]" : "text-slate-400"}`} />
                                THIẾT LẬP NÂNG CAO
                            </span>
                            <div className={`p-1 rounded-full transition-all duration-300 ${showAdvanced ? 'bg-indigo-600 text-white rotate-180' : 'bg-slate-200 dark:bg-slate-700 text-slate-500'}`}>
                                <ChevronDown size={14} />
                            </div>
                        </button>

                        {showAdvanced && (
                            <div className="mt-4 p-5 rounded-2xl border-2 border-dashed border-indigo-100 dark:border-indigo-900/30 space-y-6 animate-in slide-in-from-top-4 duration-500">
                                <Toggle 
                                    enabled={settings.skipAnalysis || false}
                                    onChange={val => setSettings({ ...settings, skipAnalysis: val })}
                                    icon={<Zap size={16} />}
                                    label="Trích xuất nhanh (Skip Analysis)"
                                    description="Bỏ qua bước quét đếm câu để tiết kiệm Token và tăng tốc độ xử lý ban đầu."
                                    colorClass="text-amber-500"
                                />

                                <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle 
                                        enabled={settings.projectLibraryEnabled !== false}
                                        onChange={val => setSettings({ ...settings, projectLibraryEnabled: val })}
                                        icon={<Archive size={16} />}
                                        label="Thư viện bộ đề (Projects)"
                                        description="Tự lưu/mở bộ đề đã xử lý. Giảm lag nếu tắt trên máy quá yếu."
                                        colorClass="text-emerald-500"
                                    />
                                </div>

                                <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle 
                                        enabled={settings.realtimePreviewEnabled !== false}
                                        onChange={val => setSettings({ ...settings, realtimePreviewEnabled: val })}
                                        icon={<Eye size={16} />}
                                        label="Xem câu hỏi Realtime"
                                        description="Hiện câu ngay khi AI viết. Tắt nếu tài liệu cực lớn gây lag trình duyệt."
                                        colorClass="text-sky-500"
                                    />
                                </div>
                                
                                <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle 
                                        enabled={settings.mainBatchOnlyRescue === true}
                                        onChange={val => setSettings({ ...settings, mainBatchOnlyRescue: val })}
                                        icon={<ShieldAlert size={16} />}
                                        label="Ưu tiên tốc độ (Tắt cứu câu)"
                                        description="Không tự động quét lại các câu bị thiếu để tiết kiệm Token tối đa."
                                        colorClass="text-orange-500"
                                    />
                                </div>

                                {/* Concurrency */}
                                <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <Gauge size={16} className="text-indigo-500" />
                                            Luồng song song (Concurrency)
                                        </label>
                                        <select
                                            value={settings.concurrencyLimit || 1}
                                            onChange={e => setSettings({ ...settings, concurrencyLimit: parseInt(e.target.value) })}
                                            className="text-xs font-black border-2 border-indigo-100 dark:border-indigo-900/50 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                <option key={n} value={n}>{n} LUỒNG</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic leading-relaxed px-1">
                                        * KHUYÊN DÙNG: 1-2 luồng (Key FREE) hoặc 4-8 luồng (Key PRO). Tránh để quá cao dễ bị Google chặn IP (429).
                                    </p>
                                </div>

                                {/* Google RPM Guard */}
                                <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle
                                        enabled={googleRpmLimiterEnabled}
                                        onChange={val => setSettings({ ...settings, googleRpmLimiterEnabled: val })}
                                        icon={<ShieldCheck size={16} />}
                                        label="Google/Gemini RPM Guard"
                                        description="Giới hạn cứng số request Google mỗi phút để tránh burst 429/503. Key trả phí có thể tăng mức này."
                                        colorClass="text-emerald-500"
                                    />
                                    <div className={`rounded-2xl border border-emerald-100 bg-emerald-50/40 p-3 space-y-3 transition-opacity dark:border-emerald-900/40 dark:bg-emerald-950/10 ${googleRpmLimiterEnabled ? 'opacity-100' : 'opacity-50'}`}>
                                        <div className="grid grid-cols-4 gap-2">
                                            {GOOGLE_RPM_PRESETS.map(limit => (
                                                <button
                                                    key={limit}
                                                    type="button"
                                                    disabled={!googleRpmLimiterEnabled}
                                                    onClick={() => setGoogleRpmLimit(limit)}
                                                    className={`rounded-xl border px-2 py-2 text-[10px] font-black transition-all disabled:cursor-not-allowed ${
                                                        googleRpmLimit === limit
                                                            ? 'border-emerald-500 bg-emerald-500 text-white shadow-sm'
                                                            : 'border-emerald-100 bg-white text-emerald-700 hover:border-emerald-300 dark:border-emerald-900/60 dark:bg-slate-900 dark:text-emerald-300'
                                                    }`}
                                                >
                                                    {limit}/phút
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex items-center justify-between gap-3">
                                            <div>
                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200">Tuỳ chỉnh RPM</p>
                                                <p className="text-[10px] text-slate-500 dark:text-slate-400">Mặc định 14/phút an toàn cho free-tier.</p>
                                            </div>
                                            <input
                                                type="number"
                                                min={1}
                                                max={600}
                                                disabled={!googleRpmLimiterEnabled}
                                                value={googleRpmLimit}
                                                onChange={e => setGoogleRpmLimit(e.target.value)}
                                                className="w-24 rounded-xl border-2 border-emerald-100 bg-white px-3 py-2 text-right text-xs font-black text-emerald-700 outline-none transition-all focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed dark:border-emerald-900/50 dark:bg-slate-800 dark:text-emerald-300"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Vision Pages Per Batch */}
                                <div className="space-y-3 border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <div className="flex items-center justify-between">
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <RefreshCw size={16} className="text-indigo-500" />
                                            Số trang mỗi Batch (PDF/Ảnh)
                                        </label>
                                        <select
                                            value={settings.visionPagesPerBatch || 2}
                                            onChange={e => setSettings({ ...settings, visionPagesPerBatch: parseInt(e.target.value) })}
                                            className="text-xs font-black border-2 border-indigo-100 dark:border-indigo-900/50 rounded-xl px-3 py-1.5 bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 outline-none focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                                        >
                                            {[1, 2, 3, 4].map(n => (
                                                <option key={n} value={n}>{n} TRANG / BATCH</option>
                                            ))}
                                        </select>
                                    </div>
                                    <p className="text-[10px] text-slate-500 italic leading-relaxed px-1">
                                        * 1-2 trang (Cực kỳ chính xác, tránh sót câu, khuyên dùng). 3-4 trang (Quét cực nhanh, tiết kiệm Token ban đầu nhưng dễ sót các chi tiết nhỏ).
                                    </p>
                                </div>

                                {/* Adaptive Batching */}
                                <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle 
                                        enabled={settings.adaptiveBatching !== false}
                                        onChange={val => setSettings({ ...settings, adaptiveBatching: val })}
                                        icon={<RefreshCw size={16} />}
                                        label="Adaptive Batch Sizing"
                                        description="Tự động chia nhỏ câu hỏi khi phát hiện Server quá tải. Đảm bảo tỷ lệ thành công 100%."
                                        colorClass="text-indigo-500"
                                    />
                                </div>

                                {/* Auto Group Clinical Cases */}
                                <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5">
                                    <Toggle 
                                        enabled={settings.autoGroupClinicalCases !== false}
                                        onChange={val => setSettings({ ...settings, autoGroupClinicalCases: val })}
                                        icon={<Lock size={16} />}
                                        label="Tự động gộp ca lâm sàng"
                                        description="Tự động phát hiện và gộp chung cụm câu hỏi đi kèm tình huống bệnh án hoặc bối cảnh liên kết để tránh bị cắt đôi ranh giới trang."
                                        colorClass="text-indigo-500"
                                    />
                                </div>

                                {/* API Key Health Diagnostics */}
                                {settings.provider === 'shopaikey' && (
                                    <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5 space-y-3">
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <ShieldCheck size={16} className="text-indigo-500" />
                                            Chẩn đoán sức khỏe API Key
                                        </label>
                                        <div className="space-y-2">
                                            <button
                                                type="button"
                                                onClick={handleShopAIKeyCheck}
                                                disabled={isCheckingShopAIKey || !settings.shopAIKeyKey.trim()}
                                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-black text-emerald-700 transition-all hover:bg-emerald-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
                                            >
                                                <RefreshCw size={14} className={isCheckingShopAIKey ? 'animate-spin' : ''} />
                                                {isCheckingShopAIKey ? 'ĐANG KIỂM TRA...' : 'KIỂM TRA KEY & MODEL'}
                                            </button>
                                            {shopAIKeyValidation && (
                                                <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 text-[11px] leading-relaxed animate-in zoom-in-95 ${
                                                    shopAIKeyValidation.ok
                                                        ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-300'
                                                        : 'border-amber-200 bg-amber-50/50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-300'
                                                }`}>
                                                    {shopAIKeyValidation.ok ? <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0 text-emerald-500" /> : <AlertCircle size={15} className="mt-0.5 flex-shrink-0 text-amber-500" />}
                                                    <span className="font-medium">
                                                        {shopAIKeyValidation.message}
                                                        {shopAIKeyValidation.models.length > 0 && ` Đã xác thực ${shopAIKeyValidation.models.length} model khả dụng.`}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Storage Management */}
                                <div className="pt-4 border-t border-red-100 dark:border-red-900/20 space-y-4">
                                    <div className="flex items-center gap-2 text-red-600 dark:text-red-400 text-xs font-black uppercase tracking-widest">
                                        <Database size={14} className="fill-red-500/10" />
                                        QUẢN LÝ LƯU TRỮ
                                    </div>
                                    <button
                                        onClick={handleClearAll}
                                        className="group w-full relative flex items-center justify-center gap-2 px-4 py-3.5 text-xs font-black text-white overflow-hidden rounded-2xl transition-all active:scale-95 shadow-lg shadow-red-500/20"
                                    >
                                        <div className="absolute inset-0 bg-gradient-to-r from-red-600 to-rose-600 transition-all group-hover:scale-110" />
                                        <Trash2 size={16} className="relative z-10 group-hover:rotate-12 transition-transform" /> 
                                        <span className="relative z-10">XÓA TẤT CẢ DỮ LIỆU ỨNG DỤNG</span>
                                    </button>
                                    <p className="text-[9px] text-slate-400 dark:text-slate-500 text-center leading-relaxed font-medium px-4">
                                        Hành động này sẽ xóa sạch bộ nhớ đệm, lịch sử câu hỏi và thư viện đề. <br/>
                                        <span className="text-red-400">DỮ LIỆU ĐÃ XÓA KHÔNG THỂ KHÔI PHỤC.</span>
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
