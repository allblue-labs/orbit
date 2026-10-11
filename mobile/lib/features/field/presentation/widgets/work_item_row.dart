/// A linha de um item de trabalho.
///
/// É a peça mais lida do app: o profissional passa os olhos e precisa saber,
/// nessa ordem, **quando**, **para quem**, **onde** e **o quê**. Tudo o mais é
/// ruído em pé de escada.
///
/// ## Por que linha, e não cartão
///
/// Era um `Card` por item. Numa fila de doze atendimentos isso são doze
/// retângulos com sombra, margem e borda — e nenhum deles se destaca, porque
/// todos se destacam igual. A linha devolve à lista a leitura de lista: o
/// horário alinhado na mesma coluna, os títulos alinhados na mesma coluna, e o
/// olho descendo em vez de saltando.
///
/// Nada aqui é calculado. O selo de prazo vem de `dueState`, decidido no fuso
/// da unidade; a ação principal vem de `primaryAction`; e a posição na lista é
/// a que o servidor deu.
library;

import 'package:flutter/material.dart';

import '../../../../core/contracts/mobile_field_contracts.dart';
import '../../../../core/design/orbit_primitives.dart';
import '../../../../core/presentation/field_registry.dart';
import '../../../../core/presentation/orbit_format.dart';

/// Tom do selo de prazo.
///
/// Atrasado é crítico, mas sem alarme: quem está em campo já sabe que atrasou,
/// e uma tela gritando não ajuda a chegar mais rápido.
const _dueTone = <MobileDueState, OrbitTone>{
  MobileDueState.inProgress: OrbitTone.info,
  MobileDueState.overdue: OrbitTone.danger,
  MobileDueState.dueToday: OrbitTone.warning,
  MobileDueState.upcoming: OrbitTone.neutral,
  MobileDueState.unscheduled: OrbitTone.neutral,
};

OrbitTone dueToneOf(MobileDueState state) =>
    _dueTone[state] ?? OrbitTone.neutral;

class WorkItemRow extends StatelessWidget {
  const WorkItemRow({
    super.key,
    required this.item,
    required this.onOpen,
    this.currentUserId,
    this.emphasis = false,
  });

  final MobileWorkItemContract item;
  final VoidCallback onOpen;

  /// Para dizer qual é a função de quem está lendo, quando houver.
  final String? currentUserId;

  /// Destaque discreto — reservado ao item que a tela está apontando como o
  /// que fazer agora.
  final bool emphasis;

  @override
  Widget build(BuildContext context) {
    final assignment = assignmentOf(item, currentUserId);
    final selo = dueStateLabel(item.dueState);

    return Semantics(
      button: true,
      label: semanticLabel(item),

      /// `excludeSemantics`: o rótulo acima já diz a linha inteira na ordem
      /// que importa. Sem isso o leitor de tela lê tudo duas vezes, em duas
      /// ordens diferentes.
      excludeSemantics: true,
      child: OrbitListRow(
        leading: scheduleColumn(item),
        title: item.customer?.name ?? item.title,

        /// O que é o serviço. Antes esta linha trazia só "Atendimento" — o
        /// rótulo da natureza — e o título que o servidor manda era
        /// descartado. Quem está indo para a rua precisa saber se é uma
        /// preventiva de chiller ou um vazamento de gás antes de abrir.
        subtitle: item.customer == null ? null : item.title,
        detail: _apoio(assignment, locationText(item)),
        emphasis: emphasis,
        tone: dueToneOf(item.dueState),
        /// Um pedido de cancelamento em aberto vence o prazo na etiqueta.
        ///
        /// A situação do atendimento não muda ao pedir — quem decide é o
        /// responsável. Mas na fila ele continuava idêntico aos demais, e quem
        /// pediu não via sinal nenhum de que o relato existia: abria de novo
        /// para conferir, ou pedia outra vez.
        trailing: item.pendingCancellation != null
            ? const OrbitStatusBadge(
                label: 'Cancelamento pedido',
                tone: OrbitTone.warning,
              )
            : selo.isEmpty
            ? null
            : OrbitStatusBadge(label: selo, tone: dueToneOf(item.dueState)),
        onTap: onOpen,
      ),
    );
  }

  /// Natureza, equipamento, função e local — nessa ordem, numa linha só.
  ///
  /// É a terceira linha, a de contexto: quem lê já sabe o cliente e o serviço,
  /// e desce até aqui só quando precisa do detalhe.
  String? _apoio(FieldAssignment assignment, String? local) {
    final partes = [
      /// A natureza entra quando **diz** alguma coisa.
      ///
      /// Para PMOC e RVT o rótulo é o nome do produto — "Manutenção
      /// preventiva", "Visita técnica" — e é informação que a pessoa procura.
      /// Para `serviceOperation` ele é o genérico "Atendimento", que repetido
      /// linha após linha era o ruído desta tela; aí ele só aparece quando não
      /// há título de serviço para ocupar o lugar.
      if (item.kind != MobileWorkItemKind.serviceOperation ||
          item.customer == null)
        workItemKindLabel(item.kind),
      if (item.equipmentSummary.isNotEmpty)
        equipmentText(item.equipmentSummary),
      if (assignment != FieldAssignment.none) assignmentLabel(assignment),
      if (local != null && local.isNotEmpty) local,
      item.businessUnit.name,
    ].where((parte) => parte.isNotEmpty).toList();
    return partes.isEmpty ? null : partes.join(' · ');
  }
}

/// Horário do item — instante, exibido no relógio de quem lê.
///
/// Sem data agendada não se inventa uma: "Sem data" é a informação correta, e
/// o servidor já disse isso em `dueState`.
String scheduleText(MobileWorkItemContract item) => item.scheduledFor == null
    ? 'Sem data'
    : OrbitFormat.hourOf(item.scheduledFor);

/// O mesmo horário, na largura da coluna da esquerda.
///
/// "Sem data" não cabe em 46 pixels e, repetido linha após linha, viraria uma
/// coluna de texto onde deveria haver uma coluna de números. O travessão diz a
/// mesma coisa visualmente; quem usa leitor de tela ouve `scheduleText`, que
/// continua dizendo a frase inteira.
String scheduleColumn(MobileWorkItemContract item) =>
    item.scheduledFor == null ? '—' : OrbitFormat.hourOf(item.scheduledFor);

/// A função de quem está lendo, derivada dos campos publicados.
FieldAssignment assignmentOf(
  MobileWorkItemContract item,
  String? currentUserId,
) {
  if (currentUserId == null) return FieldAssignment.none;
  if (item.responsibleFieldTechnician?.id == currentUserId) {
    return FieldAssignment.responsible;
  }
  if (item.auxiliaryTechnicians.any((person) => person.id == currentUserId)) {
    return FieldAssignment.auxiliary;
  }
  return FieldAssignment.none;
}

/// Local legível a partir do JSON livre de `location`, com o setor do
/// equipamento como segunda melhor resposta.
String? locationText(MobileWorkItemContract item) {
  final location = item.location;
  for (final key in ['label', 'address', 'street', 'city', 'name']) {
    final value = location?[key];
    if (value is String && value.trim().isNotEmpty) return value.trim();
  }
  final sector = item.equipmentSummary
      .map((equipment) => equipment.sector)
      .whereType<String>()
      .where((value) => value.trim().isNotEmpty)
      .firstOrNull;
  return sector;
}

/// Um equipamento pelo nome; vários, pela contagem.
String equipmentText(List<MobileEquipmentSummaryContract> equipment) =>
    equipment.length == 1
    ? equipment.first.name
    : '${equipment.length} equipamentos';

/// O que um leitor de tela anuncia.
String semanticLabel(MobileWorkItemContract item) => [
  workItemKindLabel(item.kind),
  dueStateLabel(item.dueState),
  scheduleText(item),
  item.customer?.name ?? item.title,
].where((part) => part.isNotEmpty).join(', ');
