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

/// `dd/MM/aaaa às HH:mm`.
String portalDateTime(DateTime? when) {
  if (when == null) return '—';
  String dois(int n) => n.toString().padLeft(2, '0');
  return '${dois(when.day)}/${dois(when.month)}/${when.year} às '
      '${dois(when.hour)}:${dois(when.minute)}';
}

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

/// Uma linha de documento: data, título, categoria, e o botão de enviar.
class PortalDocumentRow extends ConsumerWidget {
  const PortalDocumentRow({super.key, required this.document});

  final PortalDocument document;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final palette = context.orbit;
    void abrir() => openPortalDocument(
      context,
      ref,
      documentId: document.id,
      fileName: portalDocumentFileName(document),
      subject: document.title,
    );
    return OrbitListRow(
      leading: portalDay(document.issuedAt),
      title: document.title.isEmpty ? document.categoryLabel : document.title,
      subtitle: [
        document.categoryLabel,
        if (document.code.isNotEmpty) document.code,
      ].join(' · '),
      trailing: IconButton(
        tooltip: 'Abrir ou compartilhar',
        icon: Icon(Icons.ios_share, color: palette.accent),
        onPressed: abrir,
      ),
      onTap: abrir,
    );
  }
}

/// Um par rótulo/valor das fichas de detalhe. Sem valor, não aparece.
class PortalFact extends StatelessWidget {
  const PortalFact({super.key, required this.label, required this.value});

  final String label;
  final String? value;

  @override
  Widget build(BuildContext context) {
    final texto = value;
    if (texto == null || texto.trim().isEmpty) return const SizedBox.shrink();
    final palette = context.orbit;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: OrbitSpacing.xs),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 120,
            child: Text(
              label,
              style: OrbitType.caption.copyWith(color: palette.inkMuted),
            ),
          ),
          Expanded(
            child: Text(
              texto,
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
          ),
        ],
      ),
    );
  }
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
