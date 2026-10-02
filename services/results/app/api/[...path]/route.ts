import { env } from 'cloudflare:workers';
import { handleApi, type ApiEnv } from '@/lib/api';
export const dynamic = 'force-dynamic';
function handler(request: Request) {
  return handleApi(request, env as unknown as ApiEnv);
}
export { handler as GET, handler as POST, handler as PUT };
