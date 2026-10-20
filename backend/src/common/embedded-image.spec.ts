/**
 * A política de imagem embutida.
 *
 * O que se testa aqui é o que esta função existe para impedir: URL que o
 * servidor iria buscar, SVG que carrega script, e arquivo grande demais para
 * um carimbo de 104 pontos.
 */
import { readEmbeddedImage } from './embedded-image';

/** PNG 1×1 válido, o menor que dá para escrever à mão. */
const PNG_MINIMO =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('readEmbeddedImage', () => {
  it('aceita PNG e JPEG embutidos', () => {
    const png = readEmbeddedImage(`data:image/png;base64,${PNG_MINIMO}`);
    expect(png?.mimeType).toBe('image/png');
    expect(png?.bytes.length).toBeGreaterThan(0);

    expect(
      readEmbeddedImage(`data:image/jpeg;base64,${PNG_MINIMO}`)?.mimeType,
    ).toBe('image/jpeg');
  });

  it('recusa URL, que o servidor teria de buscar', () => {
    /* Buscar um endereço escolhido pelo inquilino é SSRF, com a rede interna
       ao alcance. */
    for (const url of [
      'https://exemplo.com/logo.png',
      'http://169.254.169.254/latest/meta-data/',
      'file:///etc/passwd',
      '//exemplo.com/logo.png',
    ]) {
      expect(readEmbeddedImage(url)).toBeNull();
    }
  });

  it('recusa SVG, que é documento e não imagem', () => {
    /* SVG carrega script e referência externa; seria conteúdo ativo dentro de
       um PDF que circula por e-mail. */
    expect(
      readEmbeddedImage('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
    ).toBeNull();
    expect(readEmbeddedImage('data:image/svg+xml,<svg onload=1 />')).toBeNull();
  });

  it('recusa o que passa do limite de tamanho', () => {
    const grande = 'A'.repeat(700_000);
    expect(readEmbeddedImage(`data:image/png;base64,${grande}`)).toBeNull();
  });

  it('recusa vazio e lixo', () => {
    for (const entrada of [
      null,
      undefined,
      '',
      'data:image/png;base64,',
      'data:image/png;base64,-- não é base64 --',
      'data:text/html;base64,PGgxPm9pPC9oMT4=',
    ]) {
      expect(readEmbeddedImage(entrada)).toBeNull();
    }
  });
});
