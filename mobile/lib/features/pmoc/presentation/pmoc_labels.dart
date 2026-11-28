/// Os termos do PMOC em português, num lugar só.
///
/// ## Por que traduzir, e por que aqui
///
/// Os códigos vêm do servidor — `PLAN_NOT_ACTIVE`, `NOT_STARTED` — e são a
/// autoridade. A tela traduz e **não** recalcula: decifrar o sistema não é
/// tarefa de quem está de pé numa casa de máquinas.
///
/// As frases são as mesmas da web (`registry/pmoc.ts`) de propósito: o técnico e
/// o dono falam do mesmo bloqueio quando ligam um para o outro.
library;

import '../../../core/design/orbit_primitives.dart';

String pmocBlockedReasonLabel(String reason) => switch (reason) {
  'PLAN_NOT_ACTIVE' =>
    'O plano está inativo. Peça a quem gerencia o PMOC para revisá-lo.',
  'CYCLE_NOT_PENDING' => 'Este ciclo já foi encerrado.',
  'EXECUTION_CANCELLED' => 'O atendimento deste equipamento foi cancelado.',
  'EQUIPMENT_INACTIVE' => 'O equipamento está inativo no cadastro.',
  'TECHNICAL_RESPONSIBLE_MISSING' =>
    'Peça a quem gerencia o plano para definir um Responsável Técnico.',
  'TECHNICAL_RESPONSIBLE_INELIGIBLE' =>
    'Peça a quem gerencia o plano para conferir o perfil e a assinatura do Responsável Técnico.',
  'PROFESSIONAL_PROFILE_INACTIVE' =>
    'O perfil do Responsável Técnico está inativo. Solicite a revisão em Equipe.',
  'PROFESSIONAL_ROLE_MISSING' =>
    'Peça a quem gerencia a equipe para habilitar o perfil de Responsável Técnico.',
  'BUSINESS_UNIT_SCOPE_MISSING' =>
    'O Responsável Técnico precisa atuar na unidade deste plano.',
  'DOCUMENT_POLICY_DENIED' =>
    'Peça a quem gerencia o PMOC para conferir quem pode assinar este documento.',
  'SIGNATURE_MISSING' =>
    'O Responsável Técnico ainda não cadastrou a assinatura.',
  'CREDENTIAL_MISSING' =>
    'O Responsável Técnico está sem registro profissional.',
  'CREDENTIAL_EXPIRED' =>
    'O registro profissional do Responsável Técnico venceu.',
  _ =>
    'Atualize o PMOC. Se continuar indisponível, peça a quem gerencia a manutenção para revisar o plano.',
};

/// A situação de um equipamento no ciclo.
({String label, OrbitTone tone}) pmocEquipmentStatus(String status) =>
    switch (status) {
      'NOT_STARTED' => (label: 'A atender', tone: OrbitTone.neutral),
      'IN_PROGRESS' => (label: 'Em andamento', tone: OrbitTone.info),
      'COMPLETED' => (label: 'Concluído', tone: OrbitTone.success),
      'CANCELLED' => (label: 'Cancelado', tone: OrbitTone.neutral),
      _ => (label: 'Situação indisponível', tone: OrbitTone.neutral),
    };

/// A situação de um ciclo do plano.
({String label, OrbitTone tone}) pmocCycleStatus(String status) =>
    switch (status) {
      'PENDING' => (label: 'Em aberto', tone: OrbitTone.info),
      'IN_PROGRESS' => (label: 'Em andamento', tone: OrbitTone.info),
      'COMPLETED' => (label: 'Concluído', tone: OrbitTone.success),
      'SKIPPED' => (label: 'Não realizado', tone: OrbitTone.warning),
      'CANCELLED' => (label: 'Cancelado', tone: OrbitTone.neutral),
      _ => (label: 'Situação indisponível', tone: OrbitTone.neutral),
    };

/// `2026-10-14` → `14/10/2026`.
///
/// Vencimento é **dia**, não instante: o servidor o decide no fuso da unidade, e
/// converter para o relógio do aparelho mudaria o dia perto da meia-noite — a
/// diferença entre "vence hoje" e "venceu ontem".
String pmocDueLabel(String? isoDate) {
  if (isoDate == null || isoDate.length < 10) return '—';
  final partes = isoDate.substring(0, 10).split('-');
  if (partes.length != 3) return isoDate;
  return '${partes[2]}/${partes[1]}/${partes[0]}';
}
