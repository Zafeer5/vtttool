import type { NextConfig } from "next";

const serverTraceExcludes = [
  './output/**/*',
  './build/**/*',
  './dist/**/*',
  './.venv/**/*',
  './tests/**/*',
  './__pycache__/**/*',
  './src/**/*',
  './scripts/**/*',
  './launcher/**/*',
  './vtt_slideshow_generator.py',
  './VttSlideshowGenerator.exe',
  './VttSlideshowGenerator.spec',
  './VttSlideSyncStudio.exe',
  './launcher.log',
  './AGENTS.md',
  './CLAUDE.md',
  './README.md',
  './eslint.config.mjs',
  './next.config.ts',
  './package-lock.json',
  './postcss.config.mjs',
  './tsconfig.json',
  './tsconfig.tsbuildinfo',
];

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '/api/align': serverTraceExcludes,
    '/api/browse-folder': serverTraceExcludes,
    '/api/render': serverTraceExcludes,
    '/api/render/[id]': serverTraceExcludes,
    '/api/renders': serverTraceExcludes,
    '/api/renders/[id]': serverTraceExcludes,
    '/api/renders/[id]/thumb': serverTraceExcludes,
    '/api/transcribe': serverTraceExcludes,
  },
  experimental: {
    serverActions: {
      bodySizeLimit: '300mb',
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Cross-Origin-Opener-Policy",
            value: "same-origin",
          },
          {
            key: "Cross-Origin-Embedder-Policy",
            value: "require-corp",
          },
          {
            key: "Cross-Origin-Resource-Policy",
            value: "cross-origin",
          },
          {
            key: "Access-Control-Allow-Origin",
            value: "*",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
