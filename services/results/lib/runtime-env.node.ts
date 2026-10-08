import { getNodeEnvironment } from '../local-runtime/node-environment.mjs';
import type { ApiEnv } from './api';

export async function getApiEnv(): Promise<ApiEnv> {
  return (await getNodeEnvironment()) as unknown as ApiEnv;
}
