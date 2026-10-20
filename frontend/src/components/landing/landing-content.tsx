"use client";

/**
 * O conteúdo da landing.
 *
 * Componente de cliente porque a página tem animação de entrada e revelação
 * por rolagem. O catálogo de planos **não** é buscado aqui: chega pronto do
 * Server Component que envolve esta tela, numa leitura pública feita no
 * servidor. Buscar no navegador atrasaria a seção de preços para depois da
 * hidratação, que é justamente onde a página perde a visita.
 *
 * ## Por que a página não é uma grade de recursos
 *
 * Era: crachá "nova geração", manchete com palavra em gradiente, três números
 * inventados, seis cartões de recurso, uma faixa de duas colunas e um banner
 * final. É o formato que toda página de SaaS tem, e ele não diz o que o Orbit
 * faz — os seis cartões falavam de "processos orquestrados" e "automação
 * assistida", que servem para qualquer software do mundo.
 *
 * Serviço de campo tem uma **cronologia real**: o contrato gera a visita, a
 * visita chega ao técnico, o técnico preenche e comprova, o cliente assina, o
 * documento sai. A página passou a seguir essa cadeia. A numeração das etapas
 * existe porque há mesmo uma ordem — não como enfeite.
 *
 * ## Os números que saíram
 *
 * "38% menos retrabalho", "2,4x mais rápido no fechamento" e "99,9% de
 * disponibilidade" não têm origem: não há medição, contrato de nível de
 * serviço publicado nem estudo por trás. Uma landing pode fazer promessas —
 * mas quem as faz precisa poder sustentá-las, e inventar precisão é o tipo de
 * coisa que um cliente cobra na primeira reunião. No lugar delas ficou o que é
 * verificável: os módulos que existem e o que cada um faz.
 */
import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  ClipboardCheck,
  FileText,
  Receipt,
  Signature,
  Smartphone,
  Users,
  Wallet,
  WifiOff,
} from "lucide-react";
import { motion } from "motion/react";

import { AllblueSignature } from "@/components/brand/allblue-signature";
import { OrbitLogo } from "@/components/brand/orbit-logo";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";
import type { PlanCatalog } from "@/types/billing";

/**
 * A cadeia de um atendimento, na ordem em que acontece.
 *
 * Cada etapa é uma tela que existe no produto — não uma promessa. É por isso
 * que elas são numeradas: a ordem é a do trabalho, e quem opera reconhece.
 */
const etapas = [
  {
    icon: CalendarClock,
    titulo: "O plano gera a visita",
    texto:
      "PMOC e visita técnica recorrente têm cadência própria. O sistema abre as ocorrências do período e a agenda já nasce preenchida.",
  },
  {
    icon: Smartphone,
    titulo: "O técnico recebe em campo",
    texto:
      "A fila de trabalho chega no aplicativo com cliente, endereço, setor e os equipamentos daquele atendimento.",
  },
  {
    icon: ClipboardCheck,
    titulo: "O roteiro é preenchido",
    texto:
      "Cada tipo de serviço tem o seu checklist, cadastrado uma vez. O que o técnico marca em campo é o que compõe o relatório.",
  },
  {
    icon: Signature,
    titulo: "O cliente confere e assina",
    texto:
      "Fotos, medições e assinatura ficam presas ao atendimento que as registrou. Mudou o escopo depois, o aceite é invalidado.",
  },
  {
    icon: FileText,
    titulo: "O documento sai pronto",
    texto:
      "O PDF é emitido a partir da execução, com a trilha de quem fez o quê e quando. Nada é redigitado.",
  },
] as const;

/** Os módulos com o nome que eles têm dentro do produto. */
const modulos = [
  {
    icon: ClipboardCheck,
    nome: "Atendimentos",
    texto: "Ordens de serviço do chamado à assinatura, com evidência em campo.",
  },
  {
    icon: CalendarClock,
    nome: "PMOC e visitas técnicas",
    texto: "Planos recorrentes que abrem as próprias ocorrências e cobram prazo.",
  },
  {
    icon: Users,
    nome: "Clientes e equipamentos",
    texto: "O parque instalado pertence a quem contratou, com QR Code em campo.",
  },
  {
    icon: Receipt,
    nome: "Orçamentos",
    texto: "Do catálogo de serviços à aprovação do cliente, virando atendimento.",
  },
  {
    icon: Wallet,
    nome: "Financeiro",
    texto: "A receita que a operação gera, ligada ao documento que a originou.",
  },
  {
    icon: FileText,
    nome: "Documentos e relatórios",
    texto: "O que foi emitido, o retrato do período e os modelos que definem os dois.",
  },
] as const;

/**
 * A revelação move, mas nunca apaga.
 *
 * O padrão anterior partia de `opacity: 0`, e o Next grava esse estilo inline
 * no HTML servido. Enquanto o JavaScript não assume, a página de marketing
 * inteira fica invisível — e se ele falhar, fica invisível para sempre. O
 * texto está lá, o robô de busca lê, e a pessoa vê branco.
 *
 * Deslocar alguns pixels dá o mesmo efeito de entrada e falha visível: sem
 * JavaScript o conteúdo apenas não anima.
 */
const aparecer = {
  initial: { y: 14 },
  whileInView: { y: 0 },
  viewport: { once: true, margin: "-60px" },
} as const;

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      {/*
        Altura automática e quebra de linha — mesma razão da página de planos:
        em 375 a marca e os dois botões não cabem numa linha só.
      */}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:h-16 sm:flex-nowrap sm:px-6 sm:py-0">
        <Link
          href="/"
          aria-label="Orbit — início"
          className="rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <OrbitLogo />
        </Link>
        <nav
          aria-label="Navegação"
          className="hidden items-center gap-6 md:flex"
        >
          <a
            href="#operacao"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Como funciona
          </a>
          <a
            href="#modulos"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Módulos
          </a>
          <Link
            href={ROUTES.plans}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Planos
          </Link>
        </nav>
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="sm">
            <Link href="/login">Entrar</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/cadastro">
              Começar agora
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * Um atendimento como o produto o mostra.
 *
 * Substitui o gráfico de barras decorativo que estava aqui. Uma landing de
 * software operacional precisa mostrar o objeto de trabalho — e este é
 * reconhecível para quem já emitiu uma ordem de serviço.
 */
function CartaoExemplo() {
  return (
    <figure
      aria-label="Exemplo de um atendimento no Orbit"
      className="glass-panel rounded-2xl p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-xs text-muted-foreground">
            OS-20260913-004821
          </p>
          <p className="mt-1 truncate text-sm font-semibold text-foreground">
            Manutenção preventiva trimestral
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-success/12 px-2.5 py-1 text-[11px] font-medium text-success">
          Concluído
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-4">
        {[
          ["Cliente", "Rede de lojas — exemplo"],
          ["Local", "Unidade Centro · Auditório"],
          ["Equipamentos", "3 splits, 1 chiller"],
          ["Técnico", "Responsável + 1 auxiliar"],
        ].map(([rotulo, valor]) => (
          <div key={rotulo} className="min-w-0">
            <dt className="text-[11px] text-muted-foreground">{rotulo}</dt>
            <dd className="truncate text-xs text-foreground">{valor}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-4 border-t border-border/70 pt-4">
        <div className="flex items-baseline justify-between">
          <p className="text-[11px] text-muted-foreground">
            Roteiro de manutenção
          </p>
          <p className="font-mono text-[11px] text-foreground">12/12</p>
        </div>
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="presentation"
        >
          <div className="bg-gradient-orbit h-full w-full rounded-full" />
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Signature className="size-3.5 shrink-0" aria-hidden />
          Assinado pelo cliente em campo · documento emitido
        </p>
      </div>
    </figure>
  );
}

/**
 * O rodapé.
 *
 * ## Só destinos que existem
 *
 * Um rodapé de SaaS costuma listar Documentação, Status, Blog, Carreiras e
 * Imprensa porque o molde pede — e metade cai em 404. Aqui cada link vai para
 * uma página ou âncora que existe hoje. Quando houver central de ajuda e
 * página de status, elas entram; até lá, prometer é pior que omitir.
 *
 * ## O suporte aponta para a AllBlue
 *
 * Não há e-mail nem telefone de suporte publicado no produto, e inventar um
 * endereço num rodapé é garantir que alguém escreva para o vazio. Enquanto o
 * canal oficial não existir, quem precisa falar com alguém chega à empresa que
 * faz o Orbit.
 */
const COLUNAS: {
  titulo: string;
  itens: { rotulo: string; href: string; externo?: boolean }[];
}[] = [
  {
    titulo: "Produto",
    itens: [
      { rotulo: "Como funciona", href: "#operacao" },
      { rotulo: "Módulos", href: "#modulos" },
      { rotulo: "Planos e preços", href: ROUTES.plans },
      { rotulo: "A plataforma", href: "/plataforma" },
    ],
  },
  {
    titulo: "Operação",
    itens: [
      { rotulo: "Ordens de serviço", href: "#modulos" },
      { rotulo: "PMOC e visitas técnicas", href: "#modulos" },
      { rotulo: "Orçamentos", href: "#modulos" },
      { rotulo: "Documentos e relatórios", href: "#modulos" },
    ],
  },
  {
    titulo: "Conta",
    itens: [
      { rotulo: "Entrar", href: "/login" },
      { rotulo: "Criar organização", href: "/cadastro" },
      { rotulo: "Recuperar senha", href: "/recuperar-senha" },
    ],
  },
  {
    titulo: "Suporte",
    itens: [
      {
        rotulo: "Falar com a AllBlue Labs",
        href: "https://allblue-labs.com",
        externo: true,
      },
    ],
  },
];

function Rodape() {
  return (
    <footer className="border-t border-border bg-muted/20">
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <OrbitLogo />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              O ERP de operações para quem faz manutenção em campo: ordem de
              serviço, PMOC e visita técnica no mesmo cadastro.
            </p>
          </div>

          {COLUNAS.map((coluna) => (
            <nav key={coluna.titulo} aria-label={coluna.titulo}>
              <p className="font-mono text-xs tracking-[0.12em] text-foreground uppercase">
                {coluna.titulo}
              </p>
              <ul className="mt-4 space-y-2.5">
                {coluna.itens.map((item) => (
                  <li key={item.rotulo}>
                    {item.externo ? (
                      <a
                        href={item.href}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        {item.rotulo}
                      </a>
                    ) : item.href.startsWith("#") ? (
                      <a
                        href={item.href}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        {item.rotulo}
                      </a>
                    ) : (
                      <Link
                        href={item.href}
                        className="text-sm text-muted-foreground hover:text-foreground"
                      >
                        {item.rotulo}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col-reverse items-start justify-between gap-4 border-t border-border pt-6 sm:flex-row sm:items-center">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Orbit Operations ERP · Todos os
            direitos reservados
          </p>
          <AllblueSignature />
        </div>
      </div>
    </footer>
  );
}

export function LandingContent({ catalog }: { catalog: PlanCatalog }) {
  return (
    <div className="min-h-dvh bg-background">
      <Header />

      <main>
        {/* ------------------------------------------------------------ */}
        {/* Hero                                                          */}
        {/* ------------------------------------------------------------ */}
        <section className="bg-aurora relative overflow-hidden">
          <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:gap-16 lg:py-28">
            <motion.div
              initial={{ y: 16 }}
              animate={{ y: 0 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            >
              {/*
                Uma linha de contexto no lugar do crachá.

                "Orbit V2 — nova geração" falava da versão do software para
                quem ainda não sabe o que ele faz. Isto diz para quem é.
              */}
              <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
                ERP de operações · refrigeração e climatização
              </p>
              <h1 className="mt-4 font-display text-4xl leading-[1.06] font-bold tracking-tight text-balance text-foreground sm:text-5xl">
                Do contrato ao documento assinado,{" "}
                <span className="text-gradient-orbit">sem redigitar nada</span>
              </h1>
              <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
                O Orbit conduz a ordem de serviço, o PMOC e a visita técnica de
                ponta a ponta: o plano abre a agenda, o técnico preenche em
                campo — mesmo sem sinal — e o relatório sai pronto do que foi
                feito.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button asChild size="lg">
                  <Link href="/cadastro">
                    Começar agora
                    <ArrowRight className="size-4" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline">
                  <a href="#operacao">Ver como funciona</a>
                </Button>
              </div>
              <p className="mt-6 text-sm text-muted-foreground">
                Implantação guiada · sem custo de setup · suporte em português
              </p>
            </motion.div>

            <motion.div
              initial={{ y: 24 }}
              animate={{ y: 0 }}
              transition={{
                duration: 0.5,
                delay: 0.12,
                ease: [0.22, 1, 0.36, 1],
              }}
            >
              <CartaoExemplo />
            </motion.div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* A cadeia do atendimento                                       */}
        {/* ------------------------------------------------------------ */}
        <section
          id="operacao"
          className="border-y border-border bg-muted/30"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
                Um atendimento, do começo ao fim
              </h2>
              <p className="mt-3 text-muted-foreground">
                Cinco etapas que já acontecem na sua operação. A diferença é que
                cada uma entrega a próxima pronta, em vez de virar uma planilha.
              </p>
            </div>

            {/*
              Uma trilha, e não uma grade.

              A borda superior dos cartões é o fio que liga as etapas: no
              desktop elas ficam lado a lado, na ordem, e em telas estreitas
              viram uma coluna — que continua sendo uma sequência, só que
              vertical. Numerar aqui diz algo verdadeiro; numerar a grade de
              recursos anterior não dizia.
            */}
            <ol className="mt-12 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-5">
              {etapas.map((etapa, indice) => (
                <motion.li
                  key={etapa.titulo}
                  {...aparecer}
                  transition={{ duration: 0.3, delay: indice * 0.05 }}
                  className="relative border-t-2 border-border pt-5"
                >
                  <span
                    className="bg-gradient-orbit absolute -top-px left-0 h-0.5 w-8"
                    aria-hidden
                  />
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs text-muted-foreground">
                      {String(indice + 1).padStart(2, "0")}
                    </span>
                    <etapa.icon
                      className="size-4 text-primary"
                      aria-hidden
                    />
                  </div>
                  <h3 className="mt-3 text-sm font-semibold text-foreground">
                    {etapa.titulo}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {etapa.texto}
                  </p>
                </motion.li>
              ))}
            </ol>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Campo                                                         */}
        {/* ------------------------------------------------------------ */}
        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
            <motion.div {...aparecer} transition={{ duration: 0.35 }}>
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
                Casa de máquinas não tem sinal
              </h2>
              <p className="mt-3 text-muted-foreground">
                É onde o trabalho acontece, e é onde a maioria dos sistemas
                para. O aplicativo do técnico funciona offline e sincroniza
                quando o sinal volta — sem perder foto, medição nem assinatura.
              </p>
              <ul className="mt-8 space-y-5">
                {[
                  {
                    icon: WifiOff,
                    titulo: "Fila de trabalho no bolso",
                    texto:
                      "O que foi designado fica disponível no aparelho, com o histórico do equipamento.",
                  },
                  {
                    icon: ClipboardCheck,
                    titulo: "Evidência presa ao atendimento",
                    texto:
                      "Foto e medição pertencem à execução que as registrou, e ninguém as move depois.",
                  },
                  {
                    icon: Signature,
                    titulo: "Aceite do cliente na hora",
                    texto:
                      "A assinatura é colhida no aparelho e entra no documento junto com o que foi feito.",
                  },
                ].map((item) => (
                  <li key={item.titulo} className="flex gap-3">
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
                      <item.icon className="size-4" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        {item.titulo}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                        {item.texto}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </motion.div>

            <motion.div
              {...aparecer}
              transition={{ duration: 0.35, delay: 0.08 }}
              className="glass-panel rounded-3xl p-6"
            >
              <p className="font-mono text-xs tracking-[0.14em] text-muted-foreground uppercase">
                Fila do técnico
              </p>
              <ul className="mt-4 space-y-2">
                {[
                  ["08:30", "Preventiva trimestral", "Unidade Centro"],
                  ["10:15", "Corretiva — split não gela", "Unidade Norte"],
                  ["14:00", "Visita técnica mensal", "Unidade Porto"],
                ].map(([hora, titulo, local]) => (
                  <li
                    key={hora}
                    className="flex items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5"
                  >
                    <span className="font-mono text-xs text-muted-foreground">
                      {hora}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {titulo}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {local}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
                <WifiOff className="size-3.5 shrink-0" aria-hidden />
                Disponível offline · sincroniza sozinho
              </p>
            </motion.div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* Módulos                                                       */}
        {/* ------------------------------------------------------------ */}
        <section
          id="modulos"
          className="border-y border-border bg-muted/30"
        >
          <div className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6">
            <div className="max-w-2xl">
              <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
                Os módulos, pelo nome que você usa
              </h2>
              <p className="mt-3 text-muted-foreground">
                Um cadastro só, compartilhado por todos. O cliente que aparece
                no orçamento é o mesmo do PMOC e o mesmo da cobrança.
              </p>
            </div>

            <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
              {/*
                Divisórias de um pixel no lugar de seis cartões soltos.

                Os módulos não são seis produtos: são um sistema. Uma malha
                contínua diz isso; cartões com sombra dizem o contrário.
              */}
              {modulos.map((modulo, indice) => (
                <motion.article
                  key={modulo.nome}
                  {...aparecer}
                  transition={{ duration: 0.3, delay: indice * 0.03 }}
                  className="bg-card p-6"
                >
                  <modulo.icon className="size-5 text-primary" aria-hidden />
                  <h3 className="mt-4 text-base font-semibold text-foreground">
                    {modulo.nome}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {modulo.texto}
                  </p>
                </motion.article>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/*
          Planos — o resumo comercial.

          Resumo, e não a página de preços inteira: quatro cartões, a
          periodicidade e o caminho para a comparação completa. Trazer as
          tabelas de limites para cá empurraria o resto da landing para baixo
          da dobra sem responder melhor a pergunta que se faz aqui, que é
          "quanto custa e o que eu levo".
        */}
        {/* ------------------------------------------------------------ */}
        <section
          id="planos"
          className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6"
        >
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-bold tracking-tight text-foreground">
              Planos
            </h2>
            <p className="mt-3 text-muted-foreground">
              Todos incluem a operação completa. O que muda é o volume — e, em
              dois deles, a camada de inteligência.
            </p>
          </div>

          <div className="mt-10">
            <PricingPlans catalog={catalog} variant="resumo" />
          </div>
        </section>

        {/* ------------------------------------------------------------ */}
        {/* CTA                                                           */}
        {/* ------------------------------------------------------------ */}
        <section className="mx-auto w-full max-w-6xl px-4 pb-20 sm:px-6">
          <div className="bg-gradient-orbit relative overflow-hidden rounded-3xl px-8 py-14 text-center">
            <h2 className="font-display text-3xl font-bold text-primary-foreground sm:text-4xl">
              Coloque sua operação em órbita
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-primary-foreground/85 sm:text-base">
              Comece pelo acesso à plataforma e evolua módulo a módulo, no seu
              ritmo.
            </p>
            <Button asChild size="lg" variant="secondary" className="mt-8">
              <Link href="/cadastro">
                Criar minha conta
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      <Rodape />
    </div>
  );
}
