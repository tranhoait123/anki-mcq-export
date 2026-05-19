export const DEFAULT_GOOGLE_RPM_LIMIT = 14;
export const MIN_GOOGLE_RPM_LIMIT = 1;
export const MAX_GOOGLE_RPM_LIMIT = 600;
export const GOOGLE_RPM_PRESETS = [14, 30, 60, 120] as const;

export const normalizeGoogleRpmLimit = (value: unknown): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return DEFAULT_GOOGLE_RPM_LIMIT;
  return Math.min(
    MAX_GOOGLE_RPM_LIMIT,
    Math.max(MIN_GOOGLE_RPM_LIMIT, Math.round(numericValue))
  );
};
