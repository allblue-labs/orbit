/** Run from any directory: node backend/scripts/prepare-email-branding.cjs.
 * Derived faithfully from the repository's original logos; no remote assets.
 * Committed PNGs travel with the existing Docker assets directory.
 */
const sharp = require('sharp');
const path = require('node:path');
const { mkdir } = require('node:fs/promises');
(async () => {
  const root = path.resolve(__dirname, '../..');
  const output = path.join(root, 'backend/assets/email');
  await mkdir(output, { recursive: true });
  await sharp(path.join(root, 'allblue-logo.png'))
    .trim({ threshold: 10 })
    .resize(160, 160, { fit: 'contain', background: '#00000000' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, 'allblue-logo.png'));
  await sharp(path.join(root, 'orbit_logo.png'))
    .trim({ threshold: 10 })
    .resize({ width: 480, withoutEnlargement: true })
    .png({ compressionLevel: 9 })
    .toFile(path.join(output, 'orbit-logo.png'));
})().catch(() => {
  console.error('EMAIL_BRANDING_PREPARATION_FAILED');
  process.exitCode = 1;
});
