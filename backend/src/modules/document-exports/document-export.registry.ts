import { Injectable } from '@nestjs/common';
import type { DocumentExportKind } from './document-export.read-models';
import type { DocumentExportGenerator } from './document-export.types';

/**
 * Onde os domínios anunciam seus geradores — mesmo desenho do
 * `JobProcessorRegistry`: global, e cada tipo tem um dono só.
 */
@Injectable()
export class DocumentExportGeneratorRegistry {
  private readonly generators = new Map<
    DocumentExportKind,
    DocumentExportGenerator
  >();

  register(generator: DocumentExportGenerator): void {
    for (const kind of generator.kinds) {
      const existing = this.generators.get(kind);
      if (existing && existing !== generator)
        throw new Error(`[document-exports] ${kind} já possui gerador`);
      this.generators.set(kind, generator);
    }
  }

  get(kind: DocumentExportKind): DocumentExportGenerator | undefined {
    return this.generators.get(kind);
  }
}
