import sharp from "sharp";

/** A real image with visible ink, suitable for signature validation. */
export async function imageFixture(): Promise<Buffer> {
  return sharp(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="80"><rect width="160" height="80" fill="white"/><path d="M15 55L35 20L65 55L95 20L145 55" fill="none" stroke="#142332" stroke-width="7"/></svg>',
    ),
  )
    .png()
    .toBuffer();
}
