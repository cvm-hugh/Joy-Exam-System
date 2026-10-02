export class RequestError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  method = 'GET',
  payload?: unknown,
): Promise<T> {
  const multipart = payload instanceof FormData;
  const response = await fetch(`/api/admin/${path}`, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'x-exam-request': '1',
      ...(!multipart && payload !== undefined
        ? { 'Content-Type': 'application/json' }
        : {}),
    },
    ...(method !== 'GET' && payload !== undefined
      ? { body: multipart ? payload : JSON.stringify(payload) }
      : {}),
  });
  const result = (await response.json()) as T & {
    error?: string;
    issues?: string[];
  };
  if (!response.ok)
    throw new RequestError(
      [result.error, ...(result.issues ?? [])].join('\n'),
      response.status,
    );
  return result;
}
