import React, { useState, useEffect } from 'react';
import { Settings as SettingsIcon, Trash2, ChevronDown, ChevronUp, ShieldAlert, Gauge, Zap, Database, RefreshCw, CheckCircle2, AlertCircle, Archive, Eye, ShieldCheck } from 'lucide-react';
import { userKeyRotator } from '../core/brain/retryExecutor';
import type { KeyHealthSnapshot } from '../utils/keyRotator';
import { AppSettings } from '../types';
import { db } from '../core/db';
import { toast } from 'sonner';
import { validateShopAIKeyConnection, validateGeminiKeys } from '../core/brain';
import { AIProvider, coerceModelForProvider, getModelGroups, getShopAIKeyVerifiedModelGroups } from '../utils/models';
import { ConfirmDialogOptions } from '../hooks/useConfirmDialog';
import type { ShopAIKeyValidationResult } from '../core/brain/openAiProvider';
import type { GeminiBulkValidationResult } from '../core/brain/googleProvider';

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
    const [isCheckingGeminiKeys, setIsCheckingGeminiKeys] = useState(false);
    const [geminiKeysValidation, setGeminiKeysValidation] = useState<GeminiBulkValidationResult | null>(null);
    const [keyHealthList, setKeyHealthList] = useState<KeyHealthSnapshot[]>([]);

    useEffect(() => {
        if (!show || !showAdvanced || settings.provider !== 'google') return;
        const updateHealth = () => {
            setKeyHealthList(userKeyRotator.getKeyHealthSnapshot());
        };
        updateHealth();
        const interval = setInterval(updateHealth, 1500);
        return () => clearInterval(interval);
    }, [show, showAdvanced, settings.provider]);

    const handleResetStats = async () => {
        const confirmed = await confirm({
            title: 'ĐẶT LẠI CHỈ SỐ THỐNG KÊ?',
            body: 'Hành động này sẽ đặt lại toàn bộ số đếm Request, Lỗi định dạng và Độ trễ trung bình của tất cả API Key về 0. Bạn có muốn tiếp tục?',
            confirmLabel: 'ĐỒNG Ý ĐẶT LẠI',
            cancelLabel: 'HỦY BỎ',
            variant: 'info'
        });
        if (confirmed) {
            userKeyRotator.resetHealthStats();
            await db.saveKeyHealth(userKeyRotator.exportHealthState());
            setKeyHealthList(userKeyRotator.getKeyHealthSnapshot());
            toast.success('Đã đặt lại toàn bộ thống kê API Key.');
        }
    };
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

    const handleGeminiKeysCheck = async () => {
        setIsCheckingGeminiKeys(true);
        setGeminiKeysValidation(null);
        const result = await validateGeminiKeys(settings.apiKey, settings.model);
        setGeminiKeysValidation(result);
        setIsCheckingGeminiKeys(false);

        if (result.ok) {
            toast.success(result.message);
        } else {
            toast.error(result.message, { duration: 7000 });
        }
    };

    const handleAutoCleanGeminiKeys = () => {
        if (!geminiKeysValidation) return;
        const keysToKeep = geminiKeysValidation.results
            .filter(res => res.status !== 'authBlocked') // Only filter out authentication blocked (invalid key)
            .map(res => res.keyRaw);
        
        const removedCount = geminiKeysValidation.totalChecked - keysToKeep.length;
        if (removedCount === 0) {
            toast.info("Không phát hiện key nào bị hỏng/lỗi xác thực để loại bỏ!");
            return;
        }

        const newKeysString = keysToKeep.join(', ');
        setSettings({ ...settings, apiKey: newKeysString });
        toast.success(`Đã tự động loại bỏ ${removedCount} key bị lỗi xác thực! Còn lại ${keysToKeep.length} keys.`);
        setGeminiKeysValidation(null);
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
                                    setGeminiKeysValidation(null);
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

                                {/* Real-time Live API Key Monitor Dashboard */}
                                {settings.provider === 'google' && keyHealthList.length > 0 && (
                                    <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5 space-y-4">
                                        <div className="flex items-center justify-between">
                                            <label className="text-sm font-black text-slate-700 dark:text-slate-200 flex items-center gap-2 uppercase tracking-wider text-[11px]">
                                                <Gauge size={16} className="text-indigo-500 animate-pulse" />
                                                GIÁM SÁT KEY THỜI GIAN THỰC (LIVE)
                                            </label>
                                            <button
                                                type="button"
                                                onClick={handleResetStats}
                                                className="text-[10px] font-black text-rose-500 hover:text-rose-600 dark:text-rose-400 dark:hover:text-rose-300 transition-colors uppercase tracking-wider border border-rose-200 dark:border-rose-900/30 px-2 py-1 rounded-lg bg-rose-50/50 dark:bg-rose-950/20 active:scale-[0.98]"
                                            >
                                                ĐẶT LẠI THỐNG KÊ
                                            </button>
                                        </div>

                                        {/* Premium Summary Cards */}
                                        {(() => {
                                            let totalRequests = 0;
                                            let totalSuccess = 0;
                                            let totalFailure = 0;
                                            let totalFormatError = 0;
                                            let latencies: number[] = [];
                                            keyHealthList.forEach(item => {
                                                const s = item.successCount || 0;
                                                const f = item.failureCount || 0;
                                                const fmt = item.formatErrorCount || 0;
                                                totalRequests += (s + f + fmt);
                                                totalSuccess += s;
                                                totalFailure += f;
                                                totalFormatError += fmt;
                                                if (item.averageLatencyMs && item.averageLatencyMs > 0) {
                                                    latencies.push(item.averageLatencyMs);
                                                }
                                            });
                                            const successRate = totalRequests > 0 ? Math.round((totalSuccess / totalRequests) * 100) : 0;
                                            const avgLatency = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;

                                            return (
                                                <div className="space-y-3">
                                                    <div className="grid grid-cols-3 gap-3">
                                                        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-2.5 text-center shadow-sm">
                                                            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">TỔNG REQUEST</div>
                                                            <div className="text-lg font-black text-slate-700 dark:text-slate-200 mt-0.5">{totalRequests}</div>
                                                        </div>
                                                        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-2.5 text-center shadow-sm">
                                                            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">TỶ LỆ THÀNH CÔNG</div>
                                                            <div className={`text-lg font-black mt-0.5 ${
                                                                successRate >= 90 ? 'text-emerald-500' : successRate >= 70 ? 'text-amber-500' : 'text-rose-500'
                                                            }`}>{successRate}%</div>
                                                        </div>
                                                        <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/30 p-2.5 text-center shadow-sm">
                                                            <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider">ĐỘ TRỄ AVG</div>
                                                            <div className="text-lg font-black text-indigo-500 mt-0.5">{avgLatency > 0 ? `${(avgLatency / 1000).toFixed(1)}s` : '--'}</div>
                                                        </div>
                                                    </div>

                                                    {/* Success Rate Progress Bar */}
                                                    <div className="space-y-1">
                                                        <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 dark:text-slate-500 px-0.5">
                                                            <span>CHẤT LƯỢNG TRÍCH XUẤT CỦA POOL</span>
                                                            <span className={successRate >= 90 ? 'text-emerald-500' : successRate >= 70 ? 'text-amber-500' : 'text-rose-500'}>{successRate}%</span>
                                                        </div>
                                                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden shadow-inner">
                                                            <div 
                                                                className={`h-full rounded-full transition-all duration-500 ${
                                                                    successRate >= 90 ? 'bg-emerald-500 shadow-[0_0_8px_#10b981]' : successRate >= 70 ? 'bg-amber-500 shadow-[0_0_8px_#f59e0b]' : 'bg-rose-500 shadow-[0_0_8px_#f43f5e]'
                                                                }`}
                                                                style={{ width: `${Math.max(3, successRate)}%` }}
                                                            />
                                                        </div>
                                                    </div>

                                                    {/* Key Grid Monitor */}
                                                    <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar pt-1">
                                                        {keyHealthList.map(item => {
                                                            const s = item.successCount || 0;
                                                            const f = item.failureCount || 0;
                                                            const fmt = item.formatErrorCount || 0;
                                                            const keyTotal = s + f + fmt;
                                                            const keyRate = keyTotal > 0 ? Math.round((s / keyTotal) * 100) : 0;

                                                            // Determine status colors & descriptions
                                                            let statusText = 'Khỏe mạnh';
                                                            let pulseColor = 'bg-emerald-500';
                                                            let borderColor = 'border-slate-100 dark:border-slate-800/80';
                                                            let bgClass = 'bg-white dark:bg-slate-900/20';

                                                            if (item.status === 'cooldown') {
                                                                statusText = `Hồi ${Math.ceil(item.remainingMs / 1000)}s`;
                                                                pulseColor = 'bg-amber-500';
                                                                borderColor = 'border-amber-200/60 dark:border-amber-900/30';
                                                                bgClass = 'bg-amber-50/10 dark:bg-amber-950/5';
                                                            } else if (item.status === 'quotaBlocked') {
                                                                statusText = `Hết quota ${Math.ceil(item.remainingMs / 60000)}m`;
                                                                pulseColor = 'bg-amber-600 animate-ping';
                                                                borderColor = 'border-amber-300 dark:border-amber-900/50';
                                                                bgClass = 'bg-amber-50/20 dark:bg-amber-950/10';
                                                            } else if (item.status === 'authBlocked') {
                                                                statusText = 'Lỗi Key (401)';
                                                                pulseColor = 'bg-rose-500';
                                                                borderColor = 'border-rose-300 dark:border-rose-950/50';
                                                                bgClass = 'bg-rose-50/20 dark:bg-rose-950/10';
                                                            } else if (item.status === 'suspect') {
                                                                statusText = `Nghi ngờ ${Math.ceil(item.remainingMs / 1000)}s`;
                                                                pulseColor = 'bg-orange-400';
                                                                borderColor = 'border-orange-200 dark:border-orange-950/30';
                                                                bgClass = 'bg-orange-50/10';
                                                            } else if (item.status === 'providerPressure') {
                                                                statusText = 'Áp lực 429';
                                                                pulseColor = 'bg-amber-500 animate-pulse';
                                                            }

                                                            return (
                                                                <div 
                                                                    key={item.keyNumber} 
                                                                    className={`rounded-xl border p-2.5 flex flex-col justify-between transition-all duration-300 shadow-sm hover:scale-[1.01] hover:shadow-md ${borderColor} ${bgClass}`}
                                                                >
                                                                    <div className="flex items-center justify-between gap-1">
                                                                        <span className="text-[11px] font-black text-slate-700 dark:text-slate-200">
                                                                            Key #{item.keyNumber}
                                                                        </span>
                                                                        
                                                                        <div className="flex items-center gap-1.5" title={statusText}>
                                                                            <span className="text-[9px] font-semibold text-slate-400 dark:text-slate-500 truncate max-w-[55px]">
                                                                                {statusText}
                                                                            </span>
                                                                            <span className="relative flex h-2 w-2">
                                                                                {item.status === 'healthy' && (
                                                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                                                                )}
                                                                                <span className={`relative inline-flex rounded-full h-2 w-2 ${pulseColor}`}></span>
                                                                            </span>
                                                                        </div>
                                                                    </div>

                                                                    <div className="text-[9px] font-medium text-slate-400 dark:text-slate-500 mt-1 truncate">
                                                                        {item.keyTruncated}
                                                                    </div>

                                                                    <div className="flex items-center justify-between gap-1.5 mt-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/60">
                                                                        {/* Success counters */}
                                                                        <div className="flex items-center gap-1 text-[9px] font-black text-slate-500 dark:text-slate-400">
                                                                            <span className="text-emerald-500" title="Trích xuất thành công">🟢{s}</span>
                                                                            <span className="text-rose-500" title="Lỗi API / Mạng">🔴{f}</span>
                                                                            <span className="text-amber-500" title="Lỗi định dạng trích xuất">⚠️{fmt}</span>
                                                                        </div>
                                                                        
                                                                        {/* Success rate percentage badge */}
                                                                        <span className={`px-1.5 py-0.5 rounded-full font-black text-[9px] scale-95 ${
                                                                            keyTotal === 0
                                                                                ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                                                                                : keyRate >= 90
                                                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                                                                    : keyRate >= 70
                                                                                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                                                                                        : 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                                                                        }`}>
                                                                            {keyTotal === 0 ? '--' : `${keyRate}%`}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}

                                {/* API Key Health Diagnostics */}
                                {(settings.provider === 'google' || settings.provider === 'shopaikey') && (
                                    <div className="border-t border-slate-100 dark:border-slate-800/50 pt-5 space-y-3">
                                        <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                                            <ShieldCheck size={16} className="text-indigo-500" />
                                            Chẩn đoán sức khỏe API Key
                                        </label>
                                        
                                        {settings.provider === 'google' && (
                                            <div className="space-y-2">
                                                <button
                                                    type="button"
                                                    onClick={handleGeminiKeysCheck}
                                                    disabled={isCheckingGeminiKeys || !settings.apiKey.trim()}
                                                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-xs font-black text-indigo-700 transition-all hover:bg-indigo-100 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-900/50 dark:bg-indigo-950/30 dark:text-indigo-300 dark:hover:bg-indigo-950/50"
                                                >
                                                    <RefreshCw size={14} className={isCheckingGeminiKeys ? 'animate-spin' : ''} />
                                                    {isCheckingGeminiKeys ? 'ĐANG ĐÁNH GIÁ SONG SONG...' : 'KIỂM TRA HÀNG LOẠT KEY (BULK CHECK)'}
                                                </button>
                                                {geminiKeysValidation && (
                                                    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 p-4 space-y-3 animate-in zoom-in-95 leading-relaxed text-xs">
                                                        <div className="space-y-1">
                                                            <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-200">
                                                                <CheckCircle2 size={16} className="text-indigo-500" />
                                                                <span>Kết quả: {geminiKeysValidation.healthyCount}/{geminiKeysValidation.totalChecked} Keys hoạt động</span>
                                                            </div>
                                                            <div className="text-[10px] text-slate-400 dark:text-slate-500 font-medium px-6">
                                                                * Đã thực hiện kiểm tra: 1 request/key (tổng cộng {geminiKeysValidation.totalChecked} requests song song).
                                                            </div>
                                                        </div>
                                                        <div className="max-h-36 overflow-y-auto space-y-1.5 custom-scrollbar pr-1">
                                                            {geminiKeysValidation.results.map((res) => (
                                                                <div key={res.keyIndex} className="flex justify-between items-center gap-4 py-1 border-b border-slate-100 dark:border-slate-800 last:border-0">
                                                                    <span className="font-bold text-slate-500 dark:text-slate-400">Key #{res.keyIndex} ({res.keyTruncated})</span>
                                                                    <span className={`px-2 py-0.5 rounded-full font-black text-[10px] ${
                                                                        res.ok
                                                                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                                                                            : res.status === 'authBlocked'
                                                                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'
                                                                                : res.status === 'quotaBlocked'
                                                                                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300'
                                                                                    : res.status === 'serverBusy'
                                                                                        ? 'bg-orange-100 text-orange-700 dark:bg-orange-950/30 dark:text-orange-300'
                                                                                        : 'bg-slate-100 text-slate-700 dark:bg-slate-950/30 dark:text-slate-300'
                                                                    }`}>
                                                                        {res.ok
                                                                            ? `OK (${res.latencyMs}ms)`
                                                                            : res.status === 'authBlocked'
                                                                                ? 'Lỗi Key'
                                                                                : res.status === 'quotaBlocked'
                                                                                    ? 'Hết Quota'
                                                                                    : res.status === 'serverBusy'
                                                                                        ? '503 Bận'
                                                                                        : 'Lỗi'}
                                                                    </span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                        {(() => {
                                                            const authBlockedCount = geminiKeysValidation.results.filter(res => res.status === 'authBlocked').length;
                                                            if (authBlockedCount === 0) return null;
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    onClick={handleAutoCleanGeminiKeys}
                                                                    className="group relative flex w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-xs font-black text-rose-700 transition-all hover:bg-rose-100 active:scale-[0.98] dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300 dark:hover:bg-rose-950/50 mt-2"
                                                                >
                                                                    <Trash2 size={13} className="group-hover:rotate-12 transition-transform" />
                                                                    TỰ ĐỘNG LOẠI BỎ KEY LỖI ({authBlockedCount} KEYS)
                                                                </button>
                                                            );
                                                        })()}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {settings.provider === 'shopaikey' && (
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
                                        )}
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
