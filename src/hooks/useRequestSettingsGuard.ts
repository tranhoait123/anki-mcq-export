import React from 'react';
import { toast } from 'sonner';
import { AppSettings, UploadedFile } from '../types';
import { coerceModelForProviderInput } from '../utils/models';

interface UseRequestSettingsGuardParams {
  files: UploadedFile[];
  settings: AppSettings;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings>>;
}

export const useRequestSettingsGuard = ({
  files,
  settings,
  setSettings,
}: UseRequestSettingsGuardParams) => {
  const currentFilesRequireVision = () => files.some(file => file.type === 'application/pdf' || file.type.startsWith('image/'));
  const getVisionRecommendedDocx = () => files.find(file => file.docxMode === 'visionRecommended');
  const getDetectedDocxMcqCount = () => files.reduce((total, file) => total + (file.nativeMcqCount || file.structuredMcqCount || 0), 0);

  const warnVisionRecommendedDocx = () => {
    const file = getVisionRecommendedDocx();
    if (!file) return false;
    toast.error(`DOCX "${file.name}" gần như không có text thật. Hãy xuất Word sang PDF hoặc ảnh rõ rồi tải lại để quét Vision.`, {
      duration: 7000,
    });
    return true;
  };

  const getRequestSettings = (requiresVision: boolean = false) => {
    const coercedModel = coerceModelForProviderInput(settings.provider, settings.model, requiresVision);
    if (coercedModel !== settings.model) {
      const nextSettings = { ...settings, model: coercedModel };
      setSettings(nextSettings);
      toast.info(requiresVision
        ? "Đã tự đổi sang model hỗ trợ ảnh/PDF để tránh lỗi quét."
        : "Đã tự đổi model cho khớp provider hiện tại để tránh lỗi endpoint.");
      return nextSettings;
    }
    return settings;
  };

  const validateProviderCredentials = (requestSettings: AppSettings) => {
    if (requestSettings.provider === 'google' && !requestSettings.apiKey?.trim()) {
      toast.error("🔑 Vui lòng nhập Google API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return false;
    }
    if (requestSettings.provider === 'shopaikey' && !requestSettings.shopAIKeyKey?.trim()) {
      toast.error("🔑 Vui lòng nhập ShopAIKey API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return false;
    }
    if (requestSettings.provider === 'openrouter' && !requestSettings.openRouterKey?.trim()) {
      toast.error("🔑 Vui lòng nhập OpenRouter API Key trong phần Cài đặt (⚙️) để bắt đầu.");
      return false;
    }
    if (requestSettings.provider === 'vertexai' && (!requestSettings.vertexProjectId?.trim() || !requestSettings.vertexLocation?.trim() || !requestSettings.vertexAccessToken?.trim())) {
      toast.error("🔗 Vui lòng nhập đủ Project ID, Location và Token của Vertex AI trong (⚙️).");
      return false;
    }
    return true;
  };

  return {
    currentFilesRequireVision,
    getDetectedDocxMcqCount,
    getRequestSettings,
    validateProviderCredentials,
    warnVisionRecommendedDocx,
  };
};
