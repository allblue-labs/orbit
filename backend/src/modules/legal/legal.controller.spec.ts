import { LegalController } from './legal.controller';
import { LEGAL_DOCUMENT_VERSION } from '../../contracts/modules/legal/legal.read-models';
import { LegalAcceptanceController } from './legal-acceptance.controller';
describe('documentos públicos e aceite do Orbit', () => {
  const controller = new LegalController();
  it.each(['termos', 'privacidade'])(
    'publica %s com responsável e condições reais do serviço',
    (slug) => {
      const document = controller.document(slug);
      expect(document.version).toBe(LEGAL_DOCUMENT_VERSION);
      expect(document.provider).toEqual({
        name: 'Allblue Labs Inova Simples',
        document: '67.312.115/0001-92',
        location: 'Paulista, Pernambuco, Brasil',
        privacyEmail: 'contato@allblue-labs.com',
      });
      expect(document.sections.length).toBeGreaterThan(6);
      expect(JSON.stringify(document.sections)).toContain('30 dias');
    },
  );
  it.each(['termos', 'privacidade'])(
    'gera PDF válido para %s',
    async (slug) => {
      const result = await controller.download(slug);
      const stream = result.getStream();
      const chunks: Buffer[] = [];
      for await (const chunk of stream)
        chunks.push(Buffer.from(chunk as Uint8Array));
      expect(Buffer.concat(chunks).subarray(0, 5).toString()).toBe('%PDF-');
      expect(result.getHeaders().disposition).toContain('attachment');
    },
  );
  it('não aceita nome de arquivo arbitrário', () => {
    expect(() => controller.document('../../.env')).toThrow();
  });
  it('consulta aceite somente do usuário e organização autenticados', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const rls = {
      run: (work: (tx: unknown) => Promise<unknown>) =>
        work({ organizationLegalAcceptance: { findFirst } }),
    };
    const legal = new LegalAcceptanceController(rls as never);
    await legal.current({
      identity: { id: 'user', organizationId: 'org' },
    } as never);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org', userId: 'user' },
      }),
    );
  });
});
