import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build --mode single` produces one self-contained dist/index.html (assets inlined),
// handy for sharing the preview as a single file.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { assetsInlineLimit: mode === 'single' ? 100_000_000 : 4096 },
}));
