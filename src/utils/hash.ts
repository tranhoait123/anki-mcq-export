const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('');

export const hashStringSha256 = async (value: string): Promise<string> => {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.subtle) {
    let hash = 0;
    for (let index = 0; index < value.length; index++) {
      hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
    }
    return `fallback-${value.length}-${Math.abs(hash).toString(16)}`;
  }

  const bytes = new TextEncoder().encode(value);
  const hashBuffer = await cryptoApi.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hashBuffer));
};
