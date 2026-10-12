import { env } from 'cloudflare:workers';
import type { ApiEnv } from './api';

export function getApiEnv(): ApiEnv {
  return env as unknown as ApiEnv;
}
