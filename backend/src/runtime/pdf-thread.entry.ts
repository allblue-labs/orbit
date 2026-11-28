import { deserialize, serialize } from 'node:v8';
import { parentPort, workerData } from 'node:worker_threads';
import { ArtifactPdfRenderer } from '../modules/artifact-rendering/renderers/pdf/artifact-pdf.renderer';
import { ArtifactPremiumPdfRenderer } from '../modules/artifact-rendering/renderers/pdf/artifact-premium-pdf.renderer';
import { QuoteDocumentService } from '../modules/artifact-rendering/quote-document.service';
import { PmocPlanDocumentService } from '../modules/artifact-rendering/pmoc-plan-document.service';
import { PdfRendererService } from '../modules/document-engine/pdf-renderer.service';
import { QuoteAcceptedDocumentService } from '../modules/quotes/quote-accepted-document.service';
import { EquipmentQrRenderer } from '../modules/organizations/business-units/equipaments/equipment-qr.renderer';
import type { PdfTask } from './pdf-thread';

async function render() {
  const { task, input } = workerData as { task: PdfTask; input: Uint8Array };
  const args: unknown = deserialize(input);
  // This message comes from the local thread launcher. It never carries a
  // session, credentials, or a command provided by the client.
  switch (task) {
    case 'artifact':
      return new ArtifactPdfRenderer().render(
        ...(args as Parameters<ArtifactPdfRenderer['render']>),
      );
    case 'premium':
      return new ArtifactPremiumPdfRenderer().render(
        ...(args as Parameters<ArtifactPremiumPdfRenderer['render']>),
      );
    case 'quote':
      return new QuoteDocumentService().render(
        ...(args as Parameters<QuoteDocumentService['render']>),
      );
    case 'pmoc':
      return new PmocPlanDocumentService().render(
        ...(args as Parameters<PmocPlanDocumentService['render']>),
      );
    case 'report':
      return new PdfRendererService().render(
        ...(args as Parameters<PdfRendererService['render']>),
      );
    case 'accepted-quote':
      return new QuoteAcceptedDocumentService().render(
        ...(args as Parameters<QuoteAcceptedDocumentService['render']>),
      );
    case 'equipment':
      return new EquipmentQrRenderer().render(
        ...(args as Parameters<EquipmentQrRenderer['render']>),
      );
  }
}
void render()
  .then((result) => parentPort?.postMessage(serialize(result)))
  .catch(() => parentPort?.postMessage(null));
