/// Abrir (ou corrigir) um chamado, em cinco passos curtos.
///
/// ## Pouco obrigatório, muito útil
///
/// Obrigatório é só o mínimo para alguém entender o pedido: do que se trata,
/// um assunto e o que está acontecendo. Todo o resto — equipamento, se ele
/// parou, urgência, onde fica, quando dá para ir, com quem falar — é opcional,
/// mas cada passo pergunta exatamente o que o técnico perguntaria pelo
/// telefone antes de sair. Quem não sabe responder, pula.
library;

import 'dart:math';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/design/orbit_primitives.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/portal_providers.dart';
import '../application/portal_session.dart';
import '../data/portal_contracts.dart';
import 'portal_common.dart';
import 'portal_widgets.dart';

/// Abre o assistente. Com [editing], corrige esse chamado; devolve o chamado
/// gravado, ou `null` se a pessoa desistiu.
Future<ServiceRequest?> showServiceRequestWizard(
  BuildContext context, {
  ServiceRequest? editing,
  String? assetId,
}) => Navigator.of(context).push<ServiceRequest>(
  MaterialPageRoute(
    fullscreenDialog: true,
    builder: (_) => ServiceRequestWizard(editing: editing, assetId: assetId),
  ),
);

/// O que cada categoria sugere perguntar na descrição.
const _dicas = <ServiceRequestCategory, String>{
  ServiceRequestCategory.equipmentProblem:
      'Ex.: desde quando, se faz barulho, se pinga água, se aparece algum código no visor.',
  ServiceRequestCategory.maintenance:
      'Ex.: quais equipamentos, quando foi a última manutenção, alguma preferência de data.',
  ServiceRequestCategory.serviceRequest:
      'Ex.: o que precisa ser feito, onde, tamanho do ambiente, prazo desejado.',
  ServiceRequestCategory.documentRequest:
      'Ex.: qual documento, de qual período e para quê (fiscalização, contabilidade…).',
  ServiceRequestCategory.question:
      'Escreva sua dúvida com o máximo de detalhes.',
  ServiceRequestCategory.other: 'Conte o que você precisa.',
};

const _icones = <ServiceRequestCategory, IconData>{
  ServiceRequestCategory.equipmentProblem: Icons.report_problem_outlined,
  ServiceRequestCategory.maintenance: Icons.build_outlined,
  ServiceRequestCategory.serviceRequest: Icons.handyman_outlined,
  ServiceRequestCategory.documentRequest: Icons.description_outlined,
  ServiceRequestCategory.question: Icons.help_outline,
  ServiceRequestCategory.other: Icons.chat_bubble_outline,
};

IconData serviceRequestIcon(ServiceRequestCategory category) =>
    _icones[category] ?? Icons.chat_bubble_outline;

class ServiceRequestWizard extends ConsumerStatefulWidget {
  const ServiceRequestWizard({super.key, this.editing, this.assetId});

  final ServiceRequest? editing;
  final String? assetId;

  @override
  ConsumerState<ServiceRequestWizard> createState() =>
      _ServiceRequestWizardState();
}

class _ServiceRequestWizardState extends ConsumerState<ServiceRequestWizard> {
  static const _titulos = [
    'Sobre o que é?',
    'Qual equipamento?',
    'Conte o que está acontecendo',
    'Para a visita',
    'Revise e envie',
  ];

  int _passo = 0;
  bool _enviando = false;
  String? _erro;

  ServiceRequestCategory? _categoria;
  String? _equipamento;
  EquipmentCondition? _condicao;
  ServiceRequestUrgency _urgencia = ServiceRequestUrgency.normal;
  final _assunto = TextEditingController();
  final _descricao = TextEditingController();
  final _local = TextEditingController();
  final _horario = TextEditingController();
  final _contato = TextEditingController();
  final _telefone = TextEditingController();
  bool _assuntoTocado = false;

  /// Uma chave por envio: a nova tentativa depois de uma falha de rede é o
  /// mesmo pedido, e o servidor devolve o chamado já criado em vez de outro.
  final String _chave =
      'app-${DateTime.now().microsecondsSinceEpoch}-${Random.secure().nextInt(1 << 32)}';

  bool get _editando => widget.editing != null;

  @override
  void initState() {
    super.initState();
    final rascunho = widget.editing?.toDraft();
    if (rascunho != null) {
      _categoria = rascunho.category;
      _equipamento = rascunho.assetId;
      _condicao = rascunho.equipmentCondition;
      _urgencia = rascunho.urgency;
      _assunto.text = rascunho.subject;
      _descricao.text = rascunho.description;
      _local.text = rascunho.siteLocation;
      _horario.text = rascunho.availability;
      _contato.text = rascunho.contactName;
      _telefone.text = rascunho.contactPhone;
      _assuntoTocado = true;
    } else {
      _equipamento = widget.assetId;
      final me = ref.read(portalMeProvider);
      _contato.text = me?.displayName ?? '';
    }
  }

  @override
  void dispose() {
    for (final c in [
      _assunto,
      _descricao,
      _local,
      _horario,
      _contato,
      _telefone,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  /// O assunto sugerido: categoria e equipamento — editável.
  void _sugerirAssunto(List<PortalAsset> equipamentos) {
    if (_assuntoTocado || _categoria == null) return;
    final nome = equipamentos
        .where((asset) => asset.id == _equipamento)
        .firstOrNull
        ?.name;
    _assunto.text = nome == null
        ? _categoria!.label
        : '${_categoria!.label} — $nome';
  }

  String? _problemaDoPasso() => switch (_passo) {
    0 when _categoria == null => 'Escolha do que se trata o chamado.',
    2 when _assunto.text.trim().length < 3 =>
      'Escreva um assunto com pelo menos 3 letras.',
    2 when _descricao.text.trim().length < 5 =>
      'Descreva o que está acontecendo (pelo menos 5 letras).',
    _ => null,
  };

  void _avancar(List<PortalAsset> equipamentos) {
    final problema = _problemaDoPasso();
    if (problema != null) {
      setState(() => _erro = problema);
      return;
    }
    if (_passo == 1) _sugerirAssunto(equipamentos);
    setState(() {
      _erro = null;
      _passo += 1;
    });
  }

  ServiceRequestDraft get _rascunho => ServiceRequestDraft(
    category: _categoria ?? ServiceRequestCategory.other,
    subject: _assunto.text,
    description: _descricao.text,
    assetId: _equipamento,
    urgency: _urgencia,
    equipmentCondition: _equipamento == null ? null : _condicao,
    siteLocation: _local.text,
    availability: _horario.text,
    contactName: _contato.text,
    contactPhone: _telefone.text,
  );

  Future<void> _enviar() async {
    setState(() {
      _enviando = true;
      _erro = null;
    });
    final repo = ref.read(portalRepositoryProvider);
    try {
      final gravado = _editando
          ? await repo.updateServiceRequest(
              widget.editing!.id,
              _rascunho,
              expectedVersion: widget.editing!.version,
            )
          : await repo.openServiceRequest(_rascunho, idempotencyKey: _chave);
      ref.invalidate(portalServiceRequestsProvider);
      if (!mounted) return;
      Navigator.of(context).pop(gravado);
    } on Object catch (error) {
      if (!mounted) return;
      setState(
        () => _erro = OrbitException.publicCopyForAny(
          error,
          prefixo: _editando
              ? 'Não foi possível salvar o chamado.'
              : 'Não foi possível abrir o chamado.',
        ),
      );
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final equipamentos =
        ref.watch(portalAllAssetsProvider).valueOrNull?.items ??
        const <PortalAsset>[];
    final ultimo = _passo == _titulos.length - 1;
    return Scaffold(
      backgroundColor: palette.background,
      appBar: AppBar(
        title: Text(_editando ? 'Editar chamado' : 'Abrir chamado'),
        leading: IconButton(
          tooltip: 'Fechar',
          icon: const Icon(Icons.close),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                OrbitSpacing.sm,
                OrbitSpacing.gutter,
                0,
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'PASSO ${_passo + 1} DE ${_titulos.length}',
                    style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
                  ),
                  const SizedBox(height: OrbitSpacing.xs),
                  ClipRRect(
                    borderRadius: OrbitRadius.pill,
                    child: LinearProgressIndicator(
                      value: (_passo + 1) / _titulos.length,
                      minHeight: 6,
                      backgroundColor: palette.surfaceMuted,
                    ),
                  ),
                  const SizedBox(height: OrbitSpacing.md),
                  Text(
                    _titulos[_passo],
                    style: OrbitType.screenTitle.copyWith(color: palette.ink),
                  ),
                ],
              ),
            ),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(OrbitSpacing.gutter),
                children: [
                  switch (_passo) {
                    0 => _passoCategoria(),
                    1 => _passoEquipamento(),
                    2 => _passoDescricao(),
                    3 => _passoVisita(),
                    _ => _passoRevisao(equipamentos),
                  },
                ],
              ),
            ),
            Container(
              padding: const EdgeInsets.fromLTRB(
                OrbitSpacing.gutter,
                OrbitSpacing.ms,
                OrbitSpacing.gutter,
                OrbitSpacing.ms,
              ),
              decoration: BoxDecoration(
                color: palette.surface,
                boxShadow: OrbitShadow.raised,
              ),
              /* O aviso fica junto dos botões: no fim da lista ele caía
                 fora da tela, e "Continuar" parecia não fazer nada. */
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (_erro != null) ...[
                    Row(
                      children: [
                        Icon(
                          Icons.error_outline,
                          size: 18,
                          color: palette.danger,
                        ),
                        const SizedBox(width: OrbitSpacing.sm),
                        Expanded(
                          child: Text(
                            _erro!,
                            style: OrbitType.caption.copyWith(
                              color: palette.danger,
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: OrbitSpacing.sm),
                  ],
                  Row(
                    children: [
                      if (_passo > 0) ...[
                        Expanded(
                          flex: 2,
                          child: OutlinedButton(
                            onPressed: _enviando
                                ? null
                                : () => setState(() {
                                    _erro = null;
                                    _passo -= 1;
                                  }),
                            /* Uma linha só: com letra ampliada, "Voltar"
                               quebrava em "Volta / r". */
                            child: const Text(
                              'Voltar',
                              maxLines: 1,
                              softWrap: false,
                              overflow: TextOverflow.fade,
                            ),
                          ),
                        ),
                        const SizedBox(width: OrbitSpacing.ms),
                      ],
                      Expanded(
                        flex: 3,
                        child: FilledButton(
                          key: const Key('wizard.next'),
                          onPressed: _enviando
                              ? null
                              : ultimo
                              ? _enviar
                              : () => _avancar(equipamentos),
                          child: _enviando
                              ? const SizedBox(
                                  width: 20,
                                  height: 20,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 2,
                                  ),
                                )
                              : Text(
                                  ultimo
                                      ? (_editando
                                            ? 'Salvar alterações'
                                            : 'Abrir chamado')
                                      : 'Continuar',
                                ),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _passoCategoria() => Column(
    crossAxisAlignment: CrossAxisAlignment.stretch,
    children: [
      for (final categoria in ServiceRequestCategory.values) ...[
        _Opcao(
          icon: serviceRequestIcon(categoria),
          title: categoria.label,
          selected: _categoria == categoria,
          onTap: () => setState(() {
            _categoria = categoria;
            _erro = null;
          }),
        ),
        const SizedBox(height: OrbitSpacing.sm),
      ],
    ],
  );

  Widget _passoEquipamento() {
    final palette = context.orbit;
    final lista = ref.watch(portalAllAssetsProvider);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Escolher o equipamento ajuda o técnico a levar a peça certa. Opcional.',
          style: OrbitType.caption.copyWith(color: palette.inkMuted),
        ),
        const SizedBox(height: OrbitSpacing.md),
        _Opcao(
          icon: Icons.do_not_disturb_alt_outlined,
          title: 'Não é sobre um equipamento específico',
          selected: _equipamento == null,
          onTap: () => setState(() => _equipamento = null),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        lista.when(
          loading: () => const SectionLoading(lines: 3),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () => ref.invalidate(portalAllAssetsProvider),
          ),
          data: (page) => Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              for (final asset in page.items) ...[
                _Opcao(
                  icon: Icons.ac_unit,
                  title: asset.name,
                  subtitle: [
                    asset.location,
                    asset.identifier,
                  ].whereType<String>().join(' · '),
                  selected: _equipamento == asset.id,
                  onTap: () => setState(() => _equipamento = asset.id),
                ),
                const SizedBox(height: OrbitSpacing.sm),
              ],
            ],
          ),
        ),
        if (_equipamento != null) ...[
          const SizedBox(height: OrbitSpacing.md),
          Text(
            'Como ele está agora?',
            style: OrbitType.itemTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          Wrap(
            spacing: OrbitSpacing.sm,
            runSpacing: OrbitSpacing.sm,
            children: [
              for (final condicao in EquipmentCondition.values)
                ChoiceChip(
                  label: Text(condicao.label),
                  selected: _condicao == condicao,
                  onSelected: (marcado) =>
                      setState(() => _condicao = marcado ? condicao : null),
                ),
            ],
          ),
        ],
      ],
    );
  }

  Widget _passoDescricao() {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          key: const Key('wizard.subject'),
          controller: _assunto,
          maxLength: 180,
          textCapitalization: TextCapitalization.sentences,
          onChanged: (_) => _assuntoTocado = true,
          decoration: const InputDecoration(
            labelText: 'Assunto',
            hintText: 'Em poucas palavras',
          ),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        TextField(
          key: const Key('wizard.description'),
          controller: _descricao,
          minLines: 4,
          maxLines: 8,
          maxLength: 5000,
          textCapitalization: TextCapitalization.sentences,
          decoration: InputDecoration(
            labelText: 'O que está acontecendo?',
            alignLabelWithHint: true,
            helperText: _dicas[_categoria],
            helperMaxLines: 3,
          ),
        ),
        const SizedBox(height: OrbitSpacing.md),
        Text(
          'Qual a urgência?',
          style: OrbitType.itemTitle.copyWith(color: palette.ink),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        for (final urgencia in ServiceRequestUrgency.values) ...[
          _Opcao(
            icon: urgencia == ServiceRequestUrgency.urgent
                ? Icons.priority_high
                : Icons.schedule,
            title: urgencia.label,
            subtitle: urgencia.hint,
            selected: _urgencia == urgencia,
            tone: urgencia == ServiceRequestUrgency.urgent
                ? OrbitTone.danger
                : urgencia == ServiceRequestUrgency.high
                ? OrbitTone.warning
                : OrbitTone.info,
            onTap: () => setState(() => _urgencia = urgencia),
          ),
          const SizedBox(height: OrbitSpacing.sm),
        ],
      ],
    );
  }

  Widget _passoVisita() {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Tudo opcional — mas poupa uma ligação antes da visita.',
          style: OrbitType.caption.copyWith(color: palette.inkMuted),
        ),
        const SizedBox(height: OrbitSpacing.md),
        TextField(
          controller: _local,
          maxLength: 180,
          decoration: const InputDecoration(
            labelText: 'Onde fica no local?',
            hintText: 'Ex.: recepção, 2º andar, sala 204',
          ),
        ),
        _CampoVisita(
          value: _horario.text,
          onPick: _escolherVisita,
          onClear: () => setState(() => _horario.clear()),
        ),
        const SizedBox(height: OrbitSpacing.md),
        TextField(
          controller: _contato,
          maxLength: 120,
          textCapitalization: TextCapitalization.words,
          decoration: const InputDecoration(labelText: 'Quem recebe o técnico'),
        ),
        TextField(
          controller: _telefone,
          maxLength: 40,
          keyboardType: TextInputType.phone,
          decoration: const InputDecoration(labelText: 'Telefone de contato'),
        ),
      ],
    );
  }

  /// Data e hora pelo calendário e pelo relógio do sistema — de hoje até 90
  /// dias à frente, e nunca um horário que já passou.
  Future<void> _escolherVisita() async {
    final agora = DateTime.now();
    final hoje = DateTime(agora.year, agora.month, agora.day);
    final dia = await showDatePicker(
      context: context,
      initialDate: hoje.add(const Duration(days: 1)),
      firstDate: hoje,
      lastDate: hoje.add(const Duration(days: 90)),
      helpText: 'Melhor dia para a visita',
      cancelText: 'Cancelar',
      confirmText: 'Continuar',
    );
    if (dia == null || !mounted) return;
    final hora = await showTimePicker(
      context: context,
      initialTime: const TimeOfDay(hour: 9, minute: 0),
      helpText: 'Melhor horário',
      cancelText: 'Voltar',
      confirmText: 'Confirmar',
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(alwaysUse24HourFormat: true),
        child: child!,
      ),
    );
    if (hora == null || !mounted) return;
    final quando = DateTime(
      dia.year,
      dia.month,
      dia.day,
      hora.hour,
      hora.minute,
    );
    if (quando.isBefore(agora)) {
      ScaffoldMessenger.maybeOf(context)?.showSnackBar(
        const SnackBar(
          content: Text('Escolha um horário que ainda não passou.'),
        ),
      );
      return;
    }
    setState(() => _horario.text = visitPreferenceLabel(quando));
  }

  Widget _passoRevisao(List<PortalAsset> equipamentos) {
    final nome = equipamentos
        .where((asset) => asset.id == _equipamento)
        .firstOrNull
        ?.name;
    return PortalFactsCard(
      facts: [
        ('Tipo', _categoria?.label),
        ('Assunto', _assunto.text.trim()),
        ('O que está acontecendo', _descricao.text.trim()),
        ('Urgência', _urgencia.label),
        ('Equipamento', nome),
        (
          'Situação do equipamento',
          _equipamento == null ? null : _condicao?.label,
        ),
        ('Onde fica', _local.text.trim()),
        ('Melhor horário', _horario.text.trim()),
        ('Contato', _contato.text.trim()),
        ('Telefone', _telefone.text.trim()),
      ],
    );
  }
}

/// Uma opção de toque grande: ícone, título, descrição e o visto.
class _Opcao extends StatelessWidget {
  const _Opcao({
    required this.icon,
    required this.title,
    required this.selected,
    required this.onTap,
    this.subtitle,
    this.tone = OrbitTone.info,
  });

  final IconData icon;
  final String title;
  final String? subtitle;
  final bool selected;
  final VoidCallback onTap;
  final OrbitTone tone;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Semantics(
      selected: selected,
      button: true,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 150),
        decoration: BoxDecoration(
          color: palette.surface,
          borderRadius: OrbitRadius.card,
          border: Border.all(
            color: selected ? palette.accent : palette.border,
            width: selected ? 2 : 1,
          ),
        ),
        child: Material(
          type: MaterialType.transparency,
          child: InkWell(
            borderRadius: OrbitRadius.card,
            onTap: onTap,
            child: Padding(
              padding: const EdgeInsets.all(OrbitSpacing.ms),
              child: Row(
                children: [
                  PortalIconTile(icon: icon, tone: tone),
                  const SizedBox(width: OrbitSpacing.ms),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          title,
                          style: OrbitType.itemTitle.copyWith(
                            color: palette.ink,
                          ),
                        ),
                        if (subtitle != null && subtitle!.isNotEmpty)
                          Text(
                            subtitle!,
                            style: OrbitType.caption.copyWith(
                              color: palette.inkMuted,
                            ),
                          ),
                      ],
                    ),
                  ),
                  Icon(
                    selected
                        ? Icons.check_circle
                        : Icons.radio_button_unchecked,
                    color: selected ? palette.accent : palette.inkSubtle,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

/// O melhor dia e horário: um campo que abre o calendário e o relógio.
///
/// Texto livre ("dias úteis, de manhã") deixava o técnico ligando para
/// confirmar. Chamados antigos com texto continuam aparecendo aqui, e trocar
/// é tocar de novo.
class _CampoVisita extends StatelessWidget {
  const _CampoVisita({
    required this.value,
    required this.onPick,
    required this.onClear,
  });

  final String value;
  final VoidCallback onPick;
  final VoidCallback onClear;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final vazio = value.trim().isEmpty;
    return InkWell(
      key: const Key('visit.preference'),
      borderRadius: OrbitRadius.field,
      onTap: onPick,
      child: InputDecorator(
        /* Rótulo sempre no alto: dentro da caixa ele cobriria o convite. */
        isEmpty: false,
        decoration: InputDecoration(
          labelText: 'Melhor dia e horário',
          floatingLabelBehavior: FloatingLabelBehavior.always,
          prefixIcon: const Icon(Icons.event_outlined),
          suffixIcon: vazio
              ? const Icon(Icons.chevron_right_rounded)
              : IconButton(
                  key: const Key('visit.preference.clear'),
                  tooltip: 'Limpar',
                  icon: const Icon(Icons.close_rounded),
                  onPressed: onClear,
                ),
        ),
        child: Text(
          vazio ? 'Escolher data e horário' : value,
          style: OrbitType.body.copyWith(
            color: vazio ? palette.inkSubtle : palette.ink,
          ),
        ),
      ),
    );
  }
}
