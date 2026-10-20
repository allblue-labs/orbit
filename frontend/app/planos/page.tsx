import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";

import { OrbitLogo } from "@/components/brand/orbit-logo";
import { PricingPlans } from "@/components/pricing/pricing-plans";
import { carregarCatalogoPublico } from "@/components/pricing/pricing-catalog";
import { Button } from "@/components/ui/button";
import { ROUTES } from "@/lib/routes";

export const metadata: Metadata = {
  title: "Planos e preços — Orbit",
  description:
    "Quatro planos para operações de climatização e refrigeração, com cobrança mensal, semestral ou anual.",
};

/**
 * Planos — a página comercial pública.
 *
 * ## Sem sessão
 *
 * Server Component que lê `GET /plans/catalog`, uma rota pública do backend.
 * Quem chega de um anúncio não tem conta, e exigir login para ver preço é a
 * forma mais rápida de perder a visita.
 *
 * ## Uma leitura
 *
 * O catálogo inteiro vem numa chamada — preços das três periodicidades,
 * limites e capacidades de todos os planos. Buscar por plano transformaria a
 * página numa cascata de requisições para montar uma tabela.
 *
 * ## O que a página não sabe
 *
 * Se **você** tem direito à avaliação gratuita. A página anuncia a regra do
 * plano; a decisão é do backend na contratação, e antecipá-la aqui exigiria
 * perguntar publicamente se um documento já usou o benefício — que é um
 * verificador de quem é cliente do Orbit.
 */
/**
 * Renderizada a cada requisição.
 *
 * O catálogo de planos vem do backend, e o backend não existe durante o build:
 * gerar esta página estaticamente faria a compilação depender de um servidor
 * no ar — e assaria os preços de um instante no HTML publicado.
 *
 * O custo é pequeno porque a leitura do catálogo é cacheada por cinco minutos
 * no nível do `fetch`: muitas visitas, uma ida ao backend.
 */
export const dynamic = "force-dynamic";

export default async function PlanosPage() {
  const catalog = await carregarCatalogoPublico();

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur-xl">
        {/*
          Altura automática e quebra de linha.
          Em 375 pixels a marca e os dois botões não cabem lado a lado, e a
          barra transbordava a página inteira para a direita. Deixar quebrar
          custa uma linha a mais no celular; esconder o "Entrar" custaria o
          caminho de quem já é cliente.
        */}
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-3 sm:h-16 sm:flex-nowrap sm:py-0 sm:px-6">
          <Link href={ROUTES.home} aria-label="Orbit — início">
            <OrbitLogo />
          </Link>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href={ROUTES.login}>Entrar</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={ROUTES.register}>
                Começar agora
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 lg:py-20">
        <div className="max-w-2xl">
          <h1 className="font-display text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Planos para cada tamanho de operação
          </h1>
          <p className="mt-3 text-base leading-relaxed text-muted-foreground">
            Todos incluem a operação completa: clientes, equipamentos, ordens de
            serviço, PMOC, visitas técnicas, documentos e o aplicativo de campo.
            O que muda é o volume — e, em dois deles, a camada de inteligência.
          </p>
        </div>

        <div className="mt-10">
          <PricingPlans catalog={catalog} />
        </div>

        <section className="mt-16 space-y-6">
          <h2 className="font-display text-2xl font-bold tracking-tight text-foreground">
            Perguntas frequentes
          </h2>
          <dl className="grid gap-6 sm:grid-cols-2">
            {PERGUNTAS.map((item) => (
              <div key={item.pergunta}>
                <dt className="text-sm font-semibold text-foreground">
                  {item.pergunta}
                </dt>
                <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {item.resposta}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="mt-16 rounded-2xl border border-border bg-muted/30 p-6">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Comece pelo cadastro
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Você cria a conta, cadastra a empresa e escolhe o plano com os
                dados da operação já no lugar. A contratação acontece dentro da
                plataforma, com a empresa identificada.
              </p>
              <Button asChild className="mt-4">
                <Link href={ROUTES.register}>
                  Criar conta
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row sm:px-6">
          <OrbitLogo />
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} Orbit Operations ERP. Todos os direitos
            reservados.
          </p>
        </div>
      </footer>
    </div>
  );
}

const PERGUNTAS: readonly { pergunta: string; resposta: string }[] = [
  {
    pergunta: "As cotas mensais valem para qualquer periodicidade?",
    resposta:
      "Sim. Cota de uso é sempre mensal — assinar por ano dá desconto no preço, não doze meses de uso de uma vez.",
  },
  {
    pergunta: "Quem tem direito à avaliação gratuita?",
    resposta:
      "O plano Essencial oferece 30 dias na primeira contratação elegível. A verificação acontece no momento da contratação, com a empresa identificada.",
  },
  {
    pergunta: "Dá para trocar de plano depois?",
    resposta:
      "Sim, pela própria plataforma, em Configurações. A troca respeita o período que já foi pago.",
  },
  {
    pergunta: "O que é a camada de inteligência?",
    resposta:
      "O Orbit Intelligence e os agentes auxiliares, disponíveis nos planos Profissional + Inteligência e Empresarial Ilimitado.",
  },
];
