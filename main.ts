// Package Kestrel Yard using only Node's built-in APIs.
import { cpSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repository = fileURLToPath(new URL('.', import.meta.url));
const destination = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');
const limits = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
};

function contains(parent: string, child: string): boolean {
  const suffix = relative(parent, child);
  return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`));
}

function sourceDirectory(name: string): string {
  const directory = join(repository, name);
  const info = lstatSync(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`The ${name} source must be a regular directory`);
  }
  if (contains(directory, destination) || contains(join(destination, name), directory)) {
    throw new Error(`The output directory overlaps the ${name} source`);
  }
  return directory;
}

const inputs = ['game', 'screenshots'].map((name) => ({
  name,
  source: sourceDirectory(name),
  target: join(destination, name),
}));

// Validate before copying so malformed evidence cannot become a dossier.
buildDossier(repository, limits);
mkdirSync(destination, { recursive: true });
for (const { source, target } of inputs) {
  cpSync(source, target, { recursive: true });
}
const publishedDossier = buildDossier(destination, limits);
writeFileSync(join(destination, 'dossier.json'), publishedDossier);
