import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // The shared workspace package ships TypeScript sources: bundle it.
  noExternal: ['@app/shared'],
});
