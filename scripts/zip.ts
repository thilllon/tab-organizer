import { createWriteStream, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
// archiver 8 is ESM and exports the archive classes by name; there is no callable default.
import { ZipArchive } from 'archiver';

/*
 * Entry point
 */

async function main(): Promise<void> {
  const manifest: Manifest = JSON.parse(readFileSync('./dist/manifest.json', 'utf-8'));
  const name = manifest.name.replaceAll(' ', '-');
  const filename = `${name}-${manifest.version}.zip`;

  mkdirSync('package', { recursive: true });

  const output = createWriteStream(path.join('package', filename));
  const archive = new ZipArchive({ zlib: { level: 9 } });

  // `finalize()` resolves once the archive is written, but the file is only complete when the
  // write stream closes — wait for that before reporting the size (and before the process exits).
  const closed = new Promise<void>((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
  });

  archive.on('error', (err: Error) => {
    throw err;
  });

  archive.pipe(output);
  archive.directory('dist/', false);
  await archive.finalize();
  await closed;

  console.log(`Packaged: package/${filename} (${archive.pointer()} bytes)`);
}

/*
 * Types
 */

interface Manifest {
  name: string;
  version: string;
}

void main();
