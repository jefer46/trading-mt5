// Bundle src/ -> dist/ (folder inilah yang di-load ke Chrome)
import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
for (const f of ['popup.html', 'popup.css', 'manifest.json']) cpSync(`src/${f}`, `dist/${f}`);
cpSync('icons', 'dist/icons', { recursive: true });

const options = {
  entryPoints: {
    popup: 'src/popup.js',
    background: 'src/background.js',
    content: 'src/content.js',
    inpage: 'src/inpage.js',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  platform: 'browser',
  target: 'chrome111',
  minify: !watch,
  sourcemap: watch,
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
