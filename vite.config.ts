import { defineConfig } from 'vite';

// Three pages: the home page listing the games, and one page per game. They share one script
// (src/main.ts), which reads the game from <body data-game>. The site is only served at the root
// of feltready.com (the old GitHub Pages address just forwards there), so asset paths are absolute.
export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      input: {
        home: 'index.html',
        plo: 'plo/index.html',
        bombpot: 'bombpot/index.html',
      },
    },
  },
});
