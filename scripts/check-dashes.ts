/**
 * Fails when a tracked text file contains an em dash (U+2014) or an en dash (U+2013). The owner's
 * rule: write a plain hyphen-minus instead. Runs as part of `pnpm lint`, so CI and the pre-commit
 * hook catch it too.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Built from code points: a formatter rewrites `\u2014` in a regex literal into the character itself.
const LONG_DASH = new RegExp(`[${String.fromCodePoint(0x2013, 0x2014)}]`);

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '');

const hits: string[] = [];
for (const file of files) {
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue; // listed but deleted in the working tree
  }
  if (text.includes('\0')) {
    continue; // binary
  }
  text.split('\n').forEach((line, index) => {
    if (LONG_DASH.test(line)) {
      hits.push(`${file}:${index + 1}: ${line.trim()}`);
    }
  });
}

if (hits.length > 0) {
  console.error(`Em or en dash found; use a plain hyphen (-) instead:\n${hits.join('\n')}`);
  process.exit(1);
}
