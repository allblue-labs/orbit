import { Injectable } from '@nestjs/common';
import type { AnalyticsKpi, KpiReadModel } from '../analytics.read-models';
import {
  change,
  direction,
  percent,
  round,
  statusFor,
} from '../analytics.math';
import type {
  AnalyticsCommitment,
  AnalyticsOperation,
  AnalyticsSnapshot,
} from '../analytics.types';

const completed = (status: string) =>
  ['COMPLETED', 'DONE', 'CLOSED', 'FINALIZED', 'PUBLISHED'].includes(status);
const cancelled = (status: string) =>
  ['CANCELLED', 'CANCELED'].includes(status);
const during = (date: Date | null | undefined, from: Date, to: Date) =>
  Boolean(date && date >= from && date <= to);

@Injectable()
export class KpiEngine {
  execute(snapshot: AnalyticsSnapshot): KpiReadModel {
    const { range } = snapshot;
    const current = this.operationStats(
      snapshot.operations,
      range.from,
      range.to,
    );
    const before = this.operationStats(
      snapshot.previousOperations,
      range.previousFrom,
      range.previousTo,
    );
    const pmoc = this.commitments(snapshot.pmocs, range.from, range.to);
    const previousPmoc = this.commitments(
      snapshot.previousPmocs ?? [],
      range.previousFrom,
      range.previousTo,
    );
    const rvt = this.commitments(snapshot.rvts ?? [], range.from, range.to);
    const previousRvt = this.commitments(
      snapshot.previousRvts ?? [],
      range.previousFrom,
      range.previousTo,
    );
    const indicators: AnalyticsKpi[] = [];
    const count = (
      id: string,
      domain: AnalyticsKpi['domain'],
      label: string,
      value: number,
      description: string,
      previous?: number,
      executive = true,
      alert = false,
    ) => {
      const delta =
        previous === undefined || previous === 0 ? 0 : change(value, previous);
      indicators.push({
        id,
        domain,
        label,
        value,
        source:
          domain === 'EQUIPMENT'
            ? 'assets'
            : domain === 'PMOC'
              ? 'pmoc_executions'
              : domain === 'RVT'
                ? 'rvt_occurrences'
                : 'operations',
        dataQuality: 'OBSERVED',
        sampleSize: value,
        description,
        executive,
        comparisonAvailable: previous !== undefined && previous > 0,
        status: alert && value > 0 ? 'ATTENTION' : 'HEALTHY',
        changePercent: delta,
        direction: direction(delta),
      });
    };
    const rate = (
      id: string,
      domain: AnalyticsKpi['domain'],
      label: string,
      numerator: number,
      denominator: number,
      oldNumerator: number,
      oldDenominator: number,
      description: string,
      executive = false,
    ) => {
      const value = percent(numerator, denominator);
      const delta =
        denominator && oldDenominator
          ? round(value - percent(oldNumerator, oldDenominator))
          : 0;
      indicators.push({
        id,
        domain,
        label,
        value,
        unit: '%',
        source:
          domain === 'EQUIPMENT'
            ? 'assets'
            : domain === 'PMOC'
              ? 'pmoc_executions'
              : domain === 'RVT'
                ? 'rvt_occurrences'
                : 'operations',
        dataQuality: 'DERIVED',
        sampleSize: denominator,
        basis: { numerator, denominator },
        description,
        executive,
        comparisonAvailable: denominator > 0 && oldDenominator > 0,
        changeUnit: 'POINTS',
        changePercent: delta,
        direction: direction(delta),
        status: statusFor(value, 90, 70),
      });
    };
    count(
      'operations.open',
      'OPERATIONS',
      'Atendimentos em aberto',
      current.open.length,
      'Fila atual, incluindo demandas antigas.',
    );
    count(
      'operations.overdue',
      'OPERATIONS',
      'Atendimentos atrasados',
      current.overdue,
      'Em aberto com término previsto já vencido.',
      undefined,
      true,
      true,
    );
    count(
      'operations.unassigned',
      'TECHNICIANS',
      'Sem técnico definido',
      current.unassigned,
      'Em aberto e sem técnico operacional responsável.',
      undefined,
      true,
      true,
    );
    count(
      'operations.unscheduled',
      'OPERATIONS',
      'Sem agendamento',
      current.unscheduled,
      'Em aberto e sem data de início prevista.',
      undefined,
      true,
      true,
    );
    count(
      'operations.completed',
      'OPERATIONS',
      'Concluídos no período',
      current.delivered.length,
      'Conclusões pela data de encerramento, inclusive demandas antigas.',
      before.delivered.length,
    );
    rate(
      'operations.sla_compliance',
      'OPERATIONS',
      'Concluídos no prazo',
      current.onTime,
      current.withDeadline.length,
      before.onTime,
      before.withDeadline.length,
      'Entre os atendimentos concluídos no período que tinham término previsto.',
      true,
    );
    count(
      'pmoc.overdue',
      'PMOC',
      'Ciclos PMOC pendentes',
      pmoc.overdue,
      'Ciclos vencidos e ainda não concluídos, incluindo anteriores ao período.',
      undefined,
      true,
      true,
    );
    count(
      'rvt.overdue',
      'RVT',
      'Visitas RVT pendentes',
      rvt.overdue,
      'Visitas vencidas e ainda não concluídas, incluindo anteriores ao período.',
      undefined,
      true,
      true,
    );
    rate(
      'operations.scheduling_coverage',
      'OPERATIONS',
      'Demandas com agenda',
      current.scheduled,
      current.cohort.length,
      before.scheduled,
      before.cohort.length,
      'Demandas criadas em cada período com início previsto; conforme cadastro atual.',
    );
    rate(
      'technicians.assignment_coverage',
      'TECHNICIANS',
      'Demandas com técnico',
      current.assigned,
      current.cohort.length,
      before.assigned,
      before.cohort.length,
      'Demandas criadas em cada período com técnico operacional responsável; auxiliares não substituem o responsável.',
    );
    rate(
      'pmoc.compliance',
      'PMOC',
      'PMOC em dia',
      pmoc.onTime,
      pmoc.total,
      previousPmoc.onTime,
      previousPmoc.total,
      'Ciclos vencidos no período e pendências anteriores; conclusão até o vencimento.',
    );
    rate(
      'rvt.compliance',
      'RVT',
      'RVT em dia',
      rvt.onTime,
      rvt.total,
      previousRvt.onTime,
      previousRvt.total,
      'Visitas com data vencida no período e pendências anteriores; conclusão até o fim do dia agendado.',
    );
    rate(
      'operations.backlog_punctuality',
      'OPERATIONS',
      'Fila dentro do prazo',
      current.openWithDeadline - current.overdue,
      current.openWithDeadline,
      0,
      0,
      'Atendimentos em aberto com término previsto que ainda não venceram.',
    );
    rate(
      'operations.backlog_scheduling',
      'OPERATIONS',
      'Fila com agenda',
      current.open.length - current.unscheduled,
      current.open.length,
      0,
      0,
      'Atendimentos em aberto com início previsto.',
    );
    rate(
      'technicians.backlog_coverage',
      'TECHNICIANS',
      'Fila com técnico',
      current.open.length - current.unassigned,
      current.open.length,
      0,
      0,
      'Atendimentos em aberto com responsável operacional.',
    );
    count(
      'operations.total',
      'OPERATIONS',
      'Demandas criadas',
      current.cohort.length,
      'Criadas no período, excluindo canceladas.',
      before.cohort.length,
      false,
    );
    rate(
      'operations.completion_rate',
      'OPERATIONS',
      'Demandas do período concluídas',
      current.cohort.filter(
        (op) =>
          completed(op.status) && op.completedAt && op.completedAt <= range.to,
      ).length,
      current.cohort.length,
      0,
      0,
      'Conclusões entre as demandas criadas no próprio período; não mede produtividade.',
    );
    count(
      'technicians.active',
      'TECHNICIANS',
      'Técnicos responsáveis',
      new Set(
        current.cohort.flatMap((op) =>
          op.responsibleFieldTechnicianId
            ? [op.responsibleFieldTechnicianId]
            : [],
        ),
      ).size,
      'Responsáveis distintos nas demandas criadas no período.',
      undefined,
      false,
    );
    count(
      'equipment.registered',
      'EQUIPMENT',
      'Equipamentos cadastrados',
      snapshot.assets.length,
      'Cadastro de equipamentos; não representa disponibilidade física.',
      undefined,
      false,
    );
    return {
      generatedAt: new Date().toISOString(),
      period: {
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        granularity: range.granularity,
      },
      availability: [],
      indicators,
    };
  }

  private operationStats(
    operations: AnalyticsOperation[],
    from: Date,
    to: Date,
  ) {
    const active = operations.filter(
      (op) => !cancelled(op.status) && op.createdAt <= to,
    );
    const cohort = active.filter((op) => during(op.createdAt, from, to));
    const delivered = active.filter(
      (op) => completed(op.status) && during(op.completedAt, from, to),
    );
    const withDeadline = delivered.filter((op) => op.scheduledEnd !== null);
    const open = active.filter((op) => !completed(op.status));
    return {
      cohort,
      delivered,
      withDeadline,
      open,
      onTime: withDeadline.filter((op) => op.completedAt! <= op.scheduledEnd!)
        .length,
      assigned: cohort.filter((op) => Boolean(op.responsibleFieldTechnicianId))
        .length,
      scheduled: cohort.filter((op) => Boolean(op.scheduledStart)).length,
      overdue: open.filter((op) => op.scheduledEnd && op.scheduledEnd < to)
        .length,
      openWithDeadline: open.filter((op) => op.scheduledEnd !== null).length,
      unassigned: open.filter((op) => !op.responsibleFieldTechnicianId).length,
      unscheduled: open.filter((op) => !op.scheduledStart).length,
    };
  }

  private commitments(rows: AnalyticsCommitment[], from: Date, to: Date) {
    const due = rows.filter(
      (row) =>
        !cancelled(row.status) && (row.deadlineAt ?? row.createdAt) <= to,
    );
    const isDone = (row: AnalyticsCommitment) =>
      completed(row.status) &&
      row.finalizedAt !== null &&
      row.finalizedAt <= to;
    const evaluated = due.filter(
      (row) => (row.deadlineAt ?? row.createdAt) >= from || !isDone(row),
    );
    return {
      total: evaluated.length,
      overdue: due.filter((row) => !isDone(row)).length,
      onTime: evaluated.filter(
        (row) =>
          isDone(row) && row.finalizedAt! <= (row.deadlineAt ?? row.createdAt),
      ).length,
    };
  }
}
