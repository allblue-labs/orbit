import type { Prisma } from '@prisma/client';
import { jsonObject } from './rvt-json';

export const rvtReportExecutionView = {
  occurrence: { include: { configuration: true } },
  equipment: true,
  evidence: true,
  checklistExecutions: { orderBy: { createdAt: 'asc' }, take: 1 },
} satisfies Prisma.RvtExecutionInclude;

type RvtReportExecution = Prisma.RvtExecutionGetPayload<{
  include: typeof rvtReportExecutionView;
}>;

/** Compose the historical document exclusively from the frozen visit data. */
export function rvtReportSnapshot(execution: RvtReportExecution) {
  const [checklist] = execution.checklistExecutions;
  const template = checklist ? jsonObject(checklist.templateSnapshot) : {};
  return {
    ...jsonObject(execution.configurationSnapshot),
    performedAt: execution.performedAt,
    equipment: execution.equipment.map(({ assetSnapshot }) => assetSnapshot),
    procedure: execution.procedureSnapshot,
    maintenanceChecklist: checklist
      ? {
          name: typeof template.name === 'string' ? template.name : undefined,
          version: checklist.templateVersion,
          status: checklist.status,
          progress: checklist.progress,
          items: Array.isArray(template.items) ? template.items : undefined,
          answers: checklist.answers,
          completedAt: checklist.completedAt,
        }
      : null,
    observations: execution.observations,
    recommendations: execution.recommendations,
    freeTextRecommendation: execution.freeTextRecommendation,
    evidence: execution.evidence,
    fieldTechnicianSignature: execution.fieldTechnicianSignature,
    technicalResponsibleSignature: execution.technicalResponsibleSignature,
    customerAcknowledgement: execution.customerAcknowledgement,
    rvtExecutionId: execution.id,
  };
}
