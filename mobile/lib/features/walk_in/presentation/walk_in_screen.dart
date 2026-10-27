/// Abrir um atendimento estando no local.
///
/// ## O caso de uso
///
/// A fila responde "o que me foi atribuído". Não respondia "estou na porta de
/// alguém que não tem ordem aberta" — e isso é metade do dia de uma equipe de
/// campo: o cliente liga, o técnico passa, o vizinho pede para olhar o aparelho
/// dele. Sem este caminho o trabalho acontecia e não existia no sistema:
/// nenhuma OS, nenhum documento, nenhuma comissão.
///
/// ## O roteiro
///
/// ```text
/// Origem → Cliente → Equipamentos → Atendimento → (abre e entra na execução)
/// ```
///
/// Com o cliente já escolhido — quando se chega pela folha do cliente — a etapa
/// de origem não existe: ela ofereceria "novo cliente" para quem acabou de
/// escolher um.
///
/// ## Exige rede, e a tela diz isso
///
/// Diferente do resto do roteiro de campo, este comando **não** é
/// offline-first: cliente, equipamentos e ordem dependem de identificadores que
/// só o servidor emite. Fingir sucesso offline produziria um atendimento local
/// que, na sincronização, poderia colidir com um cadastro feito no escritório —
/// e o técnico descobriria isso depois de executar.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../field/application/field_providers.dart';
import '../../../core/contracts/walk_in_contracts.dart';
import '../../../core/design/orbit_primitives.dart';
import '../../../core/design/orbit_wizard.dart';
import '../../../core/errors/orbit_exception.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/walk_in_providers.dart';
import '../data/walk_in_draft.dart';
import 'widgets/walk_in_equipment_sheet.dart';
import 'widgets/walk_in_fields.dart';

class WalkInScreen extends ConsumerStatefulWidget {
  const WalkInScreen({super.key, this.customerId, this.customerName});

  /// O cliente já escolhido, quando se chega pela folha dele.
  ///
  /// Preenchido, a etapa de origem desaparece e o caminho "novo cliente" não é
  /// oferecido: quem acabou de escolher um cliente não quer cadastrar outro.
  final String? customerId;
  final String? customerName;

  @override
  ConsumerState<WalkInScreen> createState() => _WalkInScreenState();
}

class _WalkInScreenState extends ConsumerState<WalkInScreen> {
  /// A chave de idempotência desta sessão do roteiro.
  ///
  /// Gerada uma vez e estável até a ordem abrir: a resposta pode se perder na
  /// volta — é o caso normal com a rede oscilando na calçada — e tocar de novo
  /// precisa encontrar a ordem que já existe em vez de abrir a segunda.
  late final String _idempotencyKey =
      'walkin-${DateTime.now().microsecondsSinceEpoch}';

  WalkInOrigin? _origem;
  WalkInCustomerContract? _escolhido;

  final _busca = TextEditingController();
  final _scroll = ScrollController();
  String _termo = '';
  Timer? _debounce;

  final _selecionados = <String>{};
  final _novosEquipamentos = <WalkInEquipmentDraft>[];

  /* Cliente novo. */
  String _tipo = 'COMPANY';
  final _nome = TextEditingController();
  final _fantasia = TextEditingController();
  final _documento = TextEditingController();
  final _email = TextEditingController();
  final _telefone = TextEditingController();
  final _contato = TextEditingController();
  final _cep = TextEditingController();
  final _rua = TextEditingController();
  final _numero = TextEditingController();
  final _complemento = TextEditingController();
  final _bairro = TextEditingController();
  final _cidade = TextEditingController();
  final _uf = TextEditingController();
  final _referencia = TextEditingController();

  bool _consultandoDocumento = false;
  bool _consultandoCep = false;
  String? _avisoDocumento;
  String? _avisoCep;
  Timer? _documentoTimer;
  Timer? _cepTimer;
  int _documentoRequest = 0;
  int _cepRequest = 0;
  final _preenchidosAutomaticamente = <TextEditingController, String>{};

  /* Atendimento. */
  String _natureza = 'MAINTENANCE';
  String _prioridade = 'NORMAL';
  final _titulo = TextEditingController();
  final _descricao = TextEditingController();
  final _setor = TextEditingController();

  bool _abrindo = false;
  OrbitException? _erro;

  @override
  void initState() {
    super.initState();
    /* Chegando pela folha do cliente, a origem já está decidida. */
    if (widget.customerId != null) _origem = WalkInOrigin.existing;
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _documentoTimer?.cancel();
    _cepTimer?.cancel();
    _scroll.dispose();
    for (final controller in [
      _busca,
      _nome,
      _fantasia,
      _documento,
      _email,
      _telefone,
      _contato,
      _cep,
      _rua,
      _numero,
      _complemento,
      _bairro,
      _cidade,
      _uf,
      _referencia,
      _titulo,
      _descricao,
      _setor,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  /// O cliente pré-selecionado conta como escolhido mesmo antes de a carteira
  /// carregar: a etapa seguinte não deve esperar uma consulta para liberar.
  String? get _clienteId => widget.customerId ?? _escolhido?.id;

  WalkInDraft get _rascunho => WalkInDraft(
    origin: _origem ?? WalkInOrigin.existing,
    customerId: _clienteId,
    customer: _origem == WalkInOrigin.fresh
        ? WalkInCustomerDraft(
            type: _tipo,
            legalName: _nome.text,
            tradeName: _fantasia.text,
            documentNumber: _documento.text,
            email: _email.text,
            phone: _telefone.text,
            contactName: _contato.text,
            address: WalkInAddressDraft(
              postalCode: _cep.text,
              street: _rua.text,
              number: _numero.text,
              complement: _complemento.text,
              district: _bairro.text,
              city: _cidade.text,
              stateCode: _uf.text,
              reference: _referencia.text,
            ),
          )
        : null,
    assetIds: _selecionados.toList(growable: false),
    equipment: _novosEquipamentos,
    kind: _natureza,
    title: _titulo.text,
    description: _descricao.text,
    priority: _prioridade,
    sector: _setor.text,
  );

  void _buscar(String value) {
    _debounce?.cancel();
    /* 400ms: a busca é do servidor, e disparar a cada tecla faria uma consulta
       por letra digitada. */
    _debounce = Timer(const Duration(milliseconds: 400), () {
      if (mounted) setState(() => _termo = value.trim());
    });
  }

  String _digits(String value) => value.replaceAll(RegExp(r'\D'), '');

  void _escolherOrigem(WalkInOrigin value) {
    _documentoTimer?.cancel();
    _cepTimer?.cancel();
    _documentoRequest++;
    _cepRequest++;
    setState(() {
      _origem = value;
      _consultandoDocumento = false;
      _consultandoCep = false;
      _avisoDocumento = null;
      _avisoCep = null;
    });
  }

  void _mudarTipo(String value) {
    if (value == _tipo) return;
    _documentoTimer?.cancel();
    _documentoRequest++;
    setState(() {
      _tipo = value;
      _documento.clear();
      _fantasia.clear();
      if (_nome.text == _preenchidosAutomaticamente[_nome]) _nome.clear();
      _consultandoDocumento = false;
      _avisoDocumento = null;
    });
  }

  void _documentoMudou(String _) {
    _documentoTimer?.cancel();
    _documentoRequest++;
    setState(() {
      _consultandoDocumento = false;
      _avisoDocumento = null;
    });
    if (_tipo == 'COMPANY' && _digits(_documento.text).length == 14) {
      _documentoTimer = Timer(const Duration(milliseconds: 450), () {
        unawaited(_consultarDocumento());
      });
    }
  }

  void _cepMudou(String _) {
    _cepTimer?.cancel();
    _cepRequest++;
    setState(() {
      _consultandoCep = false;
      _avisoCep = null;
    });
    if (_digits(_cep.text).length == 8) {
      _cepTimer = Timer(const Duration(milliseconds: 450), () {
        unawaited(_consultarCep());
      });
    }
  }

  Future<void> _consultarDocumento() async {
    final digitos = _digits(_documento.text);
    if (_tipo != 'COMPANY' || digitos.length != 14 || _consultandoDocumento) {
      return;
    }
    _documentoTimer?.cancel();
    final request = ++_documentoRequest;
    bool atual() =>
        mounted &&
        request == _documentoRequest &&
        _origem == WalkInOrigin.fresh &&
        _tipo == 'COMPANY' &&
        _digits(_documento.text) == digitos;
    setState(() {
      _consultandoDocumento = true;
      _avisoDocumento = null;
    });
    try {
      final empresa = await ref.read(walkInRepositoryProvider).company(digitos);
      if (!atual()) return;
      setState(() {
        _preencher(_nome, empresa.legalName);
        _preencher(_fantasia, empresa.tradeName);
        _preencher(_email, empresa.email);
        _preencher(_telefone, empresa.phone);
        // An address manually chosen by CEP takes precedence over company data.
        if (_cep.text.trim().isEmpty ||
            _digits(_cep.text) == _digits(empresa.address.postalCode) ||
            _cep.text == _preenchidosAutomaticamente[_cep]) {
          if (_digits(_cep.text) != _digits(empresa.address.postalCode)) {
            _cepTimer?.cancel();
            _cepRequest++;
            _consultandoCep = false;
            _avisoCep = null;
          }
          _preencher(_cep, empresa.address.postalCode);
          _preencher(_rua, empresa.address.street);
          _preencher(_numero, empresa.address.number);
          _preencher(_complemento, empresa.address.complement);
          _preencher(_bairro, empresa.address.district);
          _preencher(_cidade, empresa.address.city);
          _preencher(_uf, empresa.address.stateCode);
        }
      });
    } on Object catch (error) {
      if (atual()) {
        setState(
          () => _avisoDocumento =
              '${OrbitException.publicCopyForAny(error, prefixo: 'Não foi possível consultar o CNPJ.')} Você pode preencher os dados manualmente.',
        );
      }
    } finally {
      if (atual()) setState(() => _consultandoDocumento = false);
    }
  }

  Future<void> _consultarCep() async {
    final digitos = _digits(_cep.text);
    if (digitos.length != 8 || _consultandoCep) return;
    _cepTimer?.cancel();
    final request = ++_cepRequest;
    bool atual() =>
        mounted &&
        request == _cepRequest &&
        _origem == WalkInOrigin.fresh &&
        _digits(_cep.text) == digitos;
    final antes = {
      for (final c in [_rua, _bairro, _cidade, _uf]) c: c.text,
    };
    setState(() {
      _consultandoCep = true;
      _avisoCep = null;
    });
    try {
      final endereco = await ref
          .read(walkInRepositoryProvider)
          .postalCode(digitos);
      if (!atual()) return;
      setState(() {
        for (final entry in {
          _rua: endereco.street,
          _bairro: endereco.district,
          _cidade: endereco.city,
          _uf: endereco.stateCode,
        }.entries) {
          // Do not overwrite edits made while the lookup was in flight.
          if (entry.key.text == antes[entry.key]) {
            entry.key.text = entry.value;
            _preenchidosAutomaticamente[entry.key] = entry.value;
          }
        }
      });
    } on Object catch (error) {
      if (atual()) {
        setState(
          () => _avisoCep =
              '${OrbitException.publicCopyForAny(error, prefixo: 'Não foi possível consultar o CEP.')} Você pode preencher o endereço manualmente.',
        );
      }
    } finally {
      if (atual()) setState(() => _consultandoCep = false);
    }
  }

  void _preencher(TextEditingController controller, String? value) {
    if (value == null || value.trim().isEmpty) return;
    if (controller.text.trim().isEmpty ||
        controller.text == _preenchidosAutomaticamente[controller]) {
      controller.text = value.trim();
      _preenchidosAutomaticamente[controller] = controller.text;
    }
  }

  Future<void> _abrir() async {
    final rascunho = _rascunho;
    if (!rascunho.isReady || _abrindo) return;

    setState(() {
      _abrindo = true;
      _erro = null;
    });
    try {
      final corpo = rascunho.toJson();
      final resultado = await ref
          .read(walkInRepositoryProvider)
          .create(
            idempotencyKey: _idempotencyKey,
            customerId: corpo['customerId'] as String?,
            customer: corpo['customer'] as Map<String, dynamic>?,
            assetIds: (corpo['assetIds'] as List<dynamic>? ?? const [])
                .cast<String>()
                .toList(growable: false),
            equipment: (corpo['equipment'] as List<dynamic>? ?? const [])
                .cast<Map<String, dynamic>>()
                .toList(growable: false),
            businessUnitId: ref.read(walkInBusinessUnitIdProvider),
            kind: corpo['kind'] as String?,
            title: corpo['title'] as String?,
            description: corpo['description'] as String?,
            priority: corpo['priority'] as String?,
            sector: corpo['sector'] as String?,
          );
      if (!mounted) return;
      ref.invalidate(fieldCustomersProvider);
      ref.invalidate(walkInCustomersProvider);
      ref.invalidate(walkInEquipmentProvider);
      ref.invalidate(workQueueControllerProvider);
      ref.invalidate(fieldDashboardProvider);

      /* Entra direto na execução: abrir o atendimento e começar a executá-lo
         são o mesmo gesto para quem está no local. */
      context.go(OrbitRoutes.operationExecution(resultado.operationId));
    } on OrbitException catch (error) {
      if (mounted) {
        setState(() => _erro = error);
        WidgetsBinding.instance.addPostFrameCallback((_) {
          if (mounted && _scroll.hasClients) {
            _scroll.animateTo(
              0,
              duration: const Duration(milliseconds: 250),
              curve: Curves.easeOut,
            );
          }
        });
      }
    } finally {
      if (mounted) setState(() => _abrindo = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final etapas = <OrbitWizardStep>[
      if (widget.customerId == null) _etapaOrigem(),
      _etapaCliente(),
      _etapaEquipamentos(),
      _etapaAtendimento(),
    ];

    return PopScope(
      canPop: !_abrindo,
      child: Scaffold(
        backgroundColor: context.orbit.background,
        appBar: AppBar(
          title: const Text('Novo atendimento'),
          actions: [
            /// A saída, nomeada.
            ///
            /// Sair aqui **descarta** o rascunho — nada foi enviado ainda —, e é
            /// o oposto do roteiro de execução, onde cada registro já foi
            /// gravado. Por isso a confirmação.
            TextButton(
              onPressed: _abrindo ? null : _confirmarSaida,
              child: const Text('Sair'),
            ),
          ],
        ),
        body: ListView(
          controller: _scroll,
          keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
          padding: const EdgeInsets.only(bottom: OrbitSpacing.xl),
          children: [
            if (_erro != null)
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  OrbitSpacing.md,
                  OrbitSpacing.md,
                  OrbitSpacing.md,
                  0,
                ),
                child: _erro!.isConflict
                    ? OrbitCard(
                        tone: OrbitTone.warning,
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'Revise os dados do atendimento',
                              style: OrbitType.sectionTitle.copyWith(
                                color: context.orbit.ink,
                              ),
                            ),
                            const SizedBox(height: OrbitSpacing.sm),
                            Text(
                              _erro!.publicMessage,
                              style: OrbitType.body.copyWith(
                                color: context.orbit.inkMuted,
                              ),
                            ),
                          ],
                        ),
                      )
                    : SectionError(error: _erro!, onRetry: _abrir),
              ),
            OrbitWizard(
              key: const ValueKey('walk-in-wizard'),
              steps: etapas,
              contentPadding: const EdgeInsets.symmetric(
                horizontal: OrbitSpacing.gutter,
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _confirmarSaida() async {
    final rascunho = _rascunho;
    final temAlgo =
        rascunho.isReady ||
        _novosEquipamentos.isNotEmpty ||
        _nome.text.trim().isNotEmpty;
    if (!temAlgo) {
      if (mounted) Navigator.of(context).maybePop();
      return;
    }

    final sair = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Descartar este atendimento?'),
        content: const Text(
          'Nada foi enviado ainda. O que você preencheu será perdido.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Continuar preenchendo'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Descartar'),
          ),
        ],
      ),
    );
    if ((sair ?? false) && mounted) Navigator.of(context).maybePop();
  }

  /* ---------------------------------------------------------------- */
  /* Etapas                                                            */
  /* ---------------------------------------------------------------- */

  OrbitWizardStep _etapaOrigem() => OrbitWizardStep(
    title: 'Origem',
    hint: 'Para quem é este atendimento?',
    complete: _origem != null,
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WalkInChoiceTile(
          icon: Icons.person_search_outlined,
          title: 'Criar para cliente existente',
          description: 'Escolher na carteira e ver os equipamentos dele',
          selected: _origem == WalkInOrigin.existing,
          onTap: () => _escolherOrigem(WalkInOrigin.existing),
        ),
        const SizedBox(height: OrbitSpacing.sm),
        WalkInChoiceTile(
          icon: Icons.person_add_alt_outlined,
          title: 'Criar avulso (novo cliente)',
          description: 'Cadastrar agora, com os equipamentos do endereço',
          selected: _origem == WalkInOrigin.fresh,
          onTap: () => _escolherOrigem(WalkInOrigin.fresh),
        ),
      ],
    ),
  );

  OrbitWizardStep _etapaCliente() {
    if (widget.customerId != null) {
      return OrbitWizardStep(
        title: 'Cliente',
        hint: 'O atendimento é para este cliente.',
        complete: true,
        child: OrbitCard(
          child: Row(
            children: [
              Icon(
                Icons.check_circle_outline,
                color: context.orbit.success,
                size: 20,
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: Text(
                  widget.customerName ?? 'Cliente selecionado',
                  style: OrbitType.body.copyWith(color: context.orbit.ink),
                ),
              ),
            ],
          ),
        ),
      );
    }

    return switch (_origem) {
      null => OrbitWizardStep(
        title: 'Cliente',
        lockedReason: 'Escolha a origem do atendimento na etapa anterior.',
        child: const SizedBox.shrink(),
      ),
      WalkInOrigin.existing => OrbitWizardStep(
        title: 'Cliente',
        hint: 'Escolha quem vai ser atendido.',
        complete: _escolhido != null,
        child: _Carteira(
          busca: _busca,
          termo: _termo,
          escolhido: _escolhido,
          onBuscar: _buscar,
          onEscolher: (cliente) => setState(() {
            if (_escolhido?.id == cliente.id) return;
            _escolhido = cliente;
            _novosEquipamentos.clear();
            /* Trocar de cliente invalida a seleção de equipamentos: eles são
               de outro parque. */
            _selecionados.clear();
          }),
        ),
      ),
      WalkInOrigin.fresh => OrbitWizardStep(
        title: 'Cliente',
        hint: 'Só o nome é obrigatório. O resto se completa depois.',
        complete: _nome.text.trim().length >= 2,
        child: _FormularioDeCliente(
          tipo: _tipo,
          onTipo: _mudarTipo,
          nome: _nome,
          fantasia: _fantasia,
          documento: _documento,
          email: _email,
          telefone: _telefone,
          contato: _contato,
          cep: _cep,
          rua: _rua,
          numero: _numero,
          complemento: _complemento,
          bairro: _bairro,
          cidade: _cidade,
          uf: _uf,
          referencia: _referencia,
          consultandoDocumento: _consultandoDocumento,
          consultandoCep: _consultandoCep,
          avisoDocumento: _avisoDocumento,
          avisoCep: _avisoCep,
          onDocumentoMudou: _documentoMudou,
          onCepMudou: _cepMudou,
          onConsultarDocumento: _consultarDocumento,
          onConsultarCep: _consultarCep,
          onMudou: () => setState(() {}),
        ),
      ),
    };
  }

  OrbitWizardStep _etapaEquipamentos() {
    final clienteId = _clienteId;
    final podeListar = _origem == WalkInOrigin.existing && clienteId != null;

    return OrbitWizardStep(
      title: 'Equipamentos',
      hint: _origem == WalkInOrigin.fresh
          ? 'Adicione um ou mais equipamentos. Só o nome é obrigatório.'
          : 'Escolha os equipamentos deste cliente ou acrescente outros.',
      complete: _selecionados.isNotEmpty || _novosEquipamentos.isNotEmpty,
      lockedReason: _origem == null
          ? 'Escolha a origem do atendimento primeiro.'
          : _origem == WalkInOrigin.existing && clienteId == null
          ? 'Escolha o cliente primeiro.'
          : _origem == WalkInOrigin.fresh && _nome.text.trim().length < 2
          ? 'Informe o nome do novo cliente primeiro.'
          : null,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (podeListar)
            _ParqueDoCliente(
              customerId: clienteId,
              selecionados: _selecionados,
              onAlternar: (id) => setState(() {
                if (!_selecionados.remove(id)) _selecionados.add(id);
              }),
            ),

          if (_novosEquipamentos.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.ms),
            Text(
              'Identificados agora',
              style: OrbitType.sectionTitle.copyWith(color: context.orbit.ink),
            ),
            const SizedBox(height: OrbitSpacing.xs),
            for (final (indice, equipamento) in _novosEquipamentos.indexed)
              _NovoEquipamentoCard(
                key: ValueKey('walk-in.equipment.$indice'),
                equipamento: equipamento,
                onRemove: () =>
                    setState(() => _novosEquipamentos.removeAt(indice)),
              ),
          ],

          const SizedBox(height: OrbitSpacing.ms),
          OutlinedButton.icon(
            onPressed: () async {
              final novo = await showWalkInEquipmentSheet(context);
              if (novo != null && mounted) {
                setState(() => _novosEquipamentos.add(novo));
              }
            },
            icon: const Icon(Icons.add, size: 18),
            label: const Text('Acrescentar equipamento'),
          ),

          const SizedBox(height: OrbitSpacing.sm),
          Text(
            _origem == WalkInOrigin.fresh
                ? 'Adicione ao menos um equipamento. Somente o nome é obrigatório.'
                : 'Você pode abrir sem selecionar equipamentos e identificá-los durante a execução.',
            style: OrbitType.caption.copyWith(color: context.orbit.inkSubtle),
          ),
        ],
      ),
    );
  }

  OrbitWizardStep _etapaAtendimento() {
    final rascunho = _rascunho;
    return OrbitWizardStep(
      title: 'Atendimento',
      hint: 'O que foi chamado para fazer.',
      child: _FormularioDoAtendimento(
        natureza: _natureza,
        prioridade: _prioridade,
        titulo: _titulo,
        descricao: _descricao,
        setor: _setor,
        onNatureza: (valor) => setState(() => _natureza = valor),
        onPrioridade: (valor) => setState(() => _prioridade = valor),
        bloqueio: rascunho.blockedReason,
      ),
      forward: OrbitWizardForward(
        label: 'Abrir atendimento',
        enabled: rascunho.isReady && !_abrindo,
        pending: _abrindo,
        onPressed: _abrir,
      ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* A carteira                                                          */
/* ------------------------------------------------------------------ */

class _NovoEquipamentoCard extends StatelessWidget {
  const _NovoEquipamentoCard({
    super.key,
    required this.equipamento,
    required this.onRemove,
  });

  final WalkInEquipmentDraft equipamento;
  final VoidCallback onRemove;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final details = [
      equipamento.manufacturer,
      equipamento.model,
      equipamento.location,
    ].where((value) => value?.trim().isNotEmpty ?? false).join(' · ');
    return Padding(
      padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
      child: OrbitCard(
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Container(
              padding: const EdgeInsets.all(OrbitSpacing.sm),
              decoration: BoxDecoration(
                color: palette.accentSoft,
                borderRadius: OrbitRadius.field,
              ),
              child: Icon(
                Icons.home_repair_service_outlined,
                color: palette.accentStrong,
                size: 24,
              ),
            ),
            const SizedBox(width: OrbitSpacing.ms),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    equipamento.name,
                    style: OrbitType.body.copyWith(
                      color: palette.ink,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  if (details.isNotEmpty) ...[
                    const SizedBox(height: OrbitSpacing.xs),
                    Text(
                      details,
                      style: OrbitType.caption.copyWith(
                        color: palette.inkMuted,
                      ),
                    ),
                  ],
                  const SizedBox(height: OrbitSpacing.sm),
                  const OrbitStatusBadge(
                    label: 'Novo equipamento',
                    tone: OrbitTone.info,
                  ),
                ],
              ),
            ),
            IconButton(
              tooltip: 'Remover ${equipamento.name}',
              icon: Icon(Icons.close, size: 20, color: palette.inkSubtle),
              onPressed: onRemove,
            ),
          ],
        ),
      ),
    );
  }
}

class _Carteira extends ConsumerWidget {
  const _Carteira({
    required this.busca,
    required this.termo,
    required this.escolhido,
    required this.onBuscar,
    required this.onEscolher,
  });

  final TextEditingController busca;
  final String termo;
  final WalkInCustomerContract? escolhido;
  final ValueChanged<String> onBuscar;
  final ValueChanged<WalkInCustomerContract> onEscolher;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final clientes = ref.watch(walkInCustomersProvider(termo));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        TextField(
          controller: busca,
          onChanged: onBuscar,
          textInputAction: TextInputAction.search,
          decoration: const InputDecoration(
            hintText: 'Nome, nome fantasia ou documento',
            prefixIcon: Icon(Icons.search, size: 20),
            isDense: true,
          ),
        ),
        const SizedBox(height: OrbitSpacing.ms),
        clientes.when(
          loading: () => const SectionLoading(lines: 4),
          error: (error, _) => SectionError(
            error: error,
            onRetry: () => ref.invalidate(walkInCustomersProvider(termo)),
          ),
          data: (lista) => lista.isEmpty
              ? OrbitEmptyState(
                  icon: Icons.person_off_outlined,
                  title: termo.isEmpty
                      ? 'Carteira vazia'
                      : 'Nenhum cliente encontrado',
                  description: termo.isEmpty
                      ? 'Nenhum cliente cadastrado nesta organização.'
                      : 'Ajuste a busca, ou volte e cadastre um cliente novo.',
                )
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    for (final cliente in lista)
                      Padding(
                        padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
                        child: WalkInChoiceTile(
                          title: cliente.displayName,
                          description: [
                            if (cliente.documentNumber?.isNotEmpty ?? false)
                              cliente.documentNumber!,
                            if (cliente.addresses.isNotEmpty)
                              cliente.addresses.first.oneLine,
                          ].join(' · '),
                          selected: escolhido?.id == cliente.id,
                          onTap: () => onEscolher(cliente),
                        ),
                      ),
                  ],
                ),
        ),

        /// O ponto de referência do endereço escolhido.
        ///
        /// É o que leva o técnico ao lugar certo — e é justamente o que uma
        /// linha de endereço formatada esconde.
        if (escolhido?.addresses.isNotEmpty ?? false)
          if (escolhido!.addresses.first.reference case final String nota)
            Padding(
              padding: const EdgeInsets.only(top: OrbitSpacing.sm),
              child: Text(
                'Referência: $nota',
                style: OrbitType.caption.copyWith(
                  color: context.orbit.inkMuted,
                ),
              ),
            ),
      ],
    );
  }
}

class _ParqueDoCliente extends ConsumerWidget {
  const _ParqueDoCliente({
    required this.customerId,
    required this.selecionados,
    required this.onAlternar,
  });

  final String customerId;
  final Set<String> selecionados;
  final ValueChanged<String> onAlternar;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final equipamentos = ref.watch(walkInEquipmentProvider(customerId));

    return equipamentos.when(
      loading: () => const SectionLoading(lines: 3),
      error: (error, _) => SectionError(
        error: error,
        onRetry: () => ref.invalidate(walkInEquipmentProvider(customerId)),
      ),
      data: (lista) => lista.isEmpty
          ? const OrbitEmptyState(
              icon: Icons.hvac_outlined,
              title: 'Nenhum equipamento cadastrado',
              description:
                  'Este cliente não tem aparelhos no parque. Acrescente abaixo '
                  'o que você encontrou no local.',
            )
          : Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                for (final equipamento in lista)
                  CheckboxListTile(
                    value: selecionados.contains(equipamento.id),
                    onChanged: (_) => onAlternar(equipamento.id),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                    title: Text(
                      equipamento.name,
                      style: OrbitType.body.copyWith(color: context.orbit.ink),
                    ),
                    subtitle: equipamento.subtitle.isEmpty
                        ? null
                        : Text(
                            equipamento.subtitle,
                            style: OrbitType.caption.copyWith(
                              color: context.orbit.inkSubtle,
                            ),
                          ),
                  ),
              ],
            ),
    );
  }
}

/* ------------------------------------------------------------------ */
/* Formulários                                                         */
/* ------------------------------------------------------------------ */

class _FormularioDeCliente extends StatelessWidget {
  const _FormularioDeCliente({
    required this.tipo,
    required this.onTipo,
    required this.nome,
    required this.fantasia,
    required this.documento,
    required this.email,
    required this.telefone,
    required this.contato,
    required this.cep,
    required this.rua,
    required this.numero,
    required this.complemento,
    required this.bairro,
    required this.cidade,
    required this.uf,
    required this.referencia,
    required this.consultandoDocumento,
    required this.consultandoCep,
    required this.avisoDocumento,
    required this.avisoCep,
    required this.onDocumentoMudou,
    required this.onCepMudou,
    required this.onConsultarDocumento,
    required this.onConsultarCep,
    required this.onMudou,
  });

  final String tipo;
  final ValueChanged<String> onTipo;
  final TextEditingController nome;
  final TextEditingController fantasia;
  final TextEditingController documento;
  final TextEditingController email;
  final TextEditingController telefone;
  final TextEditingController contato;
  final TextEditingController cep;
  final TextEditingController rua;
  final TextEditingController numero;
  final TextEditingController complemento;
  final TextEditingController bairro;
  final TextEditingController cidade;
  final TextEditingController uf;
  final TextEditingController referencia;
  final bool consultandoDocumento;
  final bool consultandoCep;
  final String? avisoDocumento;
  final String? avisoCep;
  final ValueChanged<String> onDocumentoMudou;
  final ValueChanged<String> onCepMudou;
  final VoidCallback onConsultarDocumento;
  final VoidCallback onConsultarCep;
  final VoidCallback onMudou;

  bool get _pessoaFisica => tipo == 'INDIVIDUAL';

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        WalkInTypeToggle(value: tipo, onChanged: onTipo),

        WalkInField(
          label: _pessoaFisica ? 'CPF' : 'CNPJ',
          controller: documento,
          hint: _pessoaFisica ? '000.000.000-00' : '00.000.000/0000-00',
          keyboardType: TextInputType.number,
          inputFormatters: [DocumentInputFormatter(individual: _pessoaFisica)],
          onChanged: onDocumentoMudou,
          /* A consulta existe só para empresa: não há cadastro público de CPF
             que o produto possa consultar, e um botão que nunca funciona é
             pior que nenhum. */
          suffix: _pessoaFisica
              ? null
              : consultandoDocumento
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : IconButton(
                  tooltip: 'Buscar dados do CNPJ',
                  icon: const Icon(Icons.travel_explore, size: 20),
                  onPressed: onConsultarDocumento,
                ),
          helper: _pessoaFisica
              ? null
              : 'Ao completar o CNPJ, os dados são buscados automaticamente.',
        ),

        if (avisoDocumento != null)
          Padding(
            padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
            child: Text(
              avisoDocumento!,
              style: OrbitType.caption.copyWith(color: palette.warning),
            ),
          ),

        WalkInField(
          label: _pessoaFisica ? 'Nome' : 'Razão social',
          controller: nome,
          maxLength: 255,
          hint: _pessoaFisica ? 'Maria Souza' : 'Clima Norte LTDA',
          onChanged: (_) => onMudou(),
        ),

        if (!_pessoaFisica)
          WalkInField(
            label: 'Nome fantasia',
            controller: fantasia,
            maxLength: 255,
            hint: 'Como a equipe chama o cliente',
          ),

        WalkInField(
          label: 'Telefone',
          controller: telefone,
          maxLength: 32,
          hint: '(81) 99999-9999',
          keyboardType: TextInputType.phone,
        ),
        WalkInField(
          label: 'E-mail',
          controller: email,
          maxLength: 320,
          keyboardType: TextInputType.emailAddress,
          textCapitalization: TextCapitalization.none,
        ),
        WalkInField(
          label: 'Quem atende no local',
          controller: contato,
          maxLength: 180,
          hint: 'Nome de quem recebeu você',
        ),

        const SizedBox(height: OrbitSpacing.sm),
        Text(
          'Endereço',
          style: OrbitType.sectionTitle.copyWith(color: palette.ink),
        ),
        const SizedBox(height: OrbitSpacing.xs),

        WalkInField(
          label: 'CEP',
          controller: cep,
          hint: '00000-000',
          keyboardType: TextInputType.number,
          inputFormatters: const [PostalCodeInputFormatter()],
          onChanged: onCepMudou,
          helper:
              'Ao completar o CEP, o endereço é preenchido automaticamente.',
          suffix: consultandoCep
              ? const Padding(
                  padding: EdgeInsets.all(12),
                  child: SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                )
              : IconButton(
                  tooltip: 'Buscar endereço do CEP',
                  icon: const Icon(Icons.travel_explore, size: 20),
                  onPressed: onConsultarCep,
                ),
        ),
        if (avisoCep != null)
          Padding(
            padding: const EdgeInsets.only(bottom: OrbitSpacing.sm),
            child: Text(
              avisoCep!,
              style: OrbitType.caption.copyWith(color: palette.warning),
            ),
          ),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 3,
              child: WalkInField(label: 'Rua', controller: rua, maxLength: 255),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: WalkInField(
                label: 'Número',
                controller: numero,
                maxLength: 40,
              ),
            ),
          ],
        ),
        WalkInField(
          label: 'Complemento',
          controller: complemento,
          maxLength: 180,
        ),
        WalkInField(label: 'Bairro', controller: bairro, maxLength: 180),
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              flex: 3,
              child: WalkInField(
                label: 'Cidade',
                controller: cidade,
                maxLength: 180,
              ),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: WalkInField(
                label: 'UF',
                controller: uf,
                maxLength: 2,
                textCapitalization: TextCapitalization.characters,
              ),
            ),
          ],
        ),
        WalkInField(
          label: 'Ponto de referência',
          controller: referencia,
          maxLength: 255,
          hint: 'Portão azul ao lado da padaria',
          maxLines: 2,
          helper: 'É o que leva o próximo técnico ao lugar certo.',
        ),
      ],
    );
  }
}

class _FormularioDoAtendimento extends StatelessWidget {
  const _FormularioDoAtendimento({
    required this.natureza,
    required this.prioridade,
    required this.titulo,
    required this.descricao,
    required this.setor,
    required this.onNatureza,
    required this.onPrioridade,
    required this.bloqueio,
  });

  final String natureza;
  final String prioridade;
  final TextEditingController titulo;
  final TextEditingController descricao;
  final TextEditingController setor;
  final ValueChanged<String> onNatureza;
  final ValueChanged<String> onPrioridade;
  final String? bloqueio;

  static const _naturezas = <String, String>{
    'MAINTENANCE': 'Manutenção',
    'INSTALLATION': 'Instalação',
    'INSPECTION': 'Inspeção',
    'DELIVERY': 'Entrega',
    'OTHER': 'Outro',
  };

  static const _prioridades = <String, String>{
    'LOW': 'Baixa',
    'NORMAL': 'Normal',
    'HIGH': 'Alta',
    'URGENT': 'Urgente',
  };

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text(
          'Natureza',
          style: OrbitType.caption.copyWith(color: palette.inkSubtle),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: OrbitSpacing.sm,
          runSpacing: OrbitSpacing.xs,
          children: [
            for (final entrada in _naturezas.entries)
              ChoiceChip(
                label: Text(entrada.value),
                selected: natureza == entrada.key,
                onSelected: (_) => onNatureza(entrada.key),
              ),
          ],
        ),
        const SizedBox(height: OrbitSpacing.ms),

        Text(
          'Prioridade',
          style: OrbitType.caption.copyWith(color: palette.inkSubtle),
        ),
        const SizedBox(height: 6),
        Wrap(
          spacing: OrbitSpacing.sm,
          runSpacing: OrbitSpacing.xs,
          children: [
            for (final entrada in _prioridades.entries)
              ChoiceChip(
                label: Text(entrada.value),
                selected: prioridade == entrada.key,
                onSelected: (_) => onPrioridade(entrada.key),
              ),
          ],
        ),
        const SizedBox(height: OrbitSpacing.ms),

        WalkInField(
          label: 'Título',
          controller: titulo,
          hint: 'Deixe em branco para usar o nome do cliente',
        ),
        WalkInField(
          label: 'O que o cliente pediu',
          controller: descricao,
          hint: 'Ar do quarto não está gelando',
          maxLines: 4,
        ),
        WalkInField(
          label: 'Setor',
          controller: setor,
          hint: 'Recepção, sala 2, cobertura',
        ),

        if (bloqueio case final String motivo)
          Padding(
            padding: const EdgeInsets.only(top: OrbitSpacing.sm),
            child: Text(
              motivo,
              style: OrbitType.caption.copyWith(color: palette.warning),
            ),
          ),
      ],
    );
  }
}
