import type { NextConfig } from 'next';

const nextConfig: NextConfig = process.env.JOY_RESULTS_TARGET === 'node'
  ? { output: 'standalone', serverExternalPackages: ['exceljs'] }
  : {};

export default nextConfig;
