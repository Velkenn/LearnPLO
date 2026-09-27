import { defineConfig } from 'vite';

// Relative base so the same build works at https://<user>.github.io/LearnPLO/
// and at the root of a custom domain or Cloudflare Pages.
export default defineConfig({
  base: './',
  build: { outDir: 'dist', target: 'es2022' },
});
