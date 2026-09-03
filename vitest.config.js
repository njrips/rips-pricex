import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  // tsconfig only claims .ts/.tsx, so its "react-jsx" setting never reaches the
  // .jsx components. Without this they compile against the classic runtime and
  // fail on a React global they do not import.
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: {
      'react-router-dom': 'react-router',
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['app/**/*.test.js'],
    restoreMocks: true,
  },
});
