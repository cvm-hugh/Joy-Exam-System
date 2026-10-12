declare module '@joy-runtime-env' {
  import type { ApiEnv } from '@/lib/api';
  export function getApiEnv(): ApiEnv | Promise<ApiEnv>;
}
