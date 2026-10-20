/// Quando o avatar desenha a foto, e quando cai nas iniciais.
///
/// ## O defeito
///
/// A condição era `scheme == 'https'`. Em desenvolvimento a API atende em
/// `http`, então a foto — gravada, vinculada e assinada corretamente — caía nas
/// iniciais sem dizer nada. Foi o último elo de "a imagem não é inserida": ela
/// estava inserida; o widget é que não a mostrava.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/design/orbit_operational.dart';

void main() {
  test('https desenha', () {
    expect(
      desenhavelComoImagemDeRede(Uri.parse('https://api.exemplo.com/foto.png')),
      isTrue,
    );
  });

  test('http desenha — é o que a API serve em desenvolvimento', () {
    expect(
      desenhavelComoImagemDeRede(
        Uri.parse('http://10.0.2.2:6001/api/v1/storage/objects?signature=abc'),
      ),
      isTrue,
    );
  });

  test('sem host não desenha', () {
    /* `Image.network` falharia e chamaria o `errorBuilder`; recusar antes
       evita o pisca-e-some. */
    expect(desenhavelComoImagemDeRede(Uri.parse('http://')), isFalse);
  });

  test('caminho relativo não desenha', () {
    expect(desenhavelComoImagemDeRede(Uri.parse('/api/v1/foto.png')), isFalse);
  });

  test('data: não desenha', () {
    expect(
      desenhavelComoImagemDeRede(Uri.parse('data:image/png;base64,AAAA')),
      isFalse,
    );
  });

  test('nulo não desenha', () {
    expect(desenhavelComoImagemDeRede(null), isFalse);
  });
}
