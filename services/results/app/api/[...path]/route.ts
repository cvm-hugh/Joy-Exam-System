import { getApiEnv } from '@joy-runtime-env';
import { handleApi } from '@/lib/api';
export const dynamic = 'force-dynamic';
async function handler(request: Request) {
  return handleApi(request, await getApiEnv());
}
export { handler as GET, handler as POST, handler as PUT };
