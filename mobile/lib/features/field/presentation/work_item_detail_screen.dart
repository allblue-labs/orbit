/// O contexto de um item de trabalho.
///
/// Uma requisição (`GET /mobile/field/work-items/:id`) traz tudo: o item,
/// o pedido do cliente, os procedimentos, os documentos e a equipe. Montar
/// isso a partir de várias APIs reconstruiria no aparelho o recorte que o
/// servidor já fez — e cada pedaço chegaria de um instante diferente.
///
/// ## Duas ações, não a lista inteira
///
/// A tela desenhava um botão para **cada** item de `allowedActions`. O resultado
/// era uma pilha de botões soltos — "Abrir", "Registrar evidência", "Ler
/// etiqueta" — alguns desabilitados, nenhum em destaque, e o único que
/// importava perdido no meio. Quem chega aqui quer fazer uma de duas coisas:
/// começar o atendimento, ou avisar que não dá para fazê-lo.
///
/// `allowedActions` continua mandando — é ele que diz se iniciar e se pedir o
/// cancelamento estão liberados. O que mudou é que a tela deixou de tratar a
/// lista como um menu: as outras ações têm lugar próprio no roteiro de execução,
/// que é onde fazem sentido.
///
/// ## Antes de agir, o contexto inteiro
///
/// Para quem, onde — com complemento e ponto de referência —, telefone, tipo,
/// quem está escalado, quando e, se o responsável liberou, quanto vale. Faltando
/// isso, o técnico ligava para o escritório para perguntar o que a tela já
/// poderia ter dito.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../../app/providers.dart';
import '../../../core/contracts/mobile_field_contracts.dart';
import '../../../core/presentation/field_registry.dart';
import '../../../core/presentation/orbit_format.dart';
import '../../../core/routing/orbit_router.dart';
import '../../../core/theme/orbit_theme.dart';
import '../../../core/widgets/section_states.dart';
import '../application/field_providers.dart';
import 'widgets/cancellation_sheet.dart';
import 'widgets/work_item_row.dart';

class WorkItemDetailScreen extends ConsumerWidget {
  const WorkItemDetailScreen({super.key, required this.workItemId});

  final String workItemId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final context$ = ref.watch(fieldWorkItemProvider(workItemId));
    final session = ref.watch(sessionProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Atendimento')),
      body: RefreshIndicator(
        onRefresh: () async =>
            ref.invalidate(fieldWorkItemProvider(workItemId)),
        child: context$.when(
          loading: () => const Padding(
            padding: EdgeInsets.all(OrbitSpacing.gutter),
            child: SectionLoading(lines: 6),
          ),
          error: (error, _) => ListView(
            padding: const EdgeInsets.all(OrbitSpacing.gutter),
            children: [
              SectionError(
                error: error,
                onRetry: () =>
                    ref.invalidate(fieldWorkItemProvider(workItemId)),
              ),
            ],
          ),
          data: (value) => value == null
              ? ListView(
                  padding: const EdgeInsets.all(OrbitSpacing.gutter),
                  children: const [
                    SectionEmpty(
                      icon: Icons.search_off,
                      message: 'Este item não está mais disponível.',
                    ),
                  ],
                )
              : _Detail(context$: value, currentUserId: session?.user.id),
        ),
      ),
    );
  }
}

class _Detail extends StatelessWidget {
  const _Detail({required this.context$, required this.currentUserId});

  final MobileFieldContextContract context$;
  final String? currentUserId;

  @override
  Widget build(BuildContext context) {
    final item = context$.workItem;
    final assignment = assignmentOf(item, currentUserId);

    return ListView(
      padding: const EdgeInsets.all(OrbitSpacing.gutter),
      children: [
        _Capa(item: item, assignment: assignment),

        if (item.pendingCancellation
            case final MobilePendingCancellationContract pedido)
          _PedidoEnviado(pedido: pedido),

        _Onde(item: item),

        if (item.customer case final MobileCustomerSummaryContract cliente)
          _ClienteEContato(cliente: cliente),

        if (context$.financialSummary
            case final MobileFinancialSummaryContract financeiro)
          _Valor(financeiro: financeiro),

        if (context$.requestDescription case final String descricao
            when descricao.trim().isNotEmpty)
          _Bloco(
            titulo: 'O que foi pedido',
            child: Text(descricao, style: const TextStyle(fontSize: 14)),
          ),

        if (item.equipmentSummary.isNotEmpty) _Equipamentos(item: item),

        _Team(item: item),

        if (context$.procedures.isNotEmpty)
          _Bloco(
            titulo: 'Procedimentos',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final procedimento in context$.procedures)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 4),
                    child: Text(
                      procedimento.title,
                      style: const TextStyle(fontSize: 13),
                    ),
                  ),
              ],
            ),
          ),

        _Actions(item: item),
      ],
    );
  }
}

/// O cartão que responde, de relance: o quê, de que tipo e quando.
///
/// Era um cartão quase vazio — título e duas etiquetas — com a data perdida
/// numa linha genérica mais abaixo, do mesmo peso que o resto. Quem abre esta
/// tela está decidindo se vai agora; a hora é a informação que decide isso.
class _Capa extends StatelessWidget {
  const _Capa({required this.item, required this.assignment});

  final MobileWorkItemContract item;
  final FieldAssignment assignment;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final status = operationalStatusLabel(item.operationalStatus);

    return _Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            [
              item.navigationContext.sourceId.isEmpty
                  ? workItemKindLabel(item.kind)
                  : workItemKindLabel(item.kind),
              item.serviceType,
            ].whereType<String>().join(' · ').toUpperCase(),
            style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: 4),
          Text(
            item.title,
            style: OrbitType.sectionTitle.copyWith(color: palette.ink),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          Wrap(
            spacing: OrbitSpacing.xs,
            runSpacing: 6,
            children: [
              _Tag(label: dueStateLabel(item.dueState)),
              if (status != null) _Tag(label: status),
              if (assignment != FieldAssignment.none)
                _Tag(label: assignmentLabel(assignment)),
            ],
          ),

          const Divider(height: OrbitSpacing.lg),

          /// A hora, no tamanho que ela merece.
          Row(
            children: [
              Icon(
                Icons.event_outlined,
                size: 18,
                color: palette.accentStrong,
              ),
              const SizedBox(width: OrbitSpacing.sm),
              Expanded(
                child: Text(
                  item.scheduledFor == null
                      ? 'Sem data programada'
                      : OrbitFormat.dateHourOf(item.scheduledFor),
                  style: OrbitType.body.copyWith(
                    color: palette.ink,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Para onde ir — escrito como endereço, não como formulário.
///
/// Cada parte vinha numa linha própria com ícone e rótulo: cinco linhas para um
/// endereço, e o logradouro com o mesmo peso do CEP. Quem está dirigindo lê um
/// endereço em bloco, como no envelope.
///
/// Complemento, local interno e ponto de referência ficam **abaixo** e
/// destacados: são eles que decidem se a pessoa acha a portaria, e some quando
/// não foram cadastrados.
class _Onde extends StatelessWidget {
  const _Onde({required this.item});

  final MobileWorkItemContract item;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final endereco = item.serviceAddress;
    final solto = endereco == null ? locationText(item) : null;
    if (endereco == null && solto == null) return const SizedBox.shrink();

    return _Bloco(
      titulo: 'Onde',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (endereco != null) ...[
            if (endereco.label case final String apelido)
              Text(
                apelido,
                style: OrbitType.caption.copyWith(color: palette.inkMuted),
              ),
            Text(
              [
                endereco.street,
                if (endereco.number case final String numero) numero,
              ].join(', '),
              style: OrbitType.body.copyWith(
                color: palette.ink,
                fontWeight: FontWeight.w600,
              ),
            ),
            Text(
              [
                endereco.district,
                [
                  endereco.city,
                  endereco.stateCode,
                ].whereType<String>().where((v) => v.isNotEmpty).join(' - '),
                endereco.postalCode,
              ].whereType<String>().where((v) => v.isNotEmpty).join(' · '),
              style: OrbitType.body.copyWith(color: palette.inkMuted),
            ),

            if (endereco.complement != null ||
                endereco.sector != null ||
                endereco.reference != null) ...[
              const SizedBox(height: OrbitSpacing.sm),
              if (endereco.complement case final String complemento)
                _Acesso(icone: Icons.meeting_room_outlined, texto: complemento),
              if (endereco.sector case final String setor)
                _Acesso(icone: Icons.pin_drop_outlined, texto: setor),
              if (endereco.reference case final String referencia)
                _Acesso(
                  icone: Icons.info_outline,
                  texto: referencia,
                  destaque: true,
                ),
            ],
          ] else
            Text(solto!, style: OrbitType.body.copyWith(color: palette.ink)),
        ],
      ),
    );
  }
}

/// Uma instrução de acesso: complemento, local interno, ponto de referência.
///
/// O ponto de referência vai destacado porque é o que evita a ligação para o
/// escritório — e porque, numa lista de linhas iguais, ele se perde.
class _Acesso extends StatelessWidget {
  const _Acesso({
    required this.icone,
    required this.texto,
    this.destaque = false,
  });

  final IconData icone;
  final String texto;
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Container(
        padding: destaque
            ? const EdgeInsets.all(OrbitSpacing.sm)
            : EdgeInsets.zero,
        decoration: destaque
            ? BoxDecoration(
                color: palette.accentSoft,
                borderRadius: OrbitRadius.chip,
              )
            : null,
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              icone,
              size: 16,
              color: destaque ? palette.accentStrong : palette.inkSubtle,
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: Text(
                texto,
                style: OrbitType.body.copyWith(
                  color: destaque ? palette.accentStrong : palette.inkMuted,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Quem contratou, e por qual número falar.
class _ClienteEContato extends StatelessWidget {
  const _ClienteEContato({required this.cliente});

  final MobileCustomerSummaryContract cliente;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final contato = cliente.contact;

    return _Bloco(
      titulo: 'Cliente',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            cliente.name,
            style: OrbitType.body.copyWith(
              color: palette.ink,
              fontWeight: FontWeight.w600,
            ),
          ),
          if (contato != null) ...[
            const SizedBox(height: 2),
            Text(
              [
                contato.name,
                contato.phone,
              ].whereType<String>().where((v) => v.isNotEmpty).join(' · '),
              style: OrbitType.body.copyWith(color: palette.inkMuted),
            ),
          ],
        ],
      ),
    );
  }
}

/// Quanto vale — só quando o responsável liberou para o campo.
///
/// A seção **não existe** quando não há liberação, em vez de mostrar traço ou
/// zero: ausência é a única forma de não afirmar nada sobre o valor.
class _Valor extends StatelessWidget {
  const _Valor({required this.financeiro});

  final MobileFinancialSummaryContract financeiro;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final valor = double.tryParse(financeiro.approvedAmount ?? '');
    if (valor == null) return const SizedBox.shrink();

    return _Bloco(
      titulo: 'Valor do atendimento',
      child: Text(
        OrbitFormat.currency(valor),
        style: OrbitType.sectionTitle.copyWith(color: palette.ink),
      ),
    );
  }
}

class _Equipamentos extends StatelessWidget {
  const _Equipamentos({required this.item});

  final MobileWorkItemContract item;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return _Bloco(
      titulo: item.equipmentSummary.length == 1
          ? 'Equipamento'
          : 'Equipamentos',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final equipamento in item.equipmentSummary)
            Padding(
              padding: const EdgeInsets.only(bottom: 6),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    equipamento.name,
                    style: OrbitType.body.copyWith(color: palette.ink),
                  ),
                  Text(
                    [equipamento.code, equipamento.type, equipamento.sector]
                        .whereType<String>()
                        .where((v) => v.isNotEmpty)
                        .join(' · '),
                    style: OrbitType.caption.copyWith(
                      color: palette.inkMuted,
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

/// Um bloco de conteúdo com título discreto.
///
/// Substitui o `SectionBlock` nesta tela: ele desenhava o título em maiúsculas
/// **fora** do cartão, e com seis seções a tela virava uma escada de rótulos
/// cinzentos com cartões brancos entre eles. Aqui o título mora dentro, e o
/// cartão é a unidade visual.
class _Bloco extends StatelessWidget {
  const _Bloco({required this.titulo, required this.child});

  final String titulo;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return _Cartao(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            titulo.toUpperCase(),
            style: OrbitType.eyebrow.copyWith(color: palette.inkSubtle),
          ),
          const SizedBox(height: OrbitSpacing.sm),
          child,
        ],
      ),
    );
  }
}

class _Cartao extends StatelessWidget {
  const _Cartao({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: OrbitSpacing.md),
    child: Container(
      width: double.infinity,
      padding: const EdgeInsets.all(OrbitSpacing.md),
      decoration: BoxDecoration(
        color: context.orbit.surface,
        borderRadius: OrbitRadius.card,
        boxShadow: OrbitShadow.card,
      ),
      child: child,
    ),
  );
}

/// O relato já enviado, esperando decisão.
///
/// Ocupa o lugar do botão de cancelar. Sem isto o técnico pediria de novo a cada
/// vez que abrisse o atendimento, sem sinal de que o primeiro chegou.
class _PedidoEnviado extends StatelessWidget {
  const _PedidoEnviado({required this.pedido});

  final MobilePendingCancellationContract pedido;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return _Bloco(
      titulo: 'Cancelamento pedido',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            'Enviado em ${OrbitFormat.dateHourOf(pedido.requestedAt)}. '
            'O responsável decide se remarca, troca o técnico ou cancela.',
            style: OrbitType.body.copyWith(color: palette.inkMuted),
          ),
          if (pedido.reason.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.sm),
            Text(
              pedido.reason,
              style: OrbitType.body.copyWith(color: palette.ink),
            ),
          ],
        ],
      ),
    );
  }
}

/// Responsável e auxiliares, com os termos do domínio.
class _Team extends StatelessWidget {
  const _Team({required this.item});

  final MobileWorkItemContract item;

  @override
  Widget build(BuildContext context) {
    final responsible = item.responsibleFieldTechnician;
    final auxiliaries = item.auxiliaryTechnicians;
    if (responsible == null && auxiliaries.isEmpty) {
      return const SizedBox.shrink();
    }

    return SectionBlock(
      inset: 0,
      title: 'Equipe',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (responsible != null) ...[
            const Text(
              'Técnico em Campo',
              style: TextStyle(fontSize: 12, color: OrbitColors.textSecondary),
            ),
            Text(
              responsible.name,
              style: const TextStyle(
                fontSize: 14,
                color: OrbitColors.textPrimary,
              ),
            ),
          ],
          if (auxiliaries.isNotEmpty) ...[
            const SizedBox(height: OrbitSpacing.sm),
            const Text(
              auxiliaryTechniciansLabel,
              style: TextStyle(fontSize: 12, color: OrbitColors.textSecondary),
            ),
            Text(
              auxiliaries.map((person) => person.name).join(', '),
              style: const TextStyle(
                fontSize: 14,
                color: OrbitColors.textPrimary,
              ),
            ),
          ],
        ],
      ),
    );
  }
}

/// As duas ações do atendimento: começar, ou avisar que não dá.
///
/// ## Por que duas, e não a lista publicada
///
/// Esta seção desenhava um botão por item de `allowedActions`. Dava uma pilha de
/// botões soltos — "Abrir", "Registrar evidência", "Ler etiqueta" —, parte deles
/// desabilitada com um aviso, nenhum em destaque. As outras ações têm lugar
/// próprio no roteiro de execução, que é onde elas fazem sentido; aqui só cabem
/// as duas decisões que se toma antes de entrar.
///
/// O servidor continua mandando: `START`/`RESUME` e `REQUEST_CANCELLATION` são
/// publicados por ele, e sem a ação na lista o botão não aparece.
class _Actions extends ConsumerWidget {
  const _Actions({required this.item});

  final MobileWorkItemContract item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final iniciar = _iniciar(context, item);
    final podePedirCancelamento =
        item.allowedActions.contains(MobileFieldAction.requestCancellation) &&
        item.pendingCancellation == null;

    if (iniciar == null && !podePedirCancelamento) {
      return const SizedBox.shrink();
    }

    final retomando = item.allowedActions.contains(MobileFieldAction.resume);

    return SectionBlock(
      inset: 0,
      title: 'Ações',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (iniciar != null)
            FilledButton(
              onPressed: iniciar,
              style: FilledButton.styleFrom(minimumSize: const Size(0, 48)),
              child: Text(
                retomando ? 'Continuar o Atendimento' : 'Iniciar o Atendimento',
              ),
            ),

          if (iniciar != null && podePedirCancelamento)
            const SizedBox(height: OrbitSpacing.sm),

          if (podePedirCancelamento)
            OutlinedButton(
              onPressed: () => _pedirCancelamento(context, ref),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size(0, 48),
                foregroundColor: context.orbit.danger,
              ),
              child: const Text('Cancelar o Atendimento'),
            ),

          if (podePedirCancelamento)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                'Avisa o responsável. Ele decide se remarca, troca o técnico '
                'ou cancela de fato.',
                style: OrbitType.caption.copyWith(
                  color: context.orbit.inkSubtle,
                ),
              ),
            ),
        ],
      ),
    );
  }

  Future<void> _pedirCancelamento(BuildContext context, WidgetRef ref) async {
    /* Só atendimento avulso tem operação a cancelar; PMOC e visita não
       publicam a ação, e esta guarda é a que mantém a promessa. */
    if (item.kind != MobileWorkItemKind.serviceOperation) return;

    final enviado = await showCancellationSheet(
      context,
      operationId: item.navigationContext.sourceId,
    );
    if (!enviado) return;

    /* Recarrega para a tela trocar o botão pelo relato enviado — é o sinal de
       que o pedido chegou. */
    ref.invalidate(fieldWorkItemProvider(item.id));
  }
}

/// Para onde este item começa, se começa.
///
/// Atendimento avulso vai para a execução da operação; PMOC vai para o
/// atendimento **do equipamento** naquele ciclo — rotas diferentes porque são
/// domínios diferentes, com contagem, documento e autoridade próprios.
///
/// Visita técnica continua em leitura: a PR dela ainda não existe, e devolver
/// `null` tira o botão em vez de prometer o que não cumpre.
VoidCallback? _iniciar(BuildContext context, MobileWorkItemContract item) {
  final comecar =
      item.allowedActions.contains(MobileFieldAction.start) ||
      item.allowedActions.contains(MobileFieldAction.resume);
  if (!comecar) return null;

  final navegacao = item.navigationContext;

  switch (item.kind) {
    case MobileWorkItemKind.serviceOperation:
      return () =>
          context.push(OrbitRoutes.operationExecution(navegacao.sourceId));

    case MobileWorkItemKind.pmoc:
      /* Os três identificadores ou nenhum: a rota de atendimento é escopada por
         plano, ciclo e equipamento, e montá-la com um vazio levaria a uma tela
         que só sabe dizer "não encontrado". */
      final planId = navegacao.planId;
      final cycleId = navegacao.cycleId;
      final assetId = navegacao.equipmentId;
      if (planId == null || cycleId == null || assetId == null) return null;
      return () => context.push(
        OrbitRoutes.pmocAttendance(
          planId: planId,
          cycleId: cycleId,
          assetId: assetId,
        ),
      );

    case MobileWorkItemKind.rvt:
      return null;
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: OrbitColors.surface,
      borderRadius: OrbitRadius.pill,
    ),
    child: Text(
      label,
      style: const TextStyle(fontSize: 11, color: OrbitColors.textSecondary),
    ),
  );
}
