import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { EquipmentQrRenderer } from './equipment-qr.renderer';

jest.setTimeout(30_000);

describe('EquipmentQrRenderer', () => {
  const renderer = new EquipmentQrRenderer();
  const input = {
    url: 'https://orbit.example/q/J-lPksxO7KEn-uRHsMEgzVguRU3IUqYkZSjCRHcJgbA',
    code: 'EQ-000123',
    name: 'Evaporadora laboratório',
    preset: 'STANDARD' as const,
  };

  it('renders a PNG whose QR decodes to the exact neutral URL', async () => {
    const rendered = await renderer.render(input, 'png');
    const png = PNG.sync.read(rendered.bytes);
    const decoded = jsQR(
      new Uint8ClampedArray(png.data),
      png.width,
      png.height,
    );
    expect(decoded?.data).toBe(input.url);
  });

  it('renders safe SVG and printable PDF labels with the human code', async () => {
    const svg = await renderer.render(input, 'svg');
    expect(svg.bytes.toString()).toContain('EQ-000123');
    expect(svg.bytes.toString()).not.toContain('<script');
    const pdf = await renderer.render(input, 'pdf');
    expect(pdf.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
