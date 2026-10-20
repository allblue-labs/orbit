/**
 * A qual cota comercial pertence cada documento emitido — quando pertence.
 *
 * A classificação é **exclusiva**: um PMOC consome a cota de PMOC e nenhuma
 * outra. O critério é o tipo do artefato congelado no snapshot da execução — o
 * mesmo que o documento carrega para sempre —, e não o template atual, que
 * pode ter sido renomeado depois.
 *
 * ## O documento da ordem de serviço não custa nada
 *
 * A ordem já foi cobrada quando foi criada, em `SERVICE_ORDERS_CREATED`. Fazer
 * o documento dela cair em "outros documentos" cobraria o mesmo atendimento
 * duas vezes, com nomes diferentes: um atendimento gera uma ordem e o papel
 * daquela ordem, e isso é **uma** unidade comercial, não duas.
 *
 * Tipo desconhecido cai em "outros documentos" de propósito: um template novo
 * não deve escapar da cota só porque a classificação ainda não o conhece. Essa
 * é a diferença entre a isenção da OS — que é uma decisão — e o silêncio, que
 * seria uma falha.
 */
import { UsageResource } from '../catalog/plan-catalog.types';

const PMOC = 'PMOC';
const RVT = 'RELATORIO_VISITA';
const ORDEM_DE_SERVICO = 'ORDEM_SERVICO';

/** `null` quando o documento não consome cota documental alguma. */
export function documentUsageResource(
  artifactType: string,
): UsageResource | null {
  if (artifactType === ORDEM_DE_SERVICO) return null;
  if (artifactType === PMOC) return UsageResource.PMOC_DOCUMENTS_ISSUED;
  if (artifactType === RVT) return UsageResource.RVT_DOCUMENTS_ISSUED;
  return UsageResource.OTHER_DOCUMENTS_ISSUED;
}
