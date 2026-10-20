// Builds the interactive page into one self-contained dist-player/player.html (script, styles, font and logo inline).
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
execFileSync(process.execPath, [join(root, 'node_modules/vite/bin/vite.js'), 'build', '--config', 'vite.player.config.js'],
  { cwd: root, stdio: 'inherit' });

const out = join(root, 'dist-player');
let html = readFileSync(join(out, 'player.html'), 'utf8');
const inline = file => readFileSync(join(out, file), 'utf8');
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"[^>]*>/g, (_, file) => `<style>${inline(file)}</style>`);
// a function replacer: the script text must not be read for $-patterns, and </script> must not end the tag early
html = html.replace(/<script type="module"[^>]*src="\.\/([^"]+)"[^>]*><\/script>/g,
  (_, file) => `<script type="module">${inline(file).replace(/<\/script/gi, '<\\/script')}</script>`);
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('player.html still points at a separate file');
writeFileSync(join(out, 'player.html'), html);
rmSync(join(out, 'assets'), { recursive: true, force: true });
console.log(`dist-player/player.html  ${(html.length / 1024).toFixed(0)} kB`);
