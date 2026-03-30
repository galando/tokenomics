import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/analyze.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node18',
  clean: true,
  minify: false,
  sourcemap: true,
  dts: false, // CLI tool, not a library — skip .dts generation
  shebang: true,
  external: [],
  noExternal: [],
});
