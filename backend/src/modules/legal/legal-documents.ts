import {
  LEGAL_DOCUMENT_EFFECTIVE_AT,
  LEGAL_DOCUMENT_VERSION,
  type LegalDocumentReadModel,
  type LegalDocumentSlug,
} from '../../contracts/modules/legal/legal.read-models';

const terms: LegalDocumentReadModel['sections'] = [
  {
    title: '1. Objeto e responsável pelo serviço',
    paragraphs: [
      'O Orbit é uma plataforma de gestão de clientes, equipamentos, operações, documentos e equipes de campo. Estes Termos regulam o uso do painel web, do aplicativo móvel e dos recursos contratados pela organização. A responsável pelo serviço é Allblue Labs Inova Simples, CNPJ 67.312.115/0001-92, localizada em Paulista, Pernambuco, Brasil.',
      'Ao aceitar estes Termos, a pessoa que cadastra a organização declara possuir capacidade para contratar e autorização para representá-la. Cada usuário deve utilizar uma conta individual e informações cadastrais verdadeiras.',
    ],
  },
  {
    title: '2. Conta, segurança e responsabilidades',
    paragraphs: [
      'A organização administra seus usuários, permissões e acesso às unidades. Deve manter credenciais em sigilo, revisar acessos e comunicar suspeitas de uso indevido pelo canal de suporte. A autenticação de dois fatores está disponível nas configurações da conta e é recomendada.',
      'Cabe à organização assegurar que possui autorização para cadastrar dados de clientes e profissionais, coletar imagens, assinaturas, localização e evidências, e entregar informações e documentos a terceiros. A organização responde pela legalidade, exatidão e atualização do conteúdo que insere e pelas decisões operacionais de seus usuários. A Allblue Labs mantém as responsabilidades que lhe são atribuídas pela legislação e por estes Termos; a divisão de tarefas não afasta deveres legais próprios de nenhuma das partes. É vedado inserir conteúdo ilícito, violar direitos, compartilhar credenciais, explorar falhas ou prejudicar outros usuários.',
    ],
  },
  {
    title: '3. Planos, preços e avaliação gratuita',
    paragraphs: [
      'Os recursos, limites, preços, periodicidade e condições comerciais são apresentados antes da contratação. Quando a oferta incluir avaliação, a duração é indicada na contratação e o benefício vale para clientes elegíveis que ainda não o utilizaram nem pagaram um plano. A criação de outra conta não renova a elegibilidade.',
      'Planos sem avaliação dependem de pagamento confirmado para liberar acesso. Ao sair antecipadamente da avaliação para uma contratação paga, os dias gratuitos restantes terminam após a confirmação do pagamento, conforme aviso apresentado antes da contratação. A abertura ou o retorno da página de pagamento não constitui confirmação financeira.',
    ],
  },
  {
    title: '4. Pagamentos, renovação e alteração de plano',
    paragraphs: [
      'Os pagamentos são processados pelo Stripe. A autorização de pagamento e as condições do meio escolhido são apresentadas no ambiente do processador. O Orbit não armazena o número completo do cartão nem seu código de segurança.',
      'Assinaturas com renovação habilitada são cobradas conforme a periodicidade contratada. Na mudança para um plano mensal de valor maior, a primeira cobrança corresponde ao novo período mensal descontado do crédito proporcional pelo tempo pago e ainda não utilizado do plano anterior. O Stripe calcula e cobra a diferença. O novo plano é liberado quando o pagamento for confirmado, conforme o novo ciclo indicado na fatura.',
      'A mudança para um plano mensal de valor menor preserva os recursos do plano atual até o fim do período contratado. O valor do novo plano é cobrado na renovação. O Orbit envia avisos na plataforma nas janelas de 7, 3 e 1 dia antes do vencimento, conforme a antecedência com que a mudança foi solicitada.',
      'Mudanças que envolvam planos semestrais ou anuais são solicitadas nas configurações e encaminhadas ao suporte para análise. O protocolo é exibido na plataforma e o contrato atual permanece em vigor até que as novas condições sejam acertadas.',
      'Se o novo plano tiver limites inferiores e houver excedentes, a organização será avisada e terá 48 horas a partir da vigência da redução para adequar os recursos. Depois, as ações afetadas ficam bloqueadas até a regularização. Esse bloqueio por limite não exclui dados. Cotas mensais de consumo são renovadas conforme a janela de uso informada na plataforma.',
      'Quando o provedor confirma uma falha de pagamento, começa um período de regularização de até sete dias, durante o qual o acesso é mantido. Sem regularização, a assinatura pode ser suspensa até o pagamento. A suspensão por inadimplência não cancela automaticamente a contratação nem inicia, por si só, a exclusão de dados. O prazo de retenção por cancelamento depende da ciência registrada no fluxo correspondente e da data limite informada na plataforma.',
    ],
  },
  {
    title: '5. Cancelamento e prazo de retorno',
    paragraphs: [
      'Em até sete dias corridos da confirmação do pagamento de uma nova contratação ou de uma mudança paga para outro plano, a organização pode solicitar o cancelamento nas configurações. O prazo vale para qualquer periodicidade; a renovação do mesmo plano não o reinicia. O pedido é registrado e, quando a fatura e o pagamento podem ser vinculados e validados, o Orbit encaminha o estorno integral ao meio de pagamento original. Casos que exijam conferência são encaminhados ao suporte para análise. O prazo de processamento do estorno depende da instituição de pagamento, e o acesso termina quando o cancelamento é confirmado.',
      'Após o prazo de sete dias, o pedido abre um chamado para análise do suporte e desativa a próxima renovação. O período já pago e seus limites permanecem disponíveis até o vencimento. Para acompanhar um pedido, use o protocolo informado na plataforma ou escreva para suporte-orbit@allblue-labs.com.',
      'Quando o cancelamento é confirmado com a ciência do prazo de retenção, os dados operacionais ficam preservados pelos primeiros 30 dias após o fim do acesso pago. A plataforma mostra a data a partir da qual podem ser excluídos. Enquanto os dados estiverem disponíveis após o vencimento, a organização pode consultar clientes, atendimentos e histórico e baixar documentos e relatórios já emitidos, conforme suas permissões. Criar e alterar registros fica pausado. Enquanto o plano e as permissões concederem acesso ao recurso, podem ser solicitadas exportações documentais específicas: orçamentos e propostas aceitas em PDF, planos PMOC em PDF e etiquetas QR de equipamentos em SVG, PNG ou PDF. Arquivos dessas exportações ficam disponíveis por 24 horas e cada link de download vale por 300 segundos, podendo ser gerado novamente enquanto a exportação existir. Depois do fim do acesso, a exportação não gera uma cópia integral da base operacional; apenas documentos e relatórios já emitidos e disponíveis podem ser baixados. Uma nova contratação com pagamento confirmado antes do início da exclusão preserva os dados. Apenas iniciar um checkout não representa recontratação. Cancelamentos antigos sem registro dessa ciência não recebem prazo de exclusão retroativo.',
      'Encerrado o prazo sem recontratação, o processamento da exclusão automática dos dados operacionais, incluindo clientes, equipamentos, operações, evidências, documentos e arquivos vinculados, depende de a rotina de retenção estar habilitada e em execução no ambiente operacional. Se essa condição não for atendida, o processamento permanece pendente até que a rotina seja habilitada e executada, e a remoção efetiva poderá ocorrer após a data informada. Enquanto a exclusão estiver pendente e os registros continuarem disponíveis, a consulta segue as permissões da conta. Os downloads disponíveis são de documentos ou relatórios específicos e não constituem uma exportação integral da base operacional. Registros mínimos de conta, aceite, prevenção a fraude e cobrança podem ser conservados enquanto necessários para finalidades legítimas ou obrigações legais, conforme a Política de Privacidade. Cópias de segurança seguem o ciclo e as restrições de acesso da infraestrutura e não garantem a recuperação dos dados excluídos.',
      'Os direitos de arrependimento e restituição previstos na legislação aplicável, inclusive no art. 49 do Código de Defesa do Consumidor quando aplicável, permanecem assegurados.',
    ],
  },
  {
    title: '6. Dados, documentos e trabalho de campo',
    paragraphs: [
      'Os dados e conteúdos inseridos pela organização permanecem sob sua titularidade e a dos respectivos titulares, respeitados os direitos de terceiros. A organização concede ao Orbit autorização limitada ao armazenamento, processamento, apresentação, segurança e suporte necessários à prestação dos recursos contratados. Essa autorização não transfere a titularidade do conteúdo nem permite seu uso para finalidade alheia ao serviço e às obrigações legais.',
      'O aplicativo móvel permite registrar atendimento, evidências, localização e informações das operações de campo. Na função Deslocamento, a posição atual do aparelho é consultada pontualmente enquanto a tela está em uso para calcular, no próprio dispositivo, a distância em linha reta até as coordenadas do atendimento. O aplicativo não declara permissão de localização em segundo plano. A permissão do sistema operacional viabiliza o acesso técnico e não substitui eventual consentimento ou outra base legal exigível. A sincronização dos registros depende de conexão e das permissões concedidas ao dispositivo.',
      'Os recursos de assinatura eletrônica podem registrar evidência gráfica ou conteúdo recebido do provedor, identificação do signatário, texto de consentimento, data e hora, hashes do documento e da assinatura, endereço IP, navegador e, quando enviada, geolocalização. O recurso não emite certificado digital ICP-Brasil. A força probatória depende do documento, das evidências e da legislação aplicável; a organização deve escolher a modalidade adequada à sua atividade. Documentos e assinaturas não substituem a responsabilidade técnica, a conferência humana ou os registros e habilitações exigidos. Não se deve inserir informação sensível desnecessária nem usar o serviço para finalidade incompatível com a contratação.',
    ],
  },
  {
    title: '7. Disponibilidade, integrações e propriedade intelectual',
    paragraphs: [
      'O serviço pode sofrer manutenção, atualizações e indisponibilidades, inclusive por conexão, dispositivo ou serviço externo. Estes Termos não estabelecem percentual de disponibilidade, prazo de resolução ou SLA. A Allblue Labs adota medidas de segurança e recuperação compatíveis com o serviço, sem prometer disponibilidade ininterrupta ou resultados específicos. Falhas de terceiros e eventos tratados como força maior seguem a legislação aplicável e não afastam responsabilidades legais próprias.',
      'Integrações, armazenamento, comunicação e meios de pagamento podem depender de prestadores externos e de suas condições. O Stripe processa os pagamentos segundo seus próprios avisos e condições. Recursos opcionais só devem ser utilizados quando habilitados e autorizados pela organização. Marcas, interface e código do Orbit pertencem a seus respectivos titulares. A contratação concede à organização licença limitada, não exclusiva e não transferível para usar os recursos contratados durante o acesso e, durante eventual janela de recuperação, apenas para consultar e baixar os conteúdos já disponíveis. A licença não transfere propriedade intelectual nem autoriza copiar, revender ou sublicenciar a plataforma.',
    ],
  },
  {
    title: '8. Alterações, atendimento e legislação',
    paragraphs: [
      'A versão e a data destes Termos ficam disponíveis no cadastro, nas configurações e no arquivo para download. Alterações relevantes serão comunicadas e, quando necessário, será solicitado novo aceite. O registro do aceite identifica as versões apresentadas.',
      'Para suporte sobre o serviço e acompanhamento de solicitações, escreva para suporte-orbit@allblue-labs.com. Para assuntos de privacidade, use contato@allblue-labs.com. Não há prazo de resposta ou resolução prometido nestes Termos. Aplicam-se as leis brasileiras, inclusive as regras de proteção de dados e de defesa do consumidor quando cabíveis. Eventuais controvérsias serão tratadas perante o juízo competente segundo a legislação, preservados os direitos de acesso à Justiça.',
    ],
  },
];
const privacy: LegalDocumentReadModel['sections'] = [
  {
    title: '1. Responsável e abrangência',
    paragraphs: [
      'Esta Política explica como o Orbit trata dados no site, painel web e aplicativo móvel. A responsável é Allblue Labs Inova Simples, CNPJ 67.312.115/0001-92, Paulista, Pernambuco, Brasil. O canal de privacidade aparece na identificação deste documento.',
      'Para cadastro, autenticação, segurança, cobrança e relacionamento com seus próprios usuários, a Allblue Labs atua como controladora. Para o conteúdo operacional inserido pela organização cliente, atua como operadora para disponibilizar os recursos contratados, observadas as instruções aplicáveis da organização e a legislação. A organização, como controladora desses dados, define as finalidades, os acessos e as bases legais e informa os titulares. A atuação da Allblue Labs como operadora não afasta os deveres próprios que a lei lhe atribui.',
    ],
  },
  {
    title: '2. Dados tratados e finalidades',
    paragraphs: [
      'Conta e organização: nome, e-mail, credenciais protegidas, perfil, fotografia, assinatura, documento fiscal, endereço, membros, permissões e preferências. Esses dados permitem criar e administrar a conta, identificar a contratante, autenticar usuários e prestar suporte.',
      'Operação: clientes, contatos, endereços, equipamentos, ordens, orçamentos, registros financeiros operacionais, documentos, comentários, imagens, arquivos, assinaturas e evidências inseridos por usuários autorizados. O tratamento permite executar e comprovar os atendimentos e disponibilizar os recursos contratados.',
      'Assinaturas eletrônicas: conforme o fluxo utilizado, podem ser tratados tipo e identificação do signatário, documento informado, evidência gráfica ou conteúdo recebido do provedor, texto de consentimento, data e hora, hash da assinatura e do documento, IP, navegador e geolocalização opcional. Esses registros ficam vinculados ao documento e são acessíveis conforme as permissões aplicáveis. Uma assinatura gráfica ou fotografia não é, por si só, dado biométrico usado para identificar alguém.',
      'Autenticação por biometria ou passkey: a validação biométrica ocorre no dispositivo; o Orbit não recebe nem armazena imagem ou modelo biométrico. Para oferecer o login, o serviço armazena credenciais técnicas, como identificador e chave pública de passkey ou hash de segredo do dispositivo, além de dados necessários à gestão e validação da credencial.',
      'Dispositivo e uso: endereço IP, navegador, registros de acesso e eventos de segurança, instalação móvel e identificadores necessários a notificações e sincronização. Esses dados permitem proteger o serviço, investigar falhas, evitar fraude e entregar comunicações operacionais.',
      'No recurso Deslocamento do aplicativo, a posição atual é solicitada quando a tela é aberta e quando a pessoa escolhe atualizar a posição, enquanto a função está em uso. O aparelho calcula localmente a distância em linha reta até as coordenadas do atendimento; essa consulta, por si só, não envia a posição atual ao Orbit nem cria histórico de trajetos. O aplicativo não declara permissão de localização em segundo plano. Coordenadas já associadas ao atendimento ou enviadas como geolocalização opcional de uma assinatura ficam vinculadas ao respectivo registro. O acesso segue as permissões de leitura do atendimento ou da assinatura e a retenção do registro. Revogar a permissão impede novas leituras do aparelho, mas não apaga coordenadas já inseridas. A permissão do sistema operacional não equivale, por si só, ao consentimento previsto na LGPD; a organização deve informar sua equipe e assegurar a base legal aplicável.',
      'Cobrança: plano, periodicidade, identificação no processador, status, valores e histórico de faturas. Dados de cartão são coletados no ambiente do Stripe; o Orbit não armazena o número completo nem o código de segurança.',
    ],
  },
  {
    title: '3. Fundamentos do tratamento e escolhas',
    paragraphs: [
      'As bases variam conforme a finalidade e o caso concreto. Cadastro, autenticação e disponibilização dos recursos contratados podem apoiar-se em procedimentos preliminares ou na execução do contrato. Dados de cobrança podem ser tratados para executar o contrato e, quando aplicável, cumprir obrigações legais. Segurança, prevenção a fraude e exercício de direitos dependem da base adequada à situação, inclusive obrigação legal, exercício regular de direitos ou interesse legítimo após avaliação. Para conteúdo operacional inserido pela organização cliente, cabe a ela definir a finalidade e a base legal, como controladora. O consentimento é utilizado somente quando necessário para uma finalidade específica; o aceite dos Termos não autoriza uso irrestrito dos dados.',
      'Dados pessoais sensíveis não devem ser incluídos sem necessidade e fundamento apropriado. O usuário pode ajustar permissões do dispositivo e preferências de comunicação. Comunicações indispensáveis à conta, à segurança e à cobrança podem continuar sendo enviadas enquanto necessárias.',
    ],
  },
  {
    title: '4. Compartilhamento e serviços de terceiros',
    paragraphs: [
      'Os dados são apresentados aos membros e destinatários autorizados pela organização. Prestadores de infraestrutura, armazenamento, entrega de comunicações e pagamento podem tratar os dados necessários à prestação do serviço, inclusive como suboperadores quando aplicável. A Allblue Labs mantém os deveres legais próprios de sua atuação; o uso desses prestadores não transfere automaticamente suas responsabilidades. O Stripe processa pagamentos segundo seus próprios avisos de privacidade e condições.',
      'Integrações, quando habilitadas, podem enviar aos respectivos prestadores apenas as informações necessárias à tarefa solicitada. A organização deve conferir as permissões e evitar compartilhar conteúdo desnecessário.',
      'Também pode haver compartilhamento para cumprir obrigação legal, ordem válida de autoridade ou defender direitos. O Orbit não comercializa bases de dados pessoais para publicidade.',
    ],
  },
  {
    title: '4.1. Transferências internacionais de dados',
    paragraphs: [
      'O Amazon SES processa os dados necessários ao envio de e-mails transacionais, como endereço do destinatário e conteúdo da mensagem, durante a entrega e o tratamento de falhas de envio. Quando é usada a região de Ohio, o processamento ocorre nos Estados Unidos. Os e-mails atendem a finalidades como confirmar o endereço, recuperar o acesso e enviar avisos de conta.',
      'Para processar pagamentos, prevenir fraudes e cumprir suas obrigações, o Stripe pode tratar dados cadastrais e de cobrança nos Estados Unidos e em outras jurisdições em que atuam suas afiliadas e prestadores. O tratamento ocorre durante a prestação do serviço e pelos períodos de conservação aplicáveis. O aditivo de transferências do Stripe prevê o uso das cláusulas-padrão da ANPD quando aplicáveis às transferências do Brasil.',
      'A Allblue Labs limita os dados enviados à finalidade de cada integração, restringe o acesso às credenciais e utiliza conexões criptografadas com os serviços. As transferências devem observar os mecanismos da LGPD e as salvaguardas aplicáveis. O titular pode solicitar detalhes sobre destinos, destinatários, prazos e garantias por contato@allblue-labs.com e exercer os direitos descritos ao final desta Política.',
    ],
  },
  {
    title: '5. Cookies e armazenamento no dispositivo',
    paragraphs: [
      'O painel web usa cookies próprios para autenticação, preferências e avisos. `orbit_access` e `orbit_portal_access` duram conforme a validade do token recebido, com fallback de 15 minutos; `orbit_refresh` e `orbit_portal_refresh` podem durar até 30 dias. Os cookies de autenticação são HttpOnly, SameSite=Lax e Secure em produção. `orbit_theme` e `orbit_sidebar` guardam preferências por até um ano; `sidebar_state`, por até sete dias; e `orbit_aviso_assinatura`, por 12 horas. Esses prazos são os máximos configurados no código e podem terminar antes se a sessão ou o cookie for removido.',
      'O navegador também usa sessionStorage para dados temporários de navegação e do convite de autenticação sem senha, removidos ao fim da sessão ou após o fluxo. localStorage pode guardar a preferência de não exibir novamente esse convite até que os dados do navegador sejam apagados. O aplicativo móvel pode manter dados locais necessários ao trabalho e à sincronização. A configuração do navegador ou dispositivo pode restringir esses armazenamentos. Tecnologias de terceiros habilitadas por integrações podem ter avisos próprios; o aceite desta Política não autoriza rastreamento opcional que dependa de consentimento.',
    ],
  },
  {
    title: '6. Conservação e exclusão após cancelamento',
    paragraphs: [
      'Enquanto a assinatura estiver vigente, os dados operacionais são mantidos para prestar o serviço. O prazo de retenção de 30 dias é registrado no fluxo de cancelamento após a organização receber e confirmar essa condição; a data limite é informada na plataforma. Quando configurado, o prazo começa após o fim do acesso pago. Falha de pagamento, suspensão ou bloqueio por limite de plano não inicia, por si só, esse prazo. Cancelamentos antigos sem registro da confirmação não recebem prazo retroativo.',
      'Após o vencimento, enquanto os dados estiverem disponíveis, a organização pode consultar clientes, atendimentos e histórico e baixar documentos e relatórios já emitidos, conforme suas permissões. Criar e alterar registros fica pausado. Enquanto o plano e as permissões concederem acesso ao recurso, podem ser solicitadas exportações documentais específicas: orçamentos e propostas aceitas em PDF, planos PMOC em PDF e etiquetas QR de equipamentos em SVG, PNG ou PDF. Arquivos dessas exportações ficam disponíveis por 24 horas e cada link de download vale por 300 segundos, podendo ser gerado novamente enquanto a exportação existir. Depois do fim do acesso, a exportação não gera uma cópia integral da base operacional; apenas documentos e relatórios já emitidos e disponíveis podem ser baixados. Direitos legais de portabilidade, quando aplicáveis, permanecem preservados. A contratação com pagamento confirmado antes do início da exclusão preserva os dados; iniciar o checkout não basta.',
      'Ao final dos 30 dias sem recontratação, o processamento da exclusão automática dos dados operacionais e dos arquivos vinculados depende de a rotina de retenção estar habilitada e em execução no ambiente operacional. Se essa condição não for atendida, o processamento permanece pendente até que a rotina seja habilitada e executada, e a remoção efetiva poderá ocorrer após a data informada. Enquanto a exclusão estiver pendente e os registros continuarem disponíveis, a consulta segue as permissões da conta. Quando a rotina opera, a remoção de arquivos é acompanhada e repetida em caso de falha. Eventuais cópias de segurança ficam sujeitas ao ciclo de retenção e às restrições de acesso da infraestrutura; a existência de uma cópia não garante recuperação ao cliente.',
      'Registros mínimos de identidade e administração da conta, aceite dos documentos, cobrança, prevenção de fraude e registros exigidos por lei podem ser mantidos separadamente enquanto necessários às respectivas finalidades. Eles não preservam a base operacional para restauração após o prazo. Pedidos de eliminação são analisados considerando também as hipóteses legais de conservação.',
      'Bloqueio por exceder limites de um plano é diferente do encerramento: a adequação de cotas não exclui automaticamente registros. O prazo de 30 dias descrito aqui depende do cancelamento com a condição informada e confirmada, não da mera suspensão da assinatura.',
    ],
  },
  {
    title: '7. Segurança e incidentes',
    paragraphs: [
      'O Orbit aplica controles de acesso por organização, permissões, proteção de credenciais e medidas técnicas para reduzir acessos indevidos e perda de dados. Nenhum ambiente é isento de riscos. Usuários devem proteger suas credenciais, manter dispositivos atualizados e comunicar suspeitas de incidente.',
      'Incidentes são avaliados e tratados conforme sua natureza e as obrigações aplicáveis. Quando a Allblue Labs atuar como operadora, auxiliará a organização controladora na medida exigida pela legislação e pelas instruções aplicáveis. Comunicações a controladores, titulares ou autoridades são realizadas nos casos e prazos previstos na legislação e na regulamentação aplicáveis; esta Política não cria prazo interno adicional.',
    ],
  },
  {
    title: '8. Direitos e canal de privacidade',
    paragraphs: [
      'O exercício dos direitos previstos na LGPD é gratuito e pode ser solicitado pelo canal de privacidade indicado neste documento. O titular pode pedir confirmação e acesso, correção, informações sobre compartilhamento, portabilidade quando aplicável, revisão de decisões automatizadas e anonimização, bloqueio ou eliminação nas hipóteses legais. Também pode revogar consentimento, opor-se ao tratamento ou peticionar à ANPD, nos casos cabíveis. A confirmação da existência de tratamento ou o acesso podem ser fornecidos em formato simplificado imediatamente ou por declaração clara e completa em até 15 dias, nos termos e limites do art. 19 da LGPD; esse prazo não se aplica automaticamente a todos os direitos.',
      'O próprio titular ou representante autorizado pode apresentar o pedido. Para proteger os dados, pode ser solicitada confirmação proporcional da identidade e, quando for o caso, da representação. Para dados de atendimentos cadastrados por uma organização cliente, o pedido deve ser dirigido inicialmente à organização controladora; a Allblue Labs a auxiliará na medida aplicável. Para dados de conta ou para identificar o responsável pelo atendimento, escreva para contato@allblue-labs.com.',
      'Esta Política possui versão e data de vigência. Alterações relevantes serão comunicadas pelos canais da plataforma. A leitura e o download permanecem disponíveis no cadastro e nas configurações.',
    ],
  },
];
export function legalDocument(slug: LegalDocumentSlug): LegalDocumentReadModel {
  return {
    slug,
    title:
      slug === 'termos'
        ? 'Termos de Uso do Orbit'
        : 'Política de Privacidade do Orbit',
    version: LEGAL_DOCUMENT_VERSION,
    effectiveAt: LEGAL_DOCUMENT_EFFECTIVE_AT,
    provider: {
      name: 'Allblue Labs Inova Simples',
      document: '67.312.115/0001-92',
      location: 'Paulista, Pernambuco, Brasil',
      privacyEmail: 'contato@allblue-labs.com',
    },
    sections: slug === 'termos' ? terms : privacy,
  };
}
