import { ArtifactRenderProcessor } from './artifact-render.processor';
import type { BackgroundJobRecord } from '../jobs/background-job.types';

function setup(manifestVersion: string, manifestRenderer = 'pdf.premium') {
  const source = {
    fieldArtifact: { id: 'frozen' },
    code: 'OS-001',
    createdById: 'owner',
    businessUnitId: 'unit',
    manifests: [
      {
        id: 'previous-manifest',
        renderer: manifestRenderer,
        rendererVersion: manifestVersion,
      },
    ],
  };
  const repository = {
    findRenderSource: jest.fn().mockResolvedValue(source),
    markReady: jest.fn(),
    markRendering: jest.fn(),
    audit: jest.fn(),
  };
  const renderer = {
    id: 'pdf.premium',
    version: '2.0.2',
    render: jest.fn().mockResolvedValue({
      bytes: Buffer.from('%PDF-report'),
      format: 'PDF',
      mimeType: 'application/pdf',
      rendererVersion: '2.0.2',
      metadata: {},
    }),
  };
  const inputs = { build: jest.fn().mockResolvedValue({ frozen: 'original' }) };
  const manifests = {
    openRevision: jest.fn().mockResolvedValue({ id: 'new-manifest' }),
    issueWithContent: jest.fn().mockResolvedValue({
      id: 'new-manifest',
      revision: 2,
      contentHash: 'hash',
    }),
  };
  const metrics = { recordSuccess: jest.fn(), recordRetry: jest.fn() };
  const processor = new ArtifactRenderProcessor(
    repository as never,
    inputs as never,
    { has: () => true, get: () => renderer } as never,
    manifests as never,
    metrics as never,
    {} as never,
  );
  const job = {
    payload: { executionId: 'execution', renderer: 'pdf.premium' },
    attempts: 1,
    organizationId: 'org',
    actorUserId: 'owner',
    correlationId: 'correlation',
  } as unknown as BackgroundJobRecord;
  return { processor, job, source, repository, renderer, inputs, manifests };
}

describe('reissuing frozen field documents after a renderer correction', () => {
  it('a requested correction creates a new revision using the existing frozen source', async () => {
    const env = setup('2.0.1');
    await env.processor.process(env.job);
    expect(env.inputs.build).toHaveBeenCalledWith(env.source, 'correlation');
    expect(env.renderer.render).toHaveBeenCalledWith({ frozen: 'original' });
    expect(env.manifests.openRevision).toHaveBeenCalledWith(
      'execution',
      { organizationId: 'org', actorId: 'owner' },
      expect.objectContaining({
        renderer: 'pdf.premium',
        rendererVersion: '2.0.2',
      }),
    );
    expect(env.manifests.issueWithContent).toHaveBeenCalledWith(
      'new-manifest',
      expect.anything(),
      expect.objectContaining({ fileName: 'OS-001.pdf' }),
    );
    expect(env.source.manifests[0].id).toBe('previous-manifest');
  });
  it('retry after issuing the same renderer version does not duplicate a revision', async () => {
    const env = setup('2.0.2');
    await env.processor.process({ ...env.job, attempts: 2 });
    expect(env.repository.markReady).toHaveBeenCalledWith('execution');
    expect(env.inputs.build).not.toHaveBeenCalled();
    expect(env.manifests.openRevision).not.toHaveBeenCalled();
  });
  it('a document issued by another renderer does not bypass the requested renderer', async () => {
    const env = setup('2.0.2', 'html.default');
    await env.processor.process(env.job);
    expect(env.renderer.render).toHaveBeenCalled();
  });
});
