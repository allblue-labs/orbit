import { PNG } from 'pngjs';

/** Decodable RGBA image, with visible ink and reproducible distinct revisions. */
export function imageFixture(seed = 'orbit'): Buffer {
  const png = new PNG({ width: 160, height: 80 });
  png.data.fill(255);
  const offset = [...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 25;
  for (let x = 15; x < 145; x++) {
    const y = 20 + ((x + offset) % 35);
    for (let dy = 0; dy < 7; dy++) {
      const index = ((y + dy) * png.width + x) * 4;
      png.data[index] = 20;
      png.data[index + 1] = 35;
      png.data[index + 2] = 50;
    }
  }
  return PNG.sync.write(png);
}
