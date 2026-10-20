/// O rascunho de orçamento, antes de virar orçamento.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/features/customers/data/customer_write_repository.dart';

void main() {
  test('o total de uma linha é quantidade vezes preço', () {
    const linha = QuoteLine(
      description: 'Compressor scroll 5TR',
      quantity: 2,
      unitPrice: 1850.50,
    );
    expect(linha.total, 3701.0);
  });

  test('quantidade fracionária não perde centavo no total', () {
    /// Hora técnica é cobrada em fração. Arredondar a quantidade antes de
    /// multiplicar mudaria o valor do orçamento.
    const linha = QuoteLine(
      description: 'Hora técnica',
      quantity: 1.5,
      unitPrice: 220,
    );
    expect(linha.total, 330.0);
  });

  test('preço zero é válido; é uma cortesia, não um erro', () {
    const linha = QuoteLine(
      description: 'Visita de diagnóstico',
      quantity: 1,
      unitPrice: 0,
    );
    expect(linha.total, 0);
  });

  test('o resultado diz quantos itens entraram', () {
    /// O orçamento nasce vazio e as linhas entram uma a uma — não há comando
    /// que faça as duas coisas. Se uma linha falhar, quem chamou precisa
    /// saber que o orçamento existe mesmo assim.
    const resultado = QuoteDraftResult(id: 'q1', itemsAdded: 2);
    expect(resultado.id, isNotEmpty);
    expect(resultado.itemsAdded, 2);
  });
}
