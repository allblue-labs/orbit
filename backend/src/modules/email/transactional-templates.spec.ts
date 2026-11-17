import {
  accountEmailLink,
  transactionalEmail,
  TRANSACTIONAL_TEMPLATES,
} from './transactional-templates';
describe('owner transactional templates', () => {
  it.each(TRANSACTIONAL_TEMPLATES)(
    '%s has accessible pt-BR HTML and text without untrusted markup',
    (template) => {
      const result = transactionalEmail(template, {
        link: 'https://orbit.example.com/perfil',
        name: '<script>PRIVATE</script>',
        organizationName: '<img src=x onerror=alert(1)>',
        resources: ['clientes ativos'],
      });
      expect(result.html).toContain('lang="pt-BR"');
      for (const image of result.inlineImages) {
        expect(result.html).toContain(`src="cid:${image.contentId}"`);
        expect(image.contentType).toBe('image/png');
        expect(Buffer.from(image.content).subarray(0, 8).toString('hex')).toBe(
          '89504e470d0a1a0a',
        );
      }
      expect(result.inlineImages.map((image) => image.fileName)).toEqual([
        'allblue-logo.png',
        'orbit-logo.png',
      ]);
      expect(result.html).not.toMatch(/<img[^>]+src="https?:/);
      expect(result.text.length).toBeGreaterThan(100);
      expect(result.html).not.toContain('<script>');
      expect(result.html).not.toContain('<img src=x');
      expect(result.html).not.toMatch(/tracking|pixel|utm_/i);
      expect(result.subject).not.toMatch(/[\r\n]/);
    },
  );
  it('explica o uso único e o prazo de três horas na recuperação', () => {
    const result = transactionalEmail('PASSWORD_RESET', {
      link: 'https://orbit.example.com/redefinir-senha#token=example',
    });
    expect(result.text).toContain('expira em 3 horas');
    expect(result.text).toContain('pode ser usado uma vez');
  });
  it('never embeds a password or a payment charge promise in security notices', () => {
    const result = transactionalEmail('PASSWORD_CHANGED', {
      link: 'https://orbit.example.com/perfil',
    });
    expect(result.text).toContain('Nunca enviamos sua senha');
    expect(
      transactionalEmail('PLAN_EXPIRED', {
        link: 'https://orbit.example.com/configuracoes',
      }).text,
    ).toContain('não confirma cobrança');
  });
  it('uses real application routes and denies credentials in action origins', () => {
    const old = process.env.IDENTITY_PUBLIC_WEB_URL;
    process.env.IDENTITY_PUBLIC_WEB_URL = 'https://orbit.example.com';
    try {
      expect(accountEmailLink(true)).toBe('https://orbit.example.com/perfil');
      expect(accountEmailLink()).toBe(
        'https://orbit.example.com/configuracoes',
      );
      process.env.IDENTITY_PUBLIC_WEB_URL = 'https://user:secret@example.com';
      expect(() => accountEmailLink()).toThrow();
    } finally {
      if (old === undefined) delete process.env.IDENTITY_PUBLIC_WEB_URL;
      else process.env.IDENTITY_PUBLIC_WEB_URL = old;
    }
  });
});
