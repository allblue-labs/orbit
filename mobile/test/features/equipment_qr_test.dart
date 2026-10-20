/// A leitura da etiqueta de equipamento.
///
/// O token é chave de busca, e o que a câmera lê pode ser qualquer coisa. O
/// que estes testes cobram é que só um token de verdade vire requisição.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/features/equipment/data/equipment_qr_repository.dart';

/// 43 caracteres base64url — o formato que o servidor aceita.
const token = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_abcde';

void main() {
  test('o token tem o comprimento que o backend exige', () {
    expect(token.length, 43);
  });

  test('a etiqueta carrega uma URL, e o token é o último segmento', () {
    expect(equipmentQrToken('https://app.orbit.local/q/$token'), token);
    expect(equipmentQrToken('http://localhost:3000/q/$token'), token);
  });

  test('o token puro também vale', () {
    expect(equipmentQrToken(token), token);
    expect(equipmentQrToken('  $token  '), token);
  });

  test('parâmetro depois do token não atrapalha', () {
    expect(equipmentQrToken('https://app.orbit.local/q/$token?src=nfc'), token);
  });

  test('QR de outra coisa não vira requisição', () {
    expect(equipmentQrToken('https://exemplo.com/produto/1234'), isNull);
    expect(equipmentQrToken('WIFI:S:rede;T:WPA;P:senha;;'), isNull);
    expect(equipmentQrToken(''), isNull);
  });

  test('um trecho de 43 caracteres recortado do meio não é token', () {
    /// 60 caracteres contínuos contêm 43 caracteres válidos em qualquer
    /// posição. Sem exigir que o casamento seja o segmento inteiro, qualquer
    /// texto longo viraria uma consulta ao servidor.
    final longo = 'a' * 60;
    expect(equipmentQrToken(longo), isNull);
  });

  test('um token curto ou longo demais é recusado', () {
    expect(equipmentQrToken('a' * 42), isNull);
    expect(equipmentQrToken('https://app.orbit.local/q/${'a' * 44}'), isNull);
  });
}
