/// Peças comuns às três páginas do cliente.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../artifact/data/document_file.dart';
import '../../artifact/data/document_name.dart';
import '../application/portal_session.dart';
import '../data/portal_contracts.dart';
import 'portal_widgets.dart';

/// O tom de um status de atendimento, pelo código que o servidor publica.
///
/// O rótulo vem pronto do servidor; o app só escolhe a cor.
OrbitTone operationTone(String code) => switch (code) {
  'completed' => OrbitTone.success,
  'inProgress' => OrbitTone.info,
  'paused' => OrbitTone.warning,
  'cancelled' => OrbitTone.danger,
  _ => OrbitTone.neutral,
};

OrbitTone assetTone(String code) => switch (code) {
  'active' => OrbitTone.success,
  'maintenance' => OrbitTone.warning,
  _ => OrbitTone.neutral,
};

/// `dd/MM` — a coluna de data das listas do cliente.
String portalDay(DateTime? when) {
  if (when == null) return '—';
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(when.day)}/${dois(when.month)}';
}

/// `dd/MM/aaaa`.
String portalDate(DateTime? when) {
  if (when == null) return '—';
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(when.day)}/${dois(when.month)}/${when.year}';
}

/// `dd/MM/aaaa às HH:mm`.
String portalDateTime(DateTime? when) {
  if (when == null) return '—';
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(when.day)}/${dois(when.month)}/${when.year} às '
      '${dois(when.hour)}:${dois(when.minute)}';
}

const _diasDaSemana = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom'];

/// O melhor dia e horário para a visita, como o cliente escolheu e o técnico
/// lê: "qui, 26/11/2026 às 09:00". É esse texto que vai para o chamado — e
/// dele para a descrição do atendimento.
String visitPreferenceLabel(DateTime when) =>
    '${_diasDaSemana[when.weekday - 1]}, ${portalDateTime(when)}';

/// O nome com que o PDF chega a quem recebe: título e código, sem caminho.
String portalDocumentFileName(PortalDocument document) => documentFileNameOf([
  if (document.title.isNotEmpty) document.title else document.categoryLabel,
  if (document.code.isNotEmpty) document.code,
]);

/// Baixa o documento e abre a folha de compartilhamento do aparelho.
///
/// A folha é o "abrir" do cliente também: dali ele salva em Arquivos, abre no
/// leitor de PDF ou manda pelo WhatsApp. Uma tela de PDF própria só repetiria
/// o que o sistema já faz melhor.
Future<void> openPortalDocument(
  BuildContext context,
  WidgetRef ref, {
  required String documentId,
  required String fileName,
  String? subject,
}) async {
  final mensageiro = ScaffoldMessenger.maybeOf(context);
  final origem = _origem(context);
  final repository = ref.read(portalRepositoryProvider);
  final me = ref.read(portalMeProvider);
  final files = TemporaryDocumentFileStore(
    scopeKey: 'portal-${me?.identityId ?? 'anonimo'}',
  );
  mensageiro?.showSnackBar(
    const SnackBar(
      content: Text('Preparando o documento…'),
      duration: Duration(seconds: 20),
    ),
  );
  try {
    final download = await repository.downloadDocument(documentId);
    if (checkDocumentBytes(download.bytes) != null) {
      throw const OrbitException(
        kind: OrbitErrorKind.parse,
        publicMessage: 'Não foi possível abrir este documento agora.',
        code: 'INVALID_DOCUMENT',
      );
    }
    final path = await files.write(
      download.fileName ?? fileName,
      download.bytes,
    );
    mensageiro?.hideCurrentSnackBar();
    await SharePlus.instance.share(
      ShareParams(
        files: [XFile(path, mimeType: 'application/pdf')],
        subject: subject,
        sharePositionOrigin: origem,
      ),
    );
  } on Object catch (error) {
    mensageiro
      ?..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Text(
            OrbitException.publicCopyForAny(
              error,
              prefixo: 'Não foi possível abrir o documento.',
            ),
          ),
        ),
      );
  }
}

Rect? _origem(BuildContext context) {
  final caixa = context.findRenderObject();
  if (caixa is! RenderBox || !caixa.hasSize) return null;
  return caixa.localToGlobal(Offset.zero) & caixa.size;
}

/// Um documento, pronto para abrir ou compartilhar.
class PortalDocumentRow extends ConsumerWidget {
  const PortalDocumentRow({super.key, required this.document});

  final PortalDocument document;

  @override
  Widget build(BuildContext context, WidgetRef ref) => PortalDocumentCard(
    document: document,
    onOpen: () => openPortalDocument(
      context,
      ref,
      documentId: document.id,
      fileName: portalDocumentFileName(document),
      subject: document.title,
    ),
  );
}

/// Título de bloco dentro das fichas.
class PortalBlockTitle extends StatelessWidget {
  const PortalBlockTitle(this.text, {super.key});

  final String text;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(
      top: OrbitSpacing.lg,
      bottom: OrbitSpacing.sm,
    ),
    child: Text(
      text.toUpperCase(),
      style: OrbitType.eyebrow.copyWith(color: context.orbit.inkSubtle),
    ),
  );
}
