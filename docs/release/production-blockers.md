# Bloqueios para publicação do Orbit

Lista de retomada do PR-19. Reexecutar a qualificação com o SHA escolhido para publicação. A evidência da última passagem está em [Qualificação PR-19](pr-19-release-qualification.md).

- [ ] Resolver os alertas de dependências de desenvolvimento exigidos pela auditoria completa, incluindo `picomatch`. A auditoria das dependências de runtime estava zerada nos dois projetos.
- [ ] Liberar espaço no builder OCI e produzir imagens linux/amd64 da release. Registrar digests, SBOM, proveniência, assinatura e resultado da análise de vulnerabilidades.
- [ ] Concluir as suítes E2E completas de API e web e repetir os testes em staging com a release e as migrations correspondentes. Cinco cenários ficaram sem resultado na execução completa e passaram isoladamente.
- [ ] Testar restauração com dados e objetos do R2 e rollback por digest. Validar cópia criptografada fora do servidor e os alertas da rotina de backup. A restauração de banco e storage local passou no ensaio sintético.
- [ ] Configurar a credencial de purge do CDN e testar a política de retenção com dados controlados antes de habilitá-la.
- [ ] Preparar os artefatos móveis do SHA escolhido e conferir versão, build number e links oficiais. Validar assinatura de distribuição iOS e APNs, além de entrega de push em aparelhos Android e iPhone com o app aberto e em segundo plano.
- [ ] Revalidar entrega real dos e-mails do SES e a recepção de feedback SNS com a versão candidata. Registrar a confirmação da entrega na caixa de destino.
