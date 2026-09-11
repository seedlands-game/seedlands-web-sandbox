export const FLASH_MODEL = 'deepseek-v4-flash-vision-exp';
export const PRO_MODEL = 'deepseek-v4-pro';
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

export type SecretEnvironment = Readonly<Record<string, string | undefined>>;

export type DeepSeekEndpointConfig = Readonly<{
  apiKey: string;
  baseUrl: string;
  keySource: 'DEEPSEEK_API_KEY' | 'MIDSCENE_MODEL_API_KEY';
}>;

const text = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

function safeHttpsBaseUrl(raw: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash)
    throw new Error(`${field} must be an HTTPS origin or base path without credentials, query, or fragment`);
  return parsed.toString().replace(/\/$/, '');
}

/** Resolve credentials without reading dotenv files and without exposing secret values. */
export function resolveDeepSeekEndpoint(environment: SecretEnvironment): DeepSeekEndpointConfig | null {
  const directKey = text(environment.DEEPSEEK_API_KEY);
  if (directKey) {
    return {
      apiKey: directKey,
      baseUrl: safeHttpsBaseUrl(text(environment.DEEPSEEK_BASE_URL) ?? DEFAULT_DEEPSEEK_BASE_URL, 'DEEPSEEK_BASE_URL'),
      keySource: 'DEEPSEEK_API_KEY',
    };
  }

  const fallbackKey = text(environment.MIDSCENE_MODEL_API_KEY);
  if (!fallbackKey) return null;
  const fallbackUrl = text(environment.MIDSCENE_MODEL_BASE_URL);
  if (!fallbackUrl) throw new Error('MIDSCENE_MODEL_BASE_URL is required when reusing MIDSCENE_MODEL_API_KEY');
  return {
    apiKey: fallbackKey,
    baseUrl: safeHttpsBaseUrl(fallbackUrl, 'MIDSCENE_MODEL_BASE_URL'),
    keySource: 'MIDSCENE_MODEL_API_KEY',
  };
}

export function redactSecrets(value: string, secrets: readonly (string | undefined)[]): string {
  let redacted = value;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) redacted = redacted.split(secret).join('[REDACTED]');
  }
  return redacted;
}
