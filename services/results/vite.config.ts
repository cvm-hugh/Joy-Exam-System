import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type PluginOption } from 'vite';
import { fileURLToPath } from 'node:url';
import hostingConfig from './.openai/hosting.json' with { type: 'json' };

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

const { d1, r2 } = hostingConfig;
const isLocalNode = process.env.JOY_RESULTS_TARGET === 'node';

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  // Keep local packaged runs compatible with the workerd binary pinned by
  // this project's lockfile. Revisit this date when dependencies are updated.
  compatibility_date: '2026-08-08',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  const plugins: PluginOption[] = [vinext()];
  if (!isLocalNode) {
    // Wrangler snapshots its log path while the Cloudflare plugin is imported.
    process.env.WRANGLER_WRITE_LOGS ??= 'false';
    process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
    process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';
    const { sites } = await import('@openai/sites-vite-plugin');
    const { cloudflare } = await import('@cloudflare/vite-plugin');
    plugins.push(sites(), cloudflare({
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
      config: localBindingConfig,
    }));
  }

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    resolve: {
      alias: {
        '@joy-runtime-env': fileURLToPath(new URL(
          isLocalNode ? './lib/runtime-env.node.ts' : './lib/runtime-env.ts',
          import.meta.url,
        )),
      },
    },
    server: {
      host: '127.0.0.1',
      fs: {
        strict: true,
        allow: [process.cwd()],
        deny: [
          '.env',
          '.env.*',
          '.dev.vars',
          '.dev.vars.*',
          '**/.local/**',
          '**/.wrangler/**',
          '**/.git/**',
          '**/*.pem',
        ],
      },
      ...(isCodexSeatbeltSandbox
        ? { watch: { useFsEvents: false, usePolling: true } }
        : {}),
    },
    plugins,
  };
});
