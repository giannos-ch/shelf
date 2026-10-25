import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  root: 'ui',
  base: '/',
  publicDir: false,
  plugins: [svelte()],
  build: { outDir: '../public', emptyOutDir: true },
});
