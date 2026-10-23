import {
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
      'Cabe à organização assegurar que possui autorização para cadastrar dados de clientes e profissionais, coletar imagens, assinaturas, localização e evidências, e entregar informações e documentos a terceiros. É vedado inserir conteúdo ilícito, violar direitos, compartilhar credenciais, explorar falhas ou prejudicar outros usuários.',
    ],
  },
  {
    title: '3. Planos, preços e avaliação gratuita',
    paragraphs: [
      'Os recursos, limites, preços, periodicidade e condições comerciais são apresentados antes da contratação. O Essencial oferece 30 dias de avaliação para clientes elegíveis que ainda não utilizaram o benefício nem pagaram um plano. A criação de outra conta não renova a elegibilidade.',
      'Planos sem avaliação dependem de pagamento confirmado para liberar acesso. Ao sair antecipadamente da avaliação para uma contratação paga, os dias gratuitos restantes terminam após a confirmação do pagamento, conforme aviso apresentado antes da contratação. A abertura ou o retorno da página de pagamento não constitui confirmação financeira.',
    ],
  },
  {
    title: '4. Pagamentos, renovação e alteração de plano',
    paragraphs: [
      'Os pagamentos são processados pelo Stripe. A autorização de pagamento e as condições do meio escolhido são apresentadas no ambiente do processador. O Orbit não armazena o número completo do cartão nem seu código de segurança.',
      'Assinaturas com renovação habilitada são cobradas conforme a periodicidade contratada. Mudanças de plano já pago, inclusive de periodicidade, são agendadas para o próximo vencimento. O plano, o prazo e as cotas do período atual permanecem válidos até essa data, sem cobrança antecipada pela mudança.',
      'Se o novo plano tiver limites inferiores e houver excedentes, a organização será avisada e terá 48 horas a partir da vigência da redução para adequar os recursos. Depois, as ações afetadas ficam bloqueadas até a regularização. Esse bloqueio por limite não exclui dados. Cotas mensais de consumo são renovadas conforme a janela de uso informada na plataforma.',
    ],
  },
  {
    title: '5. Cancelamento e prazo de retorno',
    paragraphs: [
      'O cancelamento solicitado nas configurações desativa a renovação do próximo vencimento. O período já pago e seus limites continuam disponíveis até o fim contratado. Enquanto esse período estiver vigente, a organização pode desfazer o cancelamento.',
      'Após o vencimento, o uso operacional fica inativo e a plataforma oferece nova contratação. Os dados operacionais permanecem disponíveis para recuperação por 30 dias contados do término do acesso. A data limite é informada na plataforma. A recontratação com pagamento confirmado antes do início da exclusão preserva esses dados; apenas iniciar um checkout não representa recontratação.',
      'Passados os 30 dias sem recontratação, o sistema inicia a exclusão automática dos dados operacionais, incluindo clientes, equipamentos, operações, evidências, documentos e arquivos vinculados. A exclusão é definitiva para o ambiente ativo e não representa pausa por limite de plano. Registros mínimos de conta, aceite, prevenção a fraude e cobrança podem ser conservados para finalidades legítimas e obrigações legais, conforme a Política de Privacidade.',
      'O cancelamento da recorrência não impede o exercício de direitos de arrependimento, restituição ou outros direitos previstos na legislação aplicável. Solicitações de restituição serão analisadas conforme a lei e as circunstâncias da contratação; nenhuma cláusula destes Termos limita direitos obrigatórios do consumidor.',
    ],
  },
  {
    title: '6. Dados, documentos e trabalho de campo',
    paragraphs: [
      'Os dados inseridos pela organização continuam sob sua responsabilidade e titularidade, respeitados os direitos das pessoas a quem se referem. A organização concede ao Orbit a autorização necessária para armazenar, processar e apresentar esse conteúdo para prestar o serviço.',
      'O aplicativo móvel permite registrar atendimento, evidências, localização e informações das operações de campo. A sincronização depende de conexão e das permissões concedidas ao dispositivo. A organização deve conferir a conclusão da sincronização e a emissão dos documentos antes de considerar uma entrega finalizada.',
      'Documentos, assinaturas e recursos de inteligência auxiliam a operação, mas não substituem a responsabilidade técnica, a conferência humana ou os registros e habilitações exigidos pela atividade. Não se deve inserir informação sensível desnecessária ou usar o serviço para finalidades incompatíveis com a contratação.',
    ],
  },
  {
    title: '7. Disponibilidade, integrações e propriedade intelectual',
    paragraphs: [
      'O serviço pode sofrer manutenção, atualizações e indisponibilidades. A Allblue Labs adota medidas de segurança e recuperação compatíveis com o serviço, sem prometer disponibilidade ininterrupta ou resultados específicos. Incidentes e responsabilidades são tratados conforme a legislação aplicável.',
      'Integrações e meios de pagamento dependem também de terceiros e de suas condições. Recursos opcionais só devem ser utilizados quando habilitados e autorizados pela organização. Marcas, interface e código do Orbit pertencem a seus respectivos titulares; a contratação concede direito de uso dos recursos contratados, sem transferência desses direitos.',
    ],
  },
  {
    title: '8. Alterações, atendimento e legislação',
    paragraphs: [
      'A versão e a data destes Termos ficam disponíveis no cadastro, nas configurações e no arquivo para download. Alterações relevantes serão comunicadas e, quando necessário, será solicitado novo aceite. O registro do aceite identifica as versões apresentadas.',
      'Aplicam-se as leis brasileiras, inclusive as regras de proteção de dados e de defesa do consumidor quando cabíveis. Eventuais controvérsias serão tratadas perante o juízo competente segundo a legislação, preservados os direitos de acesso à Justiça. Solicitações sobre o serviço podem ser encaminhadas ao canal de contato identificado neste documento.',
    ],
  },
];
const privacy: LegalDocumentReadModel['sections'] = [
  {
    title: '1. Responsável e abrangência',
    paragraphs: [
      'Esta Política explica como o Orbit trata dados no site, painel web e aplicativo móvel. A responsável é Allblue Labs Inova Simples, CNPJ 67.312.115/0001-92, Paulista, Pernambuco, Brasil. O canal de privacidade aparece na identificação deste documento.',
      'Para cadastro, segurança, cobrança e relacionamento com seus usuários, a Allblue Labs atua como controladora. Para o conteúdo operacional cadastrado por uma organização cliente, atua como operadora, seguindo as instruções da organização, que é responsável por informar os titulares e assegurar a legitimidade do tratamento.',
    ],
  },
  {
    title: '2. Dados tratados e finalidades',
    paragraphs: [
      'Conta e organização: nome, e-mail, credenciais protegidas, perfil, fotografia, assinatura, documento fiscal, endereço, membros, permissões e preferências. Esses dados permitem criar e administrar a conta, identificar a contratante, autenticar usuários e prestar suporte.',
      'Operação: clientes, contatos, endereços, equipamentos, ordens, orçamentos, registros financeiros operacionais, documentos, comentários, imagens, arquivos, assinaturas e evidências inseridos por usuários autorizados. O tratamento permite executar e comprovar os atendimentos e disponibilizar os recursos contratados.',
      'Dispositivo e uso: endereço IP, navegador, registros de acesso e eventos de segurança, instalação móvel e identificadores necessários a notificações e sincronização. Esses dados permitem proteger o serviço, investigar falhas, evitar fraude e entregar comunicações operacionais.',
      'Localização, câmera, arquivos e notificações do aplicativo dependem das funções utilizadas e das permissões do dispositivo. A localização serve à operação de campo e aos recursos habilitados pela organização. A organização deve informar sua equipe sobre as configurações de acompanhamento; a revogação de uma permissão pode impedir o recurso correspondente.',
      'Cobrança: plano, periodicidade, identificação no processador, status, valores e histórico de faturas. Dados de cartão são coletados no ambiente do Stripe; o Orbit não armazena o número completo nem o código de segurança.',
    ],
  },
  {
    title: '3. Fundamentos do tratamento e escolhas',
    paragraphs: [
      'Conforme a finalidade e o caso concreto, o tratamento se apoia na execução do contrato, em obrigações legais, no exercício de direitos, na segurança e em interesses legítimos avaliados ou no consentimento quando necessário. O aceite dos Termos não autoriza uso irrestrito dos dados nem substitui o consentimento específico exigível.',
      'Dados pessoais sensíveis não devem ser incluídos sem necessidade e fundamento apropriado. O usuário pode ajustar permissões do dispositivo e preferências de comunicação. Comunicações indispensáveis à conta, à segurança e à cobrança podem continuar sendo enviadas enquanto necessárias.',
    ],
  },
  {
    title: '4. Compartilhamento e serviços de terceiros',
    paragraphs: [
      'Os dados são apresentados aos membros e destinatários autorizados pela organização. Prestadores de infraestrutura, armazenamento, entrega de comunicações e pagamento podem tratá-los na medida necessária ao serviço. O Stripe processa pagamentos segundo seus próprios avisos de privacidade e condições.',
      'Recursos de inteligência e integrações, quando habilitados, podem enviar aos respectivos prestadores apenas as informações necessárias à tarefa solicitada. A organização deve conferir as permissões e evitar compartilhar conteúdo desnecessário. Esta Política não autoriza treinamento irrestrito de modelos com dados operacionais.',
      'Também pode haver compartilhamento para cumprir obrigação legal, ordem válida de autoridade ou defender direitos. O Orbit não comercializa bases de dados pessoais para publicidade. Caso um serviço envolva transferência internacional, serão observados os mecanismos e as garantias aplicáveis.',
    ],
  },
  {
    title: '5. Cookies e armazenamento no dispositivo',
    paragraphs: [
      'O painel utiliza cookies e armazenamento do navegador para sessão, segurança, preferências e continuidade de fluxos, como a escolha de plano. O aplicativo pode manter dados locais necessários ao trabalho e à sincronização. Dispositivos compartilhados devem ser protegidos e a sessão encerrada após o uso.',
      'A configuração do navegador ou do dispositivo pode restringir esse armazenamento, prejudicando funções essenciais. Recursos opcionais de rastreamento que dependam de consentimento não ficam autorizados apenas pelo aceite desta Política.',
    ],
  },
  {
    title: '6. Conservação e exclusão após cancelamento',
    paragraphs: [
      'Enquanto a assinatura estiver vigente, os dados operacionais são mantidos para prestar o serviço. Cancelar a recorrência preserva o acesso até o fim do período contratado. Após esse término, os dados operacionais ficam disponíveis para recuperação durante 30 dias. O pagamento de uma nova contratação, confirmado antes de iniciada a exclusão, interrompe esse processo.',
      'Ao final dos 30 dias sem recontratação, é iniciada a exclusão automática dos dados operacionais e dos arquivos vinculados no ambiente ativo. A remoção de arquivos é acompanhada e repetida em caso de falha. Eventuais cópias de segurança ficam sujeitas ao ciclo de retenção e às restrições de acesso da infraestrutura; a existência de uma cópia não garante recuperação ao cliente.',
      'Registros mínimos de identidade e administração da conta, aceite dos documentos, cobrança, prevenção de fraude e registros exigidos por lei podem ser mantidos separadamente enquanto necessários às respectivas finalidades. Eles não preservam a base operacional para restauração após o prazo. Pedidos de eliminação são analisados considerando também as hipóteses legais de conservação.',
      'Bloqueio por exceder limites de um plano é diferente do encerramento: a adequação de cotas não exclui automaticamente registros. O prazo de 30 dias descrito aqui corresponde ao encerramento de acesso decorrente de cancelamento com essa condição informada.',
    ],
  },
  {
    title: '7. Segurança e incidentes',
    paragraphs: [
      'O Orbit aplica controles de acesso por organização, permissões, proteção de credenciais e medidas técnicas para reduzir acessos indevidos e perda de dados. Nenhum ambiente é isento de riscos. Usuários devem proteger suas credenciais, manter dispositivos atualizados e comunicar suspeitas de incidente.',
      'Incidentes são avaliados e tratados conforme sua natureza e as obrigações aplicáveis, inclusive comunicações aos responsáveis e autoridades quando exigíveis.',
    ],
  },
  {
    title: '8. Direitos e canal de privacidade',
    paragraphs: [
      'O titular pode solicitar confirmação e acesso, correção, informações sobre compartilhamento, portabilidade quando aplicável, revisão de decisões automatizadas e anonimização, bloqueio ou eliminação nas hipóteses legais. Também pode revogar consentimento e apresentar oposição ou petição à ANPD, nos casos cabíveis.',
      'Para dados de atendimentos cadastrados por uma organização cliente, o pedido deve ser dirigido inicialmente à organização controladora; a Allblue Labs poderá auxiliá-la. Para dados de conta ou para identificar o responsável pelo atendimento, utilize o canal de privacidade deste documento. Pode ser necessária confirmação proporcional de identidade para impedir divulgação indevida.',
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
    effectiveAt: '2026-10-23',
    provider: {
      name: 'Allblue Labs Inova Simples',
      document: '67.312.115/0001-92',
      location: 'Paulista, Pernambuco, Brasil',
      privacyEmail: 'contato@allblue-labs.com',
    },
    sections: slug === 'termos' ? terms : privacy,
  };
}
