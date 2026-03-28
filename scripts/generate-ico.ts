import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SVG_PATH = path.join(ROOT, 'public', 'img', 'logo.svg');
const ICO_PATH = path.join(ROOT, 'public', 'img', 'logo.ico');

const sizes = [16, 32, 48, 64, 128, 256];

async function main(): Promise<void> {
  // Convert SVG to PNGs at various sizes using sips via a temp PNG
  const tmpDir = execSync('mktemp -d', { encoding: 'utf-8' }).trim();

  // First convert SVG to a large PNG using qlmanage (macOS built-in)
  const largePng = path.join(tmpDir, 'large.png');
  execSync(
    `qlmanage -t -s 256 -o "${tmpDir}" "${SVG_PATH}" 2>/dev/null && mv "${tmpDir}/logo.svg.png" "${largePng}"`,
  );

  // Resize to each target size
  const pngPaths: string[] = [];
  for (const size of sizes) {
    const pngPath = path.join(tmpDir, `icon-${size}.png`);
    execSync(`sips -z ${size} ${size} "${largePng}" --out "${pngPath}" 2>/dev/null`);
    pngPaths.push(pngPath);
  }

  // Build ICO file manually (ICO format spec)
  const images = pngPaths.map((p) => readFileSync(p));
  const ico = buildIco(images, sizes);
  writeFileSync(ICO_PATH, ico);

  // Cleanup
  execSync(`rm -rf "${tmpDir}"`);

  console.log(`Generated: ${ICO_PATH} (${ico.length} bytes)`);
  console.log(`  Sizes: ${sizes.map((s) => `${s}x${s}`).join(', ')}`);
}

function buildIco(images: Buffer[], sizes: number[]): Buffer {
  const headerSize = 6;
  const entrySize = 16;
  const dataOffset = headerSize + entrySize * images.length;

  // ICO header: reserved(2) + type(2) + count(2)
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = ICO
  header.writeUInt16LE(images.length, 4);

  // Directory entries
  const entries = Buffer.alloc(entrySize * images.length);
  let offset = dataOffset;

  for (let i = 0; i < images.length; i++) {
    const size = sizes[i] >= 256 ? 0 : sizes[i]; // 0 means 256
    const pos = i * entrySize;
    entries.writeUInt8(size, pos); // width
    entries.writeUInt8(size, pos + 1); // height
    entries.writeUInt8(0, pos + 2); // color palette
    entries.writeUInt8(0, pos + 3); // reserved
    entries.writeUInt16LE(1, pos + 4); // color planes
    entries.writeUInt16LE(32, pos + 6); // bits per pixel
    entries.writeUInt32LE(images[i].length, pos + 8); // image size
    entries.writeUInt32LE(offset, pos + 12); // image offset
    offset += images[i].length;
  }

  return Buffer.concat([header, entries, ...images]);
}

main();
