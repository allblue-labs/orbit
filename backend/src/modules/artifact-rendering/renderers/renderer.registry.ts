/**
 * Registry de renderers.
 *
 * Resolve o identificador que o manifest guarda (`renderer`) para o motor que
 * sabe produzir aquele formato. Nenhum serviço instancia renderer: pede ao
 * registry e usa o que voltar.
 *
 * Registrar um motor novo — um PDF sobre Chromium, um DOCX — é acrescentar um
 * provider ao módulo. Nada além deste arquivo muda.
 */
import { Inject, Injectable } from '@nestjs/common';
import { ValidationException } from '../../../exceptions';
import { ARTIFACT_RENDERER, type ArtifactRenderer } from './artifact-renderer';

@Injectable()
export class ArtifactRendererRegistry {
  private readonly byId: ReadonlyMap<string, ArtifactRenderer>;

  constructor(
    @Inject(ARTIFACT_RENDERER) renderers: readonly ArtifactRenderer[],
  ) {
    this.byId = new Map(renderers.map((renderer) => [renderer.id, renderer]));
  }

  /** Identificadores disponíveis, em ordem estável — usados na API e no erro. */
  available(): readonly string[] {
    return [...this.byId.keys()].sort();
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Resolve um renderer.
   *
   * Um identificador desconhecido é **recusado na hora do pedido**, não na hora
   * do trabalho: quem pediu recebe 422 com a lista do que existe, em vez de um
   * job que morre em segundo plano.
   */
  get(id: string): ArtifactRenderer {
    const renderer = this.byId.get(id);
    if (!renderer) {
      throw new ValidationException(
        `Unknown renderer "${id}". Available: ${this.available().join(', ')}`,
        undefined,
        'RENDERER_NOT_SUPPORTED',
      );
    }
    return renderer;
  }

  /** Formato que um renderer produz — o manifest o registra junto. */
  formatOf(id: string): string {
    return this.get(id).format;
  }
}
