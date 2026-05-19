import { UploadedFile } from "../../types";
import { db } from '../db';
import {
  getFileTextContent,
  hashFiles,
} from './batching';

interface ContextCacheOptions {
  allowCreate?: boolean;
}

// Session-level flag: Khi 1 key fail caching (Free Tier / 429 / 403), tất cả key khác
// trong cùng session rất có thể cũng là Free Tier -> skip luôn để tiết kiệm thời gian.
let cachingDisabledForSession = false;
let cachingFailureCount = 0;
const CACHING_FAIL_THRESHOLD = 2; // Sau 2 lần fail liên tiếp -> disable cho cả session

export const resetContextCacheSession = (): void => {
  cachingDisabledForSession = false;
  cachingFailureCount = 0;
};

// Helper: Hash for API Key identification (to scope caches per project/key)
export const hashApiKey = (key: string): string => {
  if (!key) return "no-key";
  return key.substring(0, 8) + key.substring(key.length - 8); // Simple suffix/prefix hash
};

export const getOrSetContextCache = async (
  ai: any,
  files: UploadedFile[],
  modelName: string,
  systemInstruction: string,
  apiKey: string,
  options: ContextCacheOptions = {}
): Promise<string | null> => {
  if (!modelName.startsWith('gemini-')) {
    return null;
  }

  // Fast-skip: Nếu session đã xác nhận Free Tier, không thử caching nữa
  if (cachingDisabledForSession) {
    return null;
  }

  try {
    const fileHash = await hashFiles(files);
    const keyHash = hashApiKey(apiKey);
    const instrHash = systemInstruction.length.toString(); // Simple length-based check to trigger refresh
    const cacheId = `${fileHash}_${modelName}_${keyHash}_${instrHash}`;
    const existing = await db.getCache(cacheId);

    // If existing and not expired, return it
    if (existing && existing.expiresAt > Date.now()) {
      console.log(`🎯 Cache Hit (Key: ${keyHash}): ${existing.cacheName}`);
      cachingFailureCount = 0; // Reset failure count on success
      return existing.cacheName;
    }

    if (options.allowCreate === false) {
      console.log('🛡️ RPM guard enabled; skipping new Context Cache creation to avoid hidden Google requests.');
      return null;
    }

    // Prepare contents for caching
    const parts: any[] = files.map(file => {
      if (file.type === 'application/pdf' || file.type.startsWith('image/')) {
        return { inlineData: { mimeType: file.type, data: file.content.includes(',') ? file.content.split(',')[1] : file.content } };
      }
      return { text: `FILE: ${file.name}\n${getFileTextContent(file)}\n` };
    });

    // Estimate tokens (rough estimate: 4 chars per token)
    const estimatedTokens = parts.reduce((acc, p) => acc + (p.text?.length || p.inlineData?.data?.length || 0), 0) / 4;

    // Google requires minimum ~2048 tokens for explicit caching in many models
    if (estimatedTokens < 2000) {
      console.log("⚡ Document too small for explicit caching (< 2000 estimated tokens). Using standard request.");
      return null;
    }

    console.log(`💎 Creating new Context Cache for ${modelName}...`);
    const ttlSeconds = 7200; // 2 hours
    const cache = await ai.caches.create({
      model: modelName,
      config: {
        contents: [{ role: 'user', parts }],
        systemInstruction,
        ttl: `${ttlSeconds}s`,
      },
    });

    const expiresAt = Date.now() + (ttlSeconds * 1000);
    await db.saveCache({
      id: cacheId,
      cacheName: cache.name,
      expiresAt,
      modelName
    });

    console.log(`✅ Cache Created: ${cache.name}`);
    cachingFailureCount = 0; // Reset on success
    return cache.name;
  } catch (err: any) {
    const msg = err.message?.toLowerCase() || "";
    cachingFailureCount++;

    const isFreeTierError = msg.includes("limit exceeded") || msg.includes("429") || msg.includes("resource exhausted");
    const isPermissionError = msg.includes("403") || msg.includes("permission denied") || msg.includes("suspended");

    if (isFreeTierError || isPermissionError) {
      console.log(`ℹ️ Context Caching failed (${isPermissionError ? '403/Suspended' : 'Free Tier/429'}). Failure count: ${cachingFailureCount}/${CACHING_FAIL_THRESHOLD}`);
      if (cachingFailureCount >= CACHING_FAIL_THRESHOLD) {
        cachingDisabledForSession = true;
        console.log(`🚫 Context Caching DISABLED for this session (${cachingFailureCount} consecutive failures). All keys appear to be Free Tier. Skipping caching for remaining batches.`);
      }
    } else {
      console.warn("⚠️ Context Caching failed:", err);
    }
    return null;
  }
};
