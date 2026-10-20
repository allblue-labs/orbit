/// Aceite do cliente.
///
/// ## O aparelho passa de mão
///
/// Esta é a única tela do app pensada para ser lida por **outra pessoa**. Ela
/// é empurrada fora do shell, então a barra de navegação do app não aparece:
/// enquanto o cliente revisa o resumo e confirma, o resto do trabalho do
/// técnico fica fora de vista. A seta de voltar continua ali — quem devolve o
/// aparelho é o técnico, e prendê-lo na tela não protegeria nada.
///
/// ## O que o cliente vê é o que o servidor congelou
///
/// `serviceSummary` chega redigido, e é exatamente o texto que o `contentHash`
/// cobre. Montar um resumo alternativo aqui quebraria a correspondência: o
/// cliente concordaria com um texto e o backend registraria outro.
///
/// ## Aceite não é assinatura
///
/// A assinatura gráfica é opcional por política (`signatureRequired: false`).
/// Por isso o termo é "aceite", e não "assinatura do cliente" — e em lugar
/// nenhum se promete assinatura digital certificada.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/contracts/mobile_signature_contracts.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/design/orbit_signature_pad.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../../field/application/execution_controller.dart' show newCommandId;
import '../../../core/contracts/mobile_offline_sync_contracts.dart';
import '../../sync/application/sync_controller.dart';
import '../../sync/application/sync_providers.dart';
import '../../sync/presentation/widgets/pending_badge.dart';
import '../application/signature_providers.dart';

class CustomerAcknowledgementScreen extends ConsumerStatefulWidget {
  const CustomerAcknowledgementScreen({super.key, required this.operationId});

  final String operationId;

  @override
  ConsumerState<CustomerAcknowledgementScreen> createState() =>
      _CustomerAcknowledgementScreenState();
}

class _CustomerAcknowledgementScreenState
    extends ConsumerState<CustomerAcknowledgementScreen> {
  final _signerName = TextEditingController();

  /// O traço do cliente. Vive enquanto a tela existe: sair e voltar apaga, e
  /// isso é o comportamento certo — a assinatura é **daquele** momento.
  final _pad = OrbitSignatureController();
  bool _sending = false;
  String? _failure;

  /// Confirmado pelo servidor, ou apenas guardado no aparelho.
  ///
  /// Os dois **não** podem virar a mesma tela: dizer "registrado" sobre algo
  /// que ainda não saiu do aparelho é a promessa mais fácil de quebrar num
  /// aplicativo de campo.
  _AcceptedState? _accepted;

  /// Trocar de atendimento apaga o que foi coletado.
  ///
  /// A assinatura e o nome pertencem **àquele** atendimento. Se esta tela for
  /// reaproveitada para outro — o Flutter atualiza o `State` quando o widget
  /// no mesmo lugar é do mesmo tipo — o traço do cliente anterior continuaria
  /// no pad, e o próximo cliente confirmaria um serviço com a assinatura de
  /// outra pessoa.
  ///
  /// Hoje a navegação empurra uma rota nova e o `State` nasce limpo por acaso.
  /// "Por acaso" não é garantia: isto torna a limpeza deliberada.
  @override
  void didUpdateWidget(CustomerAcknowledgementScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) {
      _pad.limpar();
      _signerName.clear();
      setState(() {
        _accepted = null;
        _failure = null;
      });
    }
  }

  @override
  void dispose() {
    _signerName.dispose();
    _pad.dispose();
    super.dispose();
  }

  /// Registra a ciência.
  ///
  /// Passa pelo mesmo journal das demais intenções: com rede, o servidor
  /// responde no mesmo toque; sem rede, o aceite fica guardado e a tela diz
  /// isso ao técnico — nunca ao cliente, que já foi embora.
  ///
  /// `contentVersion` e `contentHash` viajam **verbatim** dentro do envelope e
  /// são congelados ali. Recalculá-los na hora do envio quebraria a
  /// correspondência com o texto que o cliente leu, que é a única coisa que dá
  /// sentido ao aceite.
  Future<void> _submit(CustomerAcknowledgementPreparation preparation) async {
    final name = _signerName.text.trim();
    if (name.length < 2 || _sending) return;

    setState(() {
      _sending = true;
      _failure = null;
    });
    try {
      /// A imagem sobe **antes** do comando.
      ///
      /// O comando carrega o identificador do arquivo, então o arquivo precisa
      /// existir primeiro. Falhar aqui não registra aceite nenhum: melhor
      /// nenhum aceite do que um aceite sem a assinatura que o cliente
      /// acabou de fazer.
      String? signatureFileId;
      if (_pad.temTraco) {
        final bytes = await _pad.exportar();
        if (bytes != null) {
          signatureFileId = await ref
              .read(signatureRepositoryProvider)
              .uploadSignatureImage(
                fileName: 'aceite.png',
                mimeType: 'image/png',
                bytes: bytes,
                purpose: 'CUSTOMER_ACKNOWLEDGEMENT',
              );
        }
      }

      final commandId = newCommandId();
      final sync = ref.read(syncControllerProvider.notifier);
      await sync.enqueue(
        OfflineCommandEnvelope(
          commandId: commandId,
          idempotencyKey: commandId,
          commandType: OfflineCommandType.customerAcknowledgement,
          aggregateId: widget.operationId,
          expectedVersion: preparation.contentVersion,
          occurredAt: DateTime.now().toUtc(),
          payload: {
            'signerName': name,
            'contentHash': preparation.contentHash,
            if (signatureFileId != null)
              'signatureStorageFileId': signatureFileId,
          },
          deviceInstanceId: ref.read(deviceInstanceIdProvider).valueOrNull,
        ),
      );

      final outcome = await sync.outcomeOf(commandId);
      if (!mounted) return;

      switch (outcome) {
        case CommandConfirmed():
          setState(() => _accepted = _AcceptedState.confirmed);

        case CommandPendingOutcome():
          setState(() => _accepted = _AcceptedState.pending);

        case CommandBlocked():

          /// O atendimento mudou desde que o resumo foi congelado. A saída é
          /// recarregar e coletar de novo — nunca registrar concordância com
          /// um texto que o cliente não leu.
          ref.invalidate(
            acknowledgementPreparationProvider(widget.operationId),
          );
          setState(() => _failure = outcome.message);
      }
    } on Object catch (error) {
      if (mounted) {
        setState(
          () => _failure = error is OrbitException
              ? error.publicMessage
              : 'Não foi possível registrar a ciência.',
        );
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final preparation = ref.watch(
      acknowledgementPreparationProvider(widget.operationId),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Aceite do cliente')),
      body: SafeArea(
        child: preparation.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 5),
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () => ref.invalidate(
                  acknowledgementPreparationProvider(widget.operationId),
                ),
              ),
            ],
          ),
          data: (value) => _accepted == null
              ? _Form(
                  preparation: value,
                  signerName: _signerName,
                  pad: _pad,
                  sending: _sending,
                  failure: _failure,
                  onSubmit: () => _submit(value),
                )
              : _Accepted(
                  state: _accepted!,
                  signerName: _signerName.text.trim(),
                ),
        ),
      ),
    );
  }
}

class _Form extends StatelessWidget {
  const _Form({
    required this.preparation,
    required this.signerName,
    required this.pad,
    required this.sending,
    required this.failure,
    required this.onSubmit,
  });

  final CustomerAcknowledgementPreparation preparation;
  final TextEditingController signerName;
  final OrbitSignatureController pad;
  final bool sending;
  final String? failure;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: EdgeInsets.only(
        left: OrbitSpacing.md,
        right: OrbitSpacing.md,
        top: OrbitSpacing.md,

        /// O teclado empurra o conteúdo; o botão nunca fica coberto.
        bottom: MediaQuery.viewInsetsOf(context).bottom + OrbitSpacing.xl,
      ),
      children: [
        if (preparation.existingAcknowledgement case final existing?)
          _PreviousAcknowledgement(existing: existing),

        SectionBlock(
          title: 'Resumo do atendimento',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (preparation.customerName case final name?)
                _Line(label: 'Cliente', value: name),
              if (preparation.performedAt != null)
                _Line(
                  label: 'Realizado em',
                  value: OrbitFormat.dateHourOf(preparation.performedAt),
                ),
              for (final equipment in preparation.equipment)
                _Line(
                  label: 'Equipamento',
                  value: '${equipment.name} · ${equipment.code}',
                ),
              const SizedBox(height: OrbitSpacing.sm),

              /// O texto do servidor, como veio.
              Text(
                preparation.serviceSummary,
                style: const TextStyle(
                  fontSize: 14,
                  height: 1.4,
                  color: OrbitColors.textPrimary,
                ),
              ),
            ],
          ),
        ),

        SectionBlock(
          title: 'Quem está dando ciência',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              TextField(
                controller: signerName,
                textCapitalization: TextCapitalization.words,
                maxLength: 180,
                decoration: const InputDecoration(
                  labelText: 'Nome de quem recebeu o serviço',
                ),
              ),

              /// O nome fica **no aceite**, não no cadastro do cliente: quem
              /// recebe pode ser o zelador, o síndico, qualquer um presente.
              const Text(
                'O nome fica registrado neste atendimento e não altera o '
                'cadastro do cliente.',
                style: TextStyle(
                  fontSize: 12,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ],
          ),
        ),

        /// A assinatura vem **depois** do resumo e do nome, e não antes.
        ///
        /// O cliente precisa ter lido o que está confirmando: assinar primeiro
        /// e ler depois inverte o sentido do gesto, e é o que transforma
        /// aceite em formalidade vazia.
        SectionBlock(
          title: 'Assinatura',
          child: ListenableBuilder(
            listenable: pad,
            builder: (context, _) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                OrbitSignaturePad(
                  controller: pad,
                  hint: 'Assine neste espaço',
                  enabled: !sending,
                ),
                const SizedBox(height: OrbitSpacing.sm),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: sending ? null : pad.limpar,
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(0, 48),
                        ),
                        child: const Text('Limpar'),
                      ),
                    ),
                  ],
                ),

                /// A assinatura gráfica é opcional por política do servidor
                /// (`signatureRequired: false`). Dizer isso evita que o técnico
                /// fique parado esperando um cliente que não quer assinar.
                const SizedBox(height: OrbitSpacing.sm),
                Text(
                  'A assinatura é opcional. Sem ela, fica registrado o nome de '
                  'quem recebeu o serviço.',
                  style: OrbitType.caption.copyWith(
                    color: context.orbit.inkMuted,
                  ),
                ),

                if (failure case final String message) ...[
                  const SizedBox(height: OrbitSpacing.sm),
                  Text(
                    message,
                    style: OrbitType.caption.copyWith(
                      color: context.orbit.danger,
                    ),
                  ),
                ],

                const SizedBox(height: OrbitSpacing.md),
                Semantics(
                  button: true,
                  enabled: !sending,
                  label: 'Confirmar atendimento',
                  child: FilledButton(
                    onPressed: sending ? null : onSubmit,
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 52),
                    ),
                    child: Text(
                      sending ? 'Registrando…' : 'Confirmar atendimento',
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}

/// Um aceite já registrado — fato, sem juízo sobre validade.
class _PreviousAcknowledgement extends StatelessWidget {
  const _PreviousAcknowledgement({required this.existing});

  final ExistingAcknowledgement existing;

  @override
  Widget build(BuildContext context) => SectionBlock(
    title: 'Ciência já registrada',
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          existing.signerName,
          style: const TextStyle(fontSize: 14, color: OrbitColors.textPrimary),
        ),
        Text(
          OrbitFormat.dateHourOf(existing.acknowledgedAt),
          style: const TextStyle(
            fontSize: 12,
            color: OrbitColors.textSecondary,
          ),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        const Text(
          'Se o atendimento mudou depois disso, colete a ciência novamente.',
          style: TextStyle(fontSize: 12, color: OrbitColors.textSecondary),
        ),
      ],
    ),
  );
}

/// Como o aceite terminou deste lado.
enum _AcceptedState { confirmed, pending }

class _Accepted extends StatelessWidget {
  const _Accepted({required this.state, required this.signerName});

  final _AcceptedState state;
  final String signerName;

  @override
  Widget build(BuildContext context) {
    final confirmed = state == _AcceptedState.confirmed;

    return ListView(
      padding: const EdgeInsets.all(OrbitSpacing.gutter),
      children: [
        SectionBlock(
          title: confirmed
              ? 'Ciência registrada'
              : 'Ciência salva neste aparelho',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                signerName,
                style: const TextStyle(
                  fontSize: 15,
                  fontWeight: FontWeight.w600,
                  color: OrbitColors.textPrimary,
                ),
              ),
              const SizedBox(height: OrbitSpacing.sm),

              /// Sem rede, o que existe é um registro local. Chamá-lo de
              /// registrado seria afirmar em nome de um servidor que ainda não
              /// respondeu.
              if (!confirmed) ...[
                const PendingBadge(),
                const SizedBox(height: OrbitSpacing.sm),
                const Text(
                  'A ciência foi guardada e será enviada quando houver '
                  'conexão.',
                  style: TextStyle(
                    fontSize: 13,
                    color: OrbitColors.textSecondary,
                  ),
                ),
                const SizedBox(height: OrbitSpacing.sm),
              ],

              /// Ciência não é documento emitido — e não se promete que seja.
              const Text(
                'O documento do atendimento é emitido em separado.',
                style: TextStyle(
                  fontSize: 12,
                  color: OrbitColors.textSecondary,
                ),
              ),
            ],
          ),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
          child: const Text('Voltar ao atendimento'),
        ),
      ],
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 4),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontSize: 11,
            color: OrbitColors.textSecondary,
          ),
        ),
        Text(
          value,
          style: const TextStyle(fontSize: 14, color: OrbitColors.textPrimary),
        ),
      ],
    ),
  );
}
