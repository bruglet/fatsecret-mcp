import type { ZodTypeAny } from 'zod';
import { normalizeResponse, FatSecretApiError } from './api-response.js';

export function text(data: unknown) {
  const outputData = normalizeResponse(data) ?? null;
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(outputData, null, 2) }],
    structuredContent: { data: outputData },
  };
}

export function apiText(data: unknown, schema: Pick<ZodTypeAny, 'safeParse'>) {
  const output = text(data);
  if (data == null || !schema.safeParse(output.structuredContent).success) {
    throw new FatSecretApiError('INVALID_RESPONSE', 'The API response does not match the expected fields. For writes, read the diary before retrying.');
  }
  if (data && typeof data === 'object' && 'success' in data && String((data as { success: { value?: unknown } }).success?.value) !== '1') {
    throw new FatSecretApiError('WRITE_REJECTED', 'FatSecret did not report success. Read the affected records before retrying.');
  }
  if (typeof data === 'object' && 'error' in data) {
    const code = (data as { error: { code: string | number } }).error.code;
    return { ...text({ error: { code, message: new FatSecretApiError(code).message } }), isError: true };
  }
  return output;
}
