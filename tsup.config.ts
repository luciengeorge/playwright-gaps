import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/persistent.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: true,
  target: 'node18',
  external: ['@playwright/test'],
});
