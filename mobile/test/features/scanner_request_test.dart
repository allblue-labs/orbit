/// O leitor de etiqueta tem dois modos, e quem escolhe é quem chama.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/features/equipment/presentation/equipment_scanner_screen.dart';

void main() {
  test('sem pedido, o leitor se basta e mostra o resultado nele mesmo', () {
    expect(EquipmentScannerRequest.fromExtra(null).returnsToken, isFalse);
  });

  test('a tela inicial pede o token de volta', () {
    expect(
      EquipmentScannerRequest.fromExtra(
        const EquipmentScannerRequest(returnsToken: true),
      ).returnsToken,
      isTrue,
    );
  });

  test('um extra de outro tipo cai no modo padrão, não derruba a tela', () {
    /// `extra` é `Object?`: qualquer coisa cabe ali. Um leitor que abre no
    /// modo errado é recuperável; um que não abre, não.
    for (final lixo in <Object>['texto', 42, <String, String>{}]) {
      expect(
        EquipmentScannerRequest.fromExtra(lixo).returnsToken,
        isFalse,
        reason: '$lixo',
      );
    }
  });
}
