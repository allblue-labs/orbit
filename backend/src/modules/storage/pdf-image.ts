import sharp from 'sharp';
/** PDFKit only embeds JPEG/PNG. Convert a temporary copy; never change the stored bytes or their hash. */
export async function pdfImage(
  bytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  return mimeType === 'image/webp' || mimeType === 'image/heic'
    ? {
        bytes: await sharp(bytes, { limitInputPixels: 40_000_000 })
          .png()
          .toBuffer(),
        mimeType: 'image/png',
      }
    : { bytes, mimeType };
}
