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
import '../../../core/contracts/field_operation_contracts.dart';
import '../application/execution_controller.dart';
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
              /// O pedido de cancelamento vem primeiro e em destaque.
              ///
              /// A situação do atendimento **não** muda ao pedir — quem decide
              /// é o responsável, e o compromisso segue de pé até lá. Mas
              /// deixar a etiqueta dizendo só "Programado" fazia o pedido
              /// parecer que não aconteceu. O estado real é este: programado,
              /// e aguardando uma decisão sobre o cancelamento.
              if (item.pendingCancellation != null)
                const _Tag(
                  label: 'Aguardando cancelamento',
                  enfase: true,
                ),
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

            const SizedBox(height: OrbitSpacing.sm),

            /// As três instruções de acesso aparecem **sempre**.
            ///
            /// Escondê-las quando vazias dizia duas coisas diferentes com o
            /// mesmo silêncio: "não há complemento" e "ninguém cadastrou" ficam
            /// idênticos na tela. Quem chega na portaria precisa saber em qual
            /// dos dois está — no primeiro procura a porta, no segundo liga.
            _Acesso(
              icone: Icons.meeting_room_outlined,
              rotulo: 'Complemento',
              texto: endereco.complement,
            ),
            _Acesso(
              icone: Icons.pin_drop_outlined,
              rotulo: 'Local no endereço',
              texto: endereco.sector,
            ),
            _Acesso(
              icone: Icons.info_outline,
              rotulo: 'Ponto de referência',
              texto: endereco.reference,
              destaque: true,
            ),
          ] else if (solto != null)
            Text(solto, style: OrbitType.body.copyWith(color: palette.ink))
          else
            const _NaoInformado(rotulo: 'Endereço'),
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
    required this.rotulo,
    required this.texto,
    this.destaque = false,
  });

  final IconData icone;

  /// O nome do campo. Só aparece quando não há valor — preenchido, o ícone já
  /// diz o que é, e o rótulo roubaria a linha do conteúdo.
  final String rotulo;

  final String? texto;

  /// O ponto de referência vai realçado quando existe: é o que evita a ligação
  /// para o escritório, e numa lista de linhas iguais ele se perde. Vazio, não
  /// há o que realçar — destacar uma ausência seria dar-lhe a ênfase que o
  /// conteúdo teria.
  final bool destaque;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final valor = texto?.trim();
    final vazio = valor == null || valor.isEmpty;
    final realcar = destaque && !vazio;

    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Container(
        padding: realcar
            ? const EdgeInsets.all(OrbitSpacing.sm)
            : EdgeInsets.zero,
        decoration: realcar
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
              color: realcar
                  ? palette.accentStrong
                  : (vazio ? palette.inkDisabled : palette.inkSubtle),
            ),
            const SizedBox(width: OrbitSpacing.sm),
            Expanded(
              child: vazio
                  ? Text(
                      '$rotulo não informado',
                      style: OrbitType.body.copyWith(
                        color: palette.inkDisabled,
                      ),
                    )
                  : Text(
                      valor,
                      style: OrbitType.body.copyWith(
                        color: realcar
                            ? palette.accentStrong
                            : palette.inkMuted,
                      ),
                    ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Um campo inteiro que ninguém cadastrou.
///
/// Dito, e não omitido: o silêncio não distingue "não se aplica" de "falta
/// cadastrar", e quem está em campo precisa saber em qual dos dois está.
class _NaoInformado extends StatelessWidget {
  const _NaoInformado({required this.rotulo});

  final String rotulo;

  @override
  Widget build(BuildContext context) => Text(
    '$rotulo não informado',
    style: OrbitType.body.copyWith(color: context.orbit.inkDisabled),
  );
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
          const SizedBox(height: 2),

          /// O contato aparece mesmo quando não existe.
          ///
          /// É o caso mais caro de esconder: quem não sabe que não há telefone
          /// planeja avisar que está chegando, e descobre na portaria que não
          /// tem para quem ligar.
          if (_contatoLegivel(contato) case final String linha)
            Text(linha, style: OrbitType.body.copyWith(color: palette.inkMuted))
          else
            const _NaoInformado(rotulo: 'Contato'),
        ],
      ),
    );
  }
}

/// Nome e telefone de quem atende, numa linha — ou `null` quando não há nem um
/// nem outro.
///
/// Um contato cadastrado só com nome ainda serve: diz por quem perguntar na
/// portaria. Por isso a ausência é a dos **dois**, e não a do telefone.
String? _contatoLegivel(MobileContactSummaryContract? contato) {
  if (contato == null) return null;
  final partes = [
    contato.name,
    contato.phone,
  ].whereType<String>().map((v) => v.trim()).where((v) => v.isNotEmpty);
  return partes.isEmpty ? null : partes.join(' · ');
}

/// Quanto vale — só quando o responsável liberou para o campo.
///
/// ## Por que este campo não diz "não informado"
///
/// Porque a ausência dele não é falta de cadastro: é "não cabe a você ver". O
/// servidor **omite** o bloco inteiro quando a liberação está desligada, e
/// escrever "valor não informado" ali afirmaria que não há valor — quando
/// normalmente há, e só não foi liberado para quem está em campo.
///
/// O que aparece é o terceiro estado: liberado e **sem orçamento vinculado**.
/// Esse sim é falta de cadastro, e a frase diz qual — era o caso que fazia o
/// dono ligar a chave, não ver nada e achar que a liberação não funcionava.
class _Valor extends StatelessWidget {
  const _Valor({required this.financeiro});

  final MobileFinancialSummaryContract financeiro;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;
    final valor = double.tryParse(financeiro.approvedAmount ?? '');

    return _Bloco(
      titulo: 'Valor do atendimento',
      child: valor == null
          ? const _NaoInformado(rotulo: 'Orçamento vinculado')
          : Text(
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
    final iniciar = _iniciar(context, ref, item);
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

/// Começar o atendimento e entrar no roteiro.
///
/// ## O comando sai daqui, e não da primeira etapa
///
/// A etapa Preparação trazia um "Iniciar atendimento" próprio. Quem tocava em
/// "Iniciar o Atendimento" nesta tela caía numa etapa pedindo a mesma coisa de
/// novo — e, antes de tocar, a tela já mostrava tudo que aquela etapa repetia.
/// A etapa saiu; o comando ficou onde a decisão é tomada.
///
/// Para enviá-lo é preciso a versão do atendimento, que vem da preparação.
/// Observá-la aqui custa uma requisição a mais nesta tela — e paga por ela
/// duas vezes: o botão passa a saber se o início está liberado, e o roteiro
/// abre já começado.
///
/// Atendimento em andamento não reenvia nada: entra direto.
///
/// Visita técnica continua em leitura — devolver `null` tira o botão em vez de
/// prometer o que não cumpre.
VoidCallback? _iniciar(
  BuildContext context,
  WidgetRef ref,
  MobileWorkItemContract item,
) {
  final comecar = item.allowedActions.contains(MobileFieldAction.start);
  final retomar = item.allowedActions.contains(MobileFieldAction.resume);
  if (!comecar && !retomar) return null;

  final navegacao = item.navigationContext;

  switch (item.kind) {
    case MobileWorkItemKind.serviceOperation:
      final id = navegacao.sourceId;
      final estado = ref.watch(executionControllerProvider(id));

      /* Sem a preparação em mãos não há versão para o comando, e enviá-lo
         assim seria um no-op silencioso. O botão espera. */
      if (estado.preparation == null) return null;
      if (estado.isBusy) return null;

      /* Explícito, embora o controlador também recuse iniciar o que não está
         liberado: ler aqui que "Continuar" não envia nada é mais claro do que
         depender do silêncio de um no-op lá dentro. */
      final precisaIniciar = estado.allows(
        FieldOperationAllowedAction.start,
      );
      if (precisaIniciar && !estado.preparation!.eligible) return null;

      return () async {
        if (precisaIniciar) {
          await ref.read(executionControllerProvider(id).notifier).start();
          /* Falhou: o erro já está no estado, e entrar no roteiro agora
             mostraria um atendimento que não começou. */
          if (!context.mounted ||
              ref.read(executionControllerProvider(id)).error != null) {
            return;
          }
        }
        if (context.mounted) {
          context.push(OrbitRoutes.operationExecution(id));
        }
      };

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
  const _Tag({required this.label, this.enfase = false});

  final String label;

  /// Etiqueta que precisa ser notada entre as demais.
  final bool enfase;

  @override
  Widget build(BuildContext context) {
    final palette = context.orbit;

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
      decoration: BoxDecoration(
        color: enfase ? palette.warningSoft : palette.surfaceMuted,
        borderRadius: OrbitRadius.pill,
      ),
      child: Text(
        label,
        style: OrbitType.label.copyWith(
          color: enfase ? palette.warning : palette.inkMuted,
        ),
      ),
    );
  }
}
