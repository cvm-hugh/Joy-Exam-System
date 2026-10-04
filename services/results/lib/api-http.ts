// Transport parsing and response formatting shared by the exam API.
export const REQUEST_LIMITS = { json: 250_000, multipart: 3_200_000 } as const;

export const API_RESPONSE_HEADERS = {
  'Cache-Control': 'no-store, private',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

export function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return Response.json(data, { status, headers: { ...API_RESPONSE_HEADERS, ...extra } });
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

export async function boundedRequest(request: Request) {
  if (!request.body) return request;
  const limit = request.headers
    .get('content-type')
    ?.includes('multipart/form-data')
    ? REQUEST_LIMITS.multipart
    : REQUEST_LIMITS.json;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError('请求内容超过大小限制', 413);
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Request(request.url, {
    method: request.method,
    headers: request.headers,
    body: bytes,
  });
}

export async function body(request: Request) {
  if (!request.headers.get('content-type')?.includes('application/json'))
    throw new ApiError('请求必须为JSON', 415);
  const text = await request.text();
  if (text.length > REQUEST_LIMITS.json) throw new ApiError('请求内容过大', 413);
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('JSON格式错误');
  }
}

export function validImage(bytes: Uint8Array) {
  if (
    bytes.length >= 8 &&
    bytes[0] === 137 &&
    bytes[1] === 80 &&
    bytes[2] === 78 &&
    bytes[3] === 71 &&
    bytes[4] === 13 &&
    bytes[5] === 10 &&
    bytes[6] === 26 &&
    bytes[7] === 10
  )
    return { ext: 'png', type: 'image/png' };
  if (
    bytes.length >= 4 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return { ext: 'jpg', type: 'image/jpeg' };
  if (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  )
    return { ext: 'webp', type: 'image/webp' };
  return null;
}
