import { previewContentType } from './preview-content-type';

describe('tipo da pré-visualização no storage local', () => {
  it('reconhece PDF e imagem pelos bytes', () => {
    expect(previewContentType(Buffer.from('%PDF-1.7\n...'))).toBe(
      'application/pdf',
    );
    expect(
      previewContentType(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]),
      ),
    ).toBe('image/png');
  });

  it('HTML e o resto continuam sem tipo executável', () => {
    expect(
      previewContentType(Buffer.from('<html><script>alert(1)</script>')),
    ).toBe('application/octet-stream');
    expect(previewContentType(Buffer.from(''))).toBe(
      'application/octet-stream',
    );
  });
});
