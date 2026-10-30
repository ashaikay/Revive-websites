import { mergeConfig, defineConfig } from 'vitest/config';
import viteConfig from './vite.config';
import { discoverTestFiles } from './scripts/test-files.mjs';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    include: discoverTestFiles().vitest,
    maxWorkers: 2,
  },
}));
