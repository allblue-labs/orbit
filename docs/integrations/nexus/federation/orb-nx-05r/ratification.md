# Folha de ratificação parcial TENANT / ACK / erro

**PENDING_BILATERAL_APPROVAL.** `approved=false`, `RATIFIED=false`, `runtimeEnabled=false`. Os aprovadores e registros de aceite ainda precisam ser designados. O objeto técnico é [scope.json](scope.json), com IDs completos e SHA-256 por schema, locks, capabilities, manifest de origem e codec, acompanhado da [evidência](evidence.json).

## Wire recomendado

| Alternativa | Efeito sobre o recorte |
| --- | --- |
| **A · Orbit federation `1.0.0` como origem, com codec `1.0.0-nexus04c`** | Recomendada para o recorte representável. Preserva a especificação do Orbit e usa os codecs no limite Nexus para ACP `1.0.0-draft.nexus04` / Orbit profile `1.0.0-proposed.nexus04`. Custo concentrado na compatibilidade versionada em um único lado. Depende de a ingestão Nexus entender/verificar o wire original e conservar rastreabilidade. |
| B · Sucessor explícito do perfil Orbit | Escolher se a fase exigir uma semântica que o wire congelado não representa, como carregar causalidade conhecida. Preserva a versão anterior e pode reduzir reencodificação futura, com custo de manter coexistência, negociar versões e qualificar produtores/consumidores e replay separadamente. |

Na proposta A, ingress conserva o envelope **de origem** verificado, com seu binding e identidade. Derivar a representação ACP depois da verificação de origem/integridade. ACK e erros para Orbit usam o formato Orbit `1.0.0`, diretamente ou por adaptação versionada. Compatibilidade de forma do ACK não prova recepção. Reencodificação altera representação e pode alterar hashes/assinaturas. A futura política precisa versionar a canonicalização, definir o conteúdo coberto, reter identificação e digest originais e evitar reusar prova de transporte ou recibo de outra versão. Nenhuma suite autoriza transportar um terceiro wire.

**Bloqueios demonstrados no recorte.** O ACK genérico Nexus da fixture Síntese é recusado no Orbit. Os quatro fatos aceitos preservam origem, identidade, sequência, revisão e correlação. ACP aceita `causationid` em casos em que Orbit federation `1.0.0` não possui esse campo. O codec recusa a volta com a causa intacta. Se a causalidade for conhecida e exigida, bloquear a entrega por A até existir sucessor ratificado. Ausência de causa conhecida não autoriza inventá-la. Preservar também as recusas de versões desconhecidas, instalação fora do namespace, motivos incompatíveis e alegações de frescor com lacuna.

## Capabilities e critérios de aceite

- **Orbit → Nexus.** Somente `tenant.created`, `tenant.updated`, `tenant.suspended` e `tenant.reactivated` de fatos confirmados, por produto `orbit-v2`, ambiente e instalação identificados, com escopo explícito e mínimo.
- **Nexus → Orbit.** ACK e erro normalizado da entrega correspondente. Comandos, provisionamento remoto, reads públicos, delegação, assinatura/billing, consentimento e Party/ownership não entram nessa autorização. Snapshot/replay/catch-up são preparação técnica e mantêm seu próprio gate.
- **ACK.** Emitir após commit durável da inbox. Correlacionar a tupla `(source, eventId, payloadSha256)` com o envio original do mesmo binding. Replay equivalente recupera o ACK persistido, inclusive a observação temporal original. Mesmo ID com conteúdo diferente é `MESSAGE_ID_COLLISION`, com quarentena e preservação da entrada inicial. ACK confirma recebimento durável. A projeção é uma etapa posterior e nenhuma autorização de negócio decorre dele.
- **Erro.** Preservar `code`, `correlationId`, `retryable` e mensagem sanitizada, quando a semântica for a mesma. O codec transpõe versão, sem reinterpretar a causa. Os enums atuais distinguem schema inválido, versão incompatível, autoridade insuficiente, conflito de mensagem e dependência indisponível. Veja [matriz](report.md#erros-normalizados) para casos que aguardam política.
- **Identidade.** NXD-02/05/06/07 exigem registro de instalação e identidade M2M qualificada com grants por origem, direção, tipo e ambiente, namespace atestado, ciclo de rotação/revogação e integridade. Origem declarada ou registro inativo não prova confiança. Nenhum papel textual, ID local, CPF/CNPJ, e-mail, Stripe Customer ID ou nome estabelece autoridade/vínculo. O Orbit decide e autoriza suas próprias operações. O Nexus observa fatos qualificados, sem acesso direto ao banco Orbit.
- **Operação.** NXD-08/09/10 exigem inbox persistida, dedupe/digest, retenção/tombstones, orçamento e política de hard limit, isolamento, replay controlado, corte consistente, prova de restore e verificação da lacuna. Limites propostos nas ADRs ainda precisam de aceite. Parar a integração tem de manter o Orbit operacional e deixar cobertura insuficiente explícita.

## Registro bilateral a completar

| Gate | Evidência/aceite esperado | Estado |
| --- | --- | --- |
| 1 · Validação estrutural | Schemas fechados, IDs/versões/locks exatos, corpus preservado | Passou nos testes locais do recorte. |
| 2 · Compatibilidade semântica | Representação dos fatos, motivos, versão persistente, sequência, ACK correlacionável e frescor | Verificada para as fixtures aceitas. Semântica dos writers/revisões e cobertura operacional ainda não verificadas. |
| 3 · Compatibilidade adaptada | Mesmos digests nos dois lados, aceites de tradução sem perda e negativas explícitas | Passou no perfil conhecido. Wire direto segue incompatível. |
| 4 · Aprovação técnica | Mantenedores dos dois sistemas revisam manifest/evidência, instalação, política de wire, pressupostos da captura, hashes e limites | Pendente. |
| 5 · Ratificação bilateral | Identidade dos revisores, data, ressalvas, digests do scope e evidência e aceite do mesmo recorte pelos dois responsáveis | Pendente. |
| 6 · Autorização operacional | Segurança/Identidade/Infra, Backend/Operação e Privacidade qualificam M2M, inbox/ACK, produtor, recuperação, auditoria e retenção | Pendente. |
| 7 · Habilitação runtime | Autorização específica por instalação/ambiente, rollback/kill switch e resultados de rollout isolado | Desabilitada. |

O registro de aceite deve citar o SHA-256 destes artefatos, as versões vinculadas e as exclusões. Nenhum nome de revisor, grant ou aceite foi registrado. Decisões NXD-01/11 permanecem limitadas às diretrizes já aceitas. O aceite NXD-05 do registry inativo permanece com seu alcance original. [Registro Orbit](../pending-nexus-decisions.md)
