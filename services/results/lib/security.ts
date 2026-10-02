import { Store } from './store';
const encoder = new TextEncoder();
export async function digest(value: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(value)),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
}
export function constantEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
export async function verifyPassword(password: string, credential: string) {
  const [salt, expected] = credential.split(':');
  if (!salt || !expected) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: encoder.encode(salt),
      iterations: 100000,
    },
    key,
    256,
  );
  const actual = Array.from(new Uint8Array(bits), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
  return constantEqual(actual, expected);
}
export function sessionToken(request: Request) {
  return (
    request.headers
      .get('cookie')
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('exam_session='))
      ?.slice(13) ?? ''
  );
}
export async function authenticated(request: Request, store: Store) {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  return !!(await store.db
    .prepare(
      'SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?',
    )
    .bind(await digest(token), Date.now())
    .first());
}
export function cookie(value: string, url: string, maxAge = 28800) {
  return `exam_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${new URL(url).protocol === 'https:' ? '; Secure' : ''}`;
}
export function csrfValid(request: Request) {
  const origin = request.headers.get('origin');
  return (
    request.headers.get('x-exam-request') === '1' &&
    (!origin || origin === new URL(request.url).origin)
  );
}
