/// A tela de Documentos: o recorte, o agrupamento e o nome do arquivo.
///
/// Estes três respondem a perguntas que a captura não responde: se o filtro
/// vira query no servidor, se dois documentos do mesmo dia caem no mesmo
/// grupo, e se o arquivo que chega ao cliente tem nome legível.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:orbit_operator/core/contracts/mobile_field_contracts.dart';
import 'package:orbit_operator/features/documents/application/documents_providers.dart';
import 'package:orbit_operator/features/documents/data/documents_repository.dart';
import 'package:orbit_operator/features/documents/presentation/document_open_sheet.dart';
import 'package:orbit_operator/features/documents/presentation/documents_screen.dart';

MobileRecentDocumentContract documento({
  String id = 'a1',
  String tipo = 'SERVICE_ORDER',
  String rotulo = 'Ordem de serviço 2026-0148',
  String? cliente = 'Clínica Vida',
  DateTime? criadoEm,
}) => MobileRecentDocumentContract(
  artifactId: id,
  documentType: tipo,
  label: rotulo,
  customerName: cliente,
  createdAt: criadoEm ?? DateTime(2026, 9, 8, 14),
  state: MobileDocumentState.available,
);

void main() {
  group('nome do arquivo', () {
    test('acento vira a letra sem acento, nunca hífen', () {
      /// O defeito que isto tranca: "serviço" virava "servi-o" e "Clínica"
      /// virava "cl-nica" — a palavra quebrada no meio, no WhatsApp do
      /// cliente.
      expect(
        documentFileName(documento()),
        'ordem-de-servico-2026-0148-clinica-vida.pdf',
      );
    });

    test('travessão e pontuação viram um hífen só', () {
      expect(
        documentFileName(
          documento(rotulo: 'PMOC — ciclo mensal', cliente: 'São João / Ltda.'),
        ),
        'pmoc-ciclo-mensal-sao-joao-ltda.pdf',
      );
    });

    test('sem cliente, o rótulo basta', () {
      expect(
        documentFileName(documento(rotulo: 'RVT', cliente: null)),
        'rvt.pdf',
      );
    });

    test('um rótulo sem nenhum caractere aproveitável ainda tem nome', () {
      expect(
        documentFileName(documento(rotulo: '///', cliente: null)),
        'documento.pdf',
      );
    });
  });

  group('rótulo do dia', () {
    final agora = DateTime(2026, 9, 8, 9);

    test('hoje e ontem, porque é assim que se pensa a data em campo', () {
      expect(rotuloDoDia(DateTime(2026, 9, 8, 23), agora: agora), 'Hoje');
      expect(rotuloDoDia(DateTime(2026, 9, 7, 1), agora: agora), 'Ontem');
    });

    test('o mesmo dia dá o mesmo rótulo — é o que junta o grupo', () {
      expect(
        rotuloDoDia(DateTime(2026, 9, 4, 8), agora: agora),
        rotuloDoDia(DateTime(2026, 9, 4, 22), agora: agora),
      );
    });

    test('o ano só aparece quando não é o corrente', () {
      expect(rotuloDoDia(DateTime(2026, 9, 4), agora: agora), '4 de setembro');
      expect(
        rotuloDoDia(DateTime(2025, 12, 30), agora: agora),
        '30 de dezembro de 2025',
      );
    });
  });

  group('recorte', () {
    test('a busca não conta como filtro ativo — ela tem campo próprio', () {
      const recorte = DocumentQuery(search: 'shopping');
      expect(recorte.activeCount, 0);
    });

    test('tipo e período contam', () {
      final recorte = DocumentQuery(
        filter: DocumentFilter.rvt,
        from: DateTime(2026, 9, 1),
        to: DateTime(2026, 9, 30),
      );
      expect(recorte.activeCount, 2);
    });

    test('limpar a busca não leva o período junto', () {
      final recorte = DocumentQuery(
        search: 'shopping',
        from: DateTime(2026, 9, 1),
      ).copyWith(clearSearch: true);
      expect(recorte.search, isNull);
      expect(recorte.from, DateTime(2026, 9, 1));
    });
  });

  group('junção de páginas', () {
    test('a mesma página duas vezes não duplica', () {
      final primeira = [documento(id: 'a1'), documento(id: 'a2')];
      expect(mergeDocuments(primeira, primeira).length, 2);
    });

    test('a ordem do servidor é preservada', () {
      final juntas = mergeDocuments(
        [documento(id: 'a1')],
        [documento(id: 'a2'), documento(id: 'a3')],
      );
      expect(juntas.map((d) => d.artifactId), ['a1', 'a2', 'a3']);
    });
  });
}
