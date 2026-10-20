import { readFileSync } from 'node:fs';

/**
 * The upload zip's file name, `Tab-Organizer-<version>.zip`. It comes from `package.json`'s
 * `displayName`, never from the built manifest: since the extension is translated the manifest's
 * `name` is the message reference `__MSG_extName__`, which would make a file called
 * `__MSG_extName__-7.14.0.zip`. `zip.ts` writes the file under this name and `store-bundle.ts`
 * looks for it under the same one.
 */
export function zipFileName(displayName: string, version: string): string {
  if (displayName.includes('__MSG_')) {
    throw new Error(`Not a display name: ${displayName}`);
  }
  return `${displayName.trim().replaceAll(/\s+/g, '-')}-${version}.zip`;
}

/** `displayName` from the `package.json` at `packageJsonPath`. */
export function readDisplayName(packageJsonPath: string): string {
  const pkg: unknown = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  const displayName =
    typeof pkg === 'object' && pkg !== null ? Reflect.get(pkg, 'displayName') : undefined;
  if (typeof displayName !== 'string' || displayName.trim() === '') {
    throw new Error(`${packageJsonPath} has no displayName`);
  }
  return displayName;
}
