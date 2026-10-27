/// Resumo e aceite do cliente, reutilizados diretamente na confirmação do wizard.
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
  const CustomerAcknowledgementScreen({
    super.key,
    required this.operationId,
    this.embedded = false,
    this.onConfirmed,
  });

  final String operationId;
  final bool embedded;
  final Future<void> Function()? onConfirmed;

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
  String? _ackCommandId;
  bool _resuming = false;

  /// Trocar de atendimento apaga o que foi coletado.
  ///
  /// A assinatura e o nome pertencem **àquele** atendimento. Se esta tela for
  /// reaproveitada para outro — o Flutter atualiza o `State` quando o widget
  /// no mesmo lugar é do mesmo tipo — o traço do cliente anterior continuaria
  /// no pad, e o próximo cliente confirmaria um serviço com a assinatura de
  /// outra pessoa.
  ///
  /// A coleta é reutilizada no wizard, e a limpeza acompanha a identidade do atendimento.
  @override
  void didUpdateWidget(CustomerAcknowledgementScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.operationId != widget.operationId) {
      _pad.limpar();
      _signerName.clear();
      setState(() {
        _accepted = null;
        _failure = null;
        _sending = false;
        _ackCommandId = null;
        _resuming = false;
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
    final operationId = widget.operationId;
    final name = _signerName.text.trim();
    if (_sending) return;
    if (name.length < 2) {
      setState(
        () => _failure =
            'Informe o nome de quem recebeu o serviço (mínimo de 2 caracteres).',
      );
      return;
    }
    if (preparation.signatureRequired && !_pad.temTraco) {
      setState(
        () => _failure = 'Assine no espaço indicado antes de confirmar.',
      );
      return;
    }
    FocusManager.instance.primaryFocus?.unfocus();

    setState(() {
      _sending = true;
      _failure = null;
    });
    try {
      final sync = ref.read(syncControllerProvider.notifier);
      final pending = await sync.commandsFor(operationId);
      if (!mounted || widget.operationId != operationId) return;
      if (pending.isNotEmpty) {
        setState(
          () => _failure =
              'Há registros aguardando sincronização. Sincronize o atendimento antes de confirmar o resumo com o cliente.',
        );
        return;
      }

      /// A imagem sobe **antes** do comando.
      ///
      /// O comando carrega o identificador do arquivo, então o arquivo precisa
      /// existir primeiro. Falhar aqui não registra aceite nenhum: melhor
      /// nenhum aceite do que um aceite sem a assinatura que o cliente
      /// acabou de fazer.
      String? signatureFileId;
      if (_pad.temTraco) {
        final bytes = await _pad.exportar();
        if (bytes == null) {
          throw StateError(
            'Não foi possível preparar a assinatura. Tente novamente.',
          );
        }
        if (!mounted || widget.operationId != operationId) return;
        signatureFileId = await ref
            .read(signatureRepositoryProvider)
            .uploadSignatureImage(
              fileName: 'aceite.png',
              mimeType: 'image/png',
              bytes: bytes,
              purpose: 'CUSTOMER_ACKNOWLEDGEMENT',
            );
      }

      final commandId = newCommandId();
      _ackCommandId = commandId;
      if (!mounted || widget.operationId != operationId) return;
      await sync.enqueue(
        OfflineCommandEnvelope(
          commandId: commandId,
          idempotencyKey: commandId,
          commandType: OfflineCommandType.customerAcknowledgement,
          aggregateId: operationId,
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
      if (!mounted || widget.operationId != operationId) return;

      switch (outcome) {
        case CommandConfirmed():
          setState(() => _accepted = _AcceptedState.confirmed);
          ScaffoldMessenger.maybeOf(context)?.showSnackBar(
            const SnackBar(content: Text('Confirmação do cliente registrada.')),
          );
          ref.invalidate(acknowledgementPreparationProvider(operationId));
          await widget.onConfirmed?.call();

        case CommandPendingOutcome():
          setState(() => _accepted = _AcceptedState.pending);

        case CommandBlocked():

          /// O atendimento mudou desde que o resumo foi congelado. A saída é
          /// recarregar e coletar de novo — nunca registrar concordância com
          /// um texto que o cliente não leu.
          ref.invalidate(acknowledgementPreparationProvider(operationId));
          _pad.limpar();
          setState(() => _failure = outcome.message);
      }
    } on Object catch (error) {
      if (mounted && widget.operationId == operationId) {
        setState(
          () => _failure = error is OrbitException
              ? error.publicMessage
              : 'Não foi possível registrar a ciência.',
        );
      }
    } finally {
      if (mounted && widget.operationId == operationId) {
        setState(() => _sending = false);
      }
    }
  }

  Future<void> _resumePendingConfirmation() async {
    final commandId = _ackCommandId;
    if (_resuming || commandId == null || _accepted != _AcceptedState.pending) {
      return;
    }
    final operationId = widget.operationId;
    _resuming = true;
    try {
      final outcome = await ref
          .read(syncControllerProvider.notifier)
          .outcomeOf(commandId);
      if (!mounted || widget.operationId != operationId) return;
      if (outcome is CommandConfirmed) {
        setState(() => _accepted = _AcceptedState.confirmed);
        ref.invalidate(acknowledgementPreparationProvider(operationId));
        await widget.onConfirmed?.call();
      } else if (outcome is CommandBlocked) {
        _pad.limpar();
        setState(() {
          _accepted = null;
          _failure = outcome.message;
        });
        ref.invalidate(acknowledgementPreparationProvider(operationId));
      }
    } finally {
      if (mounted && operationId == widget.operationId) _resuming = false;
    }
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(syncControllerProvider.select((value) => value.lastSyncedAt), (
      previous,
      next,
    ) {
      if (next != null && _accepted == _AcceptedState.pending) {
        _resumePendingConfirmation();
      }
    });
    ref.listen(acknowledgementPreparationProvider(widget.operationId), (
      previous,
      next,
    ) {
      final oldHash = previous?.valueOrNull?.contentHash;
      final newHash = next.valueOrNull?.contentHash;
      if (oldHash != null && newHash != null && oldHash != newHash) {
        _pad.limpar();
        setState(() {
          _accepted = null;
          _failure =
              'O atendimento foi atualizado. Confira o novo resumo e colete a assinatura novamente.';
        });
      }
    });
    final preparation = ref.watch(
      acknowledgementPreparationProvider(widget.operationId),
    );

    final content = preparation.when(
      loading: () => const SectionLoading(lines: 5),
      error: (error, _) => SectionError(
        error: error,
        onRetry: () => ref.invalidate(
          acknowledgementPreparationProvider(widget.operationId),
        ),
      ),
      data: (value) => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (_accepted != null)
            _Accepted(state: _accepted!, signerName: _signerName.text.trim()),
          _Form(
            preparation: value,
            signerName: _signerName,
            pad: _pad,
            sending: _sending,
            failure: _failure,
            accepted: _accepted != null,
            onSubmit: () => _submit(value),
            onCollectAgain: () => setState(() {
              _accepted = null;
              _pad.limpar();
              _signerName.clear();
              ref.invalidate(
                acknowledgementPreparationProvider(widget.operationId),
              );
            }),
          ),
        ],
      ),
    );
    if (widget.embedded) return content;
    return Scaffold(
      appBar: AppBar(title: const Text('Aceite do cliente')),
      body: SafeArea(
        child: SingleChildScrollView(
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.all(OrbitSpacing.md),
          child: content,
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
    required this.accepted,
    required this.onCollectAgain,
  });

  final CustomerAcknowledgementPreparation preparation;
  final TextEditingController signerName;
  final OrbitSignatureController pad;
  final bool sending;
  final String? failure;
  final VoidCallback onSubmit;
  final bool accepted;
  final VoidCallback onCollectAgain;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
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

        if (accepted)
          OutlinedButton(
            onPressed: onCollectAgain,
            child: const Text('Coletar novamente'),
          )
        else ...[
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
                    preparation.signatureRequired
                        ? 'Assine para confirmar o resumo deste atendimento.'
                        : 'A assinatura é opcional. Sem ela, fica registrado o nome de quem recebeu o serviço.',
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
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
