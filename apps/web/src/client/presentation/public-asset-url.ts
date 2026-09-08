let overrides: Readonly<Record<string, string>> = {};
export function setPublicAssetOverrides(value: Readonly<Record<string, string>>) {
  overrides = { ...value };
}
export function publicAssetUrl(baseUrl: string, assetPath: string): string {
  if (/^data:image\/(png|jpeg);base64,/.test(assetPath)) return assetPath;
  if (overrides[assetPath]) return overrides[assetPath];
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${assetPath.replace(/^\/+/, '')}`;
}
