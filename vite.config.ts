import { defineConfig } from 'vite';

// The home page listing the games, one page per game, and the instructor view (/teach/). The game
// pages share one script (src/main.ts), which reads the game from <body data-game>. The site is only served at the root
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
        teach: 'teach/index.html',
      },
    },
  },
});
