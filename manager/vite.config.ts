import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { feedApi } from './server/feedApi.js';

const managerDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = process.env.REPO_ROOT
  ? path.resolve(process.env.REPO_ROOT)
  : path.resolve(managerDir, '..');
const feedPath = process.env.FEED_PATH
  ? path.resolve(process.env.FEED_PATH)
  : path.join(repoRoot, 'feed.json');

export default defineConfig({
  plugins: [react(), feedApi({ repoRoot, feedPath })],
  server: {
    port: 4318,
    open: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
