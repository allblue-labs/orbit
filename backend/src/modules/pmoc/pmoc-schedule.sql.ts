import { Prisma } from '@prisma/client';

/**
 * Usado no UPDATE de pmoc_plans nos dois fluxos de conclusão.
 * Uma execução antecipada nunca pode gerar o próximo ciclo na mesma data
 * (índice único por plano/vencimento) ou antes do ciclo que acabou de fechar.
 * Atrasos continuam contando a periodicidade a partir do atendimento real.
 */
export function nextPmocDueOnSql(performedAt: Date, cycleId: string) {
  return Prisma.sql`(GREATEST(${performedAt}::date, (
    SELECT e.due_on FROM pmoc_executions e
    WHERE e.id=${cycleId}::uuid
      AND e.plan_id=pmoc_plans.id
      AND e.organization_id=pmoc_plans.organization_id
  )) + make_interval(
    years=>CASE WHEN frequency_unit='YEARS' THEN frequency_amount ELSE 0 END,
    months=>CASE WHEN frequency_unit='MONTHS' THEN frequency_amount ELSE 0 END,
    weeks=>CASE WHEN frequency_unit='WEEKS' THEN frequency_amount ELSE 0 END,
    days=>CASE WHEN frequency_unit='DAYS' THEN frequency_amount ELSE 0 END
  ))::date`;
}
