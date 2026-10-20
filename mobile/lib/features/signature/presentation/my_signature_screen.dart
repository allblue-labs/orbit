/// Minha assinatura.
///
/// A assinatura profissional pertence ao **usuário** — não ao atendimento, ao
/// cliente ou ao documento. Por isso mora no Perfil, e não escondida dentro de
/// um atendimento: quem precisa cadastrá-la geralmente descobre isso longe do
/// campo.
///
/// O app não escolhe qual assinatura está ativa nem conta versões: o servidor
/// mantém uma ativa por profissional e diz qual é.
library;

import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../../core/contracts/mobile_signature_contracts.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/design/orbit_signature_pad.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/signature_providers.dart';
import 'widgets/professional_signature_preview.dart';

/// De onde vem a imagem da assinatura.
///
/// Injetável para que o teste possa entregar bytes sem uma galeria: o que se
/// quer exercitar é a tela, não o seletor do sistema. Devolve `null` quando o
/// usuário desiste.
typedef SignatureImageSource =
    Future<({Uint8List bytes, String fileName})?> Function();

class MySignatureScreen extends ConsumerStatefulWidget {
  const MySignatureScreen({super.key, this.source = pickFromGallery});

  final SignatureImageSource source;

  /// A origem é a galeria: a assinatura costuma ser uma foto do traço em papel
  /// ou uma imagem já pronta. Não há captura por câmera aqui — enquadrar
  /// assinatura na hora rende imagem torta, e o backend recusaria depois.
  static Future<({Uint8List bytes, String fileName})?> pickFromGallery() async {
    final picked = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      maxWidth: 1600,
    );
    if (picked == null) return null;
    return (bytes: await picked.readAsBytes(), fileName: picked.name);
  }

  @override
  ConsumerState<MySignatureScreen> createState() => _MySignatureScreenState();
}

class _MySignatureScreenState extends ConsumerState<MySignatureScreen> {
  /// O arquivo escolhido, ainda **não** enviado.
  ///
  /// Existe para que o usuário veja o que está prestes a virar a sua
  /// assinatura. O servidor não publica caminho de leitura da assinatura
  /// ativa, então este é o único momento em que a imagem pode ser conferida —
  /// e mandar direto da galeria seria enviar às cegas.
  ({Uint8List bytes, String fileName})? _picked;

  /// O traço do desenho. Vive enquanto a tela existe e não sai daqui até a
  /// confirmação — desenhar não envia nada.
  final _pad = OrbitSignatureController();

  @override
  void dispose() {
    _pad.dispose();
    super.dispose();
  }

  /// Transforma o traço em PNG e envia pelo mesmo caminho da imagem.
  ///
  /// Mesmo caminho de propósito: o desenho não ganha uma rota própria nem um
  /// tratamento mais frouxo. Ele vira imagem e passa pela mesma reserva, pelo
  /// mesmo envio e pela mesma conferência de bytes no servidor.
  Future<void> _sendDrawn() async {
    final bytes = await _pad.exportar();
    if (bytes == null || !mounted) return;

    await ref
        .read(signatureUploadControllerProvider.notifier)
        .submit(bytes: bytes, fileName: 'assinatura.png');

    if (!mounted) return;
    if (ref.read(signatureUploadControllerProvider).phase ==
        SignatureUploadPhase.done) {
      _pad.limpar();
    }
  }

  @override
  Widget build(BuildContext context) {
    final status = ref.watch(signatureStatusProvider);
    final upload = ref.watch(signatureUploadControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Minha assinatura')),
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(signatureStatusProvider),
        child: ListView(
          padding: const EdgeInsets.all(OrbitSpacing.gutter),
          children: [
            status.when(
              loading: () => const SectionLoading(lines: 3),
              error: (error, _) => SectionError(
                error: error,
                onRetry: () => ref.invalidate(signatureStatusProvider),
              ),
              data: (value) => _Status(status: value),
            ),

            const SizedBox(height: OrbitSpacing.md),

            /// Desenhar primeiro.
            ///
            /// No celular o dedo já está na tela, e a assinatura sai do gesto
            /// natural. Enviar imagem exige ter uma foto do traço pronta na
            /// galeria — é o caminho alternativo, e fica embaixo por isso.
            _DrawSection(
              hasSignature: status.valueOrNull?.signatureAvailable ?? false,
              controller: _pad,
              busy: upload.isBusy,
              onConfirm: _sendDrawn,
            ),

            const SizedBox(height: OrbitSpacing.md),

            _UploadSection(
              hasSignature: status.valueOrNull?.signatureAvailable ?? false,
              upload: upload,
              picked: _picked,
              onPick: _pick,
              onConfirm: _send,
              onDiscard: () => setState(() => _picked = null),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pick() async {
    final picked = await widget.source();
    if (picked == null || !mounted) return;

    /// A checagem local roda antes da confirmação: recusar aqui poupa o
    /// usuário de confirmar algo que o servidor rejeitaria.
    ref.read(signatureUploadControllerProvider.notifier).inspect(picked.bytes);
    setState(() => _picked = picked);
  }

  Future<void> _send() async {
    final picked = _picked;
    if (picked == null) return;

    await ref
        .read(signatureUploadControllerProvider.notifier)
        .submit(bytes: picked.bytes, fileName: picked.fileName);

    /// Só limpa o que está na tela quando o envio de fato concluiu; uma falha
    /// mantém a imagem escolhida, para que repetir não exija escolher de novo.
    if (!mounted) return;
    if (ref.read(signatureUploadControllerProvider).phase ==
        SignatureUploadPhase.done) {
      setState(() => _picked = null);
    }
  }
}

class _Status extends StatelessWidget {
  const _Status({required this.status});

  final MobileSignatureStatus status;

  @override
  Widget build(BuildContext context) {
    final label =
        signatureStatusLabels[status.signatureAvailable
            ? 'available'
            : 'missing']!;

    return SectionBlock(
      title: 'Assinatura profissional',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                status.signatureAvailable
                    ? Icons.verified_outlined
                    : Icons.draw_outlined,
                size: 20,
                color: status.signatureAvailable
                    ? OrbitColors.success
                    : OrbitColors.textSecondary,
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: Text(
                  label.label,
                  style: const TextStyle(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: OrbitColors.textPrimary,
                  ),
                ),
              ),
            ],
          ),
          Padding(
            padding: const EdgeInsets.only(top: 4),
            child: Text(
              label.description ?? '',
              style: const TextStyle(
                fontSize: 13,
                color: OrbitColors.textSecondary,
              ),
            ),
          ),

          if (status.updatedAt != null)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.sm),
              child: Text(
                'Atualizada em ${OrbitFormat.dateHourOf(status.updatedAt)}',
                style: const TextStyle(
                  fontSize: 12,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ),

          if (status.signatureAvailable) ...[
            const SizedBox(height: OrbitSpacing.md),
            const ProfessionalSignaturePreview(),
          ],

          /// A mesma assinatura vale nos dois papéis: o contexto é do
          /// documento, não do arquivo.
          if (status.roles.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.sm),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Seus papéis profissionais',
                    style: TextStyle(
                      fontSize: 12,
                      color: OrbitColors.textSecondary,
                    ),
                  ),
                  Text(
                    status.roles.map(professionalRoleLabel).join(' · '),
                    style: const TextStyle(
                      fontSize: 14,
                      color: OrbitColors.textPrimary,
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _UploadSection extends StatelessWidget {
  const _UploadSection({
    required this.hasSignature,
    required this.upload,
    required this.picked,
    required this.onPick,
    required this.onConfirm,
    required this.onDiscard,
  });

  final bool hasSignature;
  final SignatureUploadState upload;
  final ({Uint8List bytes, String fileName})? picked;
  final VoidCallback onPick;
  final VoidCallback onConfirm;
  final VoidCallback onDiscard;

  @override
  Widget build(BuildContext context) {
    final problem = upload.problem;

    return SectionBlock(
      title: hasSignature ? 'Substituir assinatura' : 'Cadastrar assinatura',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            hasSignature
                /// Documentos já emitidos guardam a assinatura de quando foram
                /// gerados. Prometer propagação retroativa seria falso.
                ? 'A nova assinatura será usada nos documentos futuros. Os '
                      'documentos já emitidos permanecem como estão.'
                : 'Envie uma imagem da sua assinatura. PNG, JPEG ou WEBP, '
                      'até 2 MB.',
            style: const TextStyle(
              fontSize: 13,
              color: OrbitColors.textSecondary,
            ),
          ),
          const SizedBox(height: OrbitSpacing.md),

          if (problem != null)
            Padding(
              padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
              child: Text(
                signatureFileProblemLabels[problem.name] ??
                    'Não foi possível usar este arquivo.',
                style: const TextStyle(fontSize: 13, color: OrbitColors.danger),
              ),
            ),

          if (upload.error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
              child: SectionError(error: upload.error!),
            ),

          if (upload.phase == SignatureUploadPhase.done)
            const Padding(
              padding: EdgeInsets.only(bottom: OrbitSpacing.sm),
              child: Text(
                'Assinatura atualizada.',
                style: TextStyle(fontSize: 13, color: OrbitColors.success),
              ),
            ),

          /// A imagem escolhida, antes de virar assinatura.
          ///
          /// Fundo claro e altura contida: assinatura é traço escuro sobre
          /// papel, e é assim que ela vai aparecer no documento.
          if (picked case final file? when problem == null) ...[
            Container(
              constraints: const BoxConstraints(maxHeight: 180),
              padding: const EdgeInsets.all(OrbitSpacing.sm),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: OrbitRadius.card,
                border: Border.all(color: OrbitColors.border),
              ),
              child: Image.memory(
                file.bytes,
                fit: BoxFit.contain,
                semanticLabel: 'Prévia da assinatura escolhida',

                /// Bytes que passaram na checagem local ainda podem não
                /// decodificar. Dizer isso é melhor do que uma caixa vazia.
                errorBuilder: (context, _, __) => const Text(
                  'Não foi possível exibir esta imagem.',
                  style: TextStyle(fontSize: 13, color: OrbitColors.danger),
                ),
              ),
            ),
            const SizedBox(height: OrbitSpacing.md),
            Semantics(
              button: true,
              enabled: !upload.isBusy,
              label: hasSignature
                  ? 'Confirmar substituição da assinatura'
                  : 'Confirmar cadastro da assinatura',
              child: FilledButton(
                onPressed: upload.isBusy ? null : onConfirm,
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                child: Text(
                  upload.isBusy
                      ? 'Enviando…'
                      : hasSignature
                      ? 'Confirmar substituição'
                      : 'Confirmar assinatura',
                ),
              ),
            ),
            TextButton(
              onPressed: upload.isBusy ? null : onDiscard,
              child: const Text('Escolher outra imagem'),
            ),
          ] else
            Semantics(
              button: true,
              enabled: !upload.isBusy,
              label: hasSignature
                  ? 'Substituir assinatura'
                  : 'Cadastrar assinatura',
              child: FilledButton(
                onPressed: upload.isBusy ? null : onPick,
                style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                child: Text(
                  hasSignature ? 'Escolher nova imagem' : 'Escolher imagem',
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// Desenhar a assinatura — o caminho principal no celular.
class _DrawSection extends StatelessWidget {
  const _DrawSection({
    required this.hasSignature,
    required this.controller,
    required this.busy,
    required this.onConfirm,
  });

  final bool hasSignature;
  final OrbitSignatureController controller;
  final bool busy;
  final Future<void> Function() onConfirm;

  @override
  Widget build(BuildContext context) => SectionBlock(
    title: 'Desenhar assinatura',
    child: ListenableBuilder(
      listenable: controller,
      builder: (context, _) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Use o dedo ou uma caneta. O traço só é enviado quando você '
            'confirma.',
            style: OrbitType.caption.copyWith(color: context.orbit.inkMuted),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          OrbitSignaturePad(
            controller: controller,
            hint: 'Assine neste espaço',
            enabled: !busy,
          ),
          const SizedBox(height: OrbitSpacing.sm),
          Row(
            children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: busy ? null : controller.limpar,
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size(0, 48),
                  ),
                  child: const Text('Limpar'),
                ),
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: FilledButton(
                  /// Pad vazio não confirma. Uma assinatura vazia seria um
                  /// retângulo transparente com valor de prova nenhum.
                  onPressed: busy || !controller.temTraco
                      ? null
                      : () => onConfirm(),
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
                  child: Text(hasSignature ? 'Substituir' : 'Confirmar'),
                ),
              ),
            ],
          ),
        ],
      ),
    ),
  );
}
