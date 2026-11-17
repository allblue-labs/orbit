import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { EmailInlineImage } from './email.types';

let images: readonly EmailInlineImage[] | undefined;

/** Bundled, cached PNGs. CID images need neither CDN access nor tracking URLs. */
export function emailBrandImages(): readonly EmailInlineImage[] {
  return (images ??= ['allblue-logo', 'orbit-logo'].map((name) => ({
    contentId: `${name}@orbit`,
    fileName: `${name}.png`,
    contentType: 'image/png',
    content: readFileSync(
      resolve(process.cwd(), 'assets/email', `${name}.png`),
    ),
  })));
}
