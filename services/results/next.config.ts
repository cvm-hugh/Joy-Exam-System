import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.JOY_RESULTS_TARGET === 'node'
  ? { output: 'standalone' }
  : {};

export default nextConfig;
