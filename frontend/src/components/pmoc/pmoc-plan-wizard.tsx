"use client";

/**
 * Criação de um PMOC, em cinco etapas.
 *
 * ## Por que deixou de ser um formulário plano
 *
 * A versão anterior pedia código, nome, datas e periodicidade numa tela só, e
 * mandava escolher os equipamentos **depois**, no detalhe. O resultado está no
 * banco: setenta e cinco planos ativos sem equipamento nenhum — planos que
 * têm execução, aparecem na lista e não mandam ninguém a lugar nenhum, porque
 * sem equipamento não há execução para projetar.
 *
 * A ordem aqui não é estética. O cliente vem primeiro porque tudo depende
 * dele: o código sugerido, quais equipamentos existem, e a validação de posse
 * que o servidor refaz no fim.
 *
 * ## O que esta tela **não** decide
 *
 * Nem a sequência do código, nem quantas execuções vão existir, nem quais
 * equipamentos são elegíveis. Tudo isso vem do servidor — a etapa de revisão
 * mostra a matriz que o `POST /pmoc/plans/preview` devolveu, não uma
 * multiplicação feita aqui. Uma vigência que começa dia 31 tem regra de
 * calendário, e ela mora no domínio e no banco; uma terceira cópia em
 * JavaScript de formulário divergiria na primeira virada de mês.
 */
import { useMemo, useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { PmocUnitsField } from "@/components/pmoc/pmoc-units.field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAssetsList } from "@/hooks/assets/use-assets";
import { useCustomersList } from "@/hooks/customers/use-customers";
import {
  useCreatePmocPlan,
  usePmocCodeSuggestion,
  usePmocPreview,
  usePmocPlanActivation,
  usePmocPlanNameOptions,
} from "@/hooks/pmoc/use-pmoc";
import {
  useFieldTechnicians,
  useTechnicalResponsibles,
} from "@/hooks/workforce/use-workforce";
import { PROFESSIONAL_ROLES } from "@/registry";
import { useSession } from "@/providers/session-provider";
import { useActiveScope } from "@/providers/use-active-scope";
import type { Asset, AssetQuery } from "@/types/assets";
import {
  avisoDoResponsavelTecnico,
  responsavelTecnicoPadrao,
} from "./pmoc-technical-responsible";
import {
  CADENCIAS,
  cadenciaDoIntervalo,
  descricaoDaCadencia,
  intervaloDaCadencia,
  type CadenciaKey,
} from "./pmoc-cadence";
import { PmocFrequencyUnit } from "@/types/contracts";
import type { PmocPreview } from "@/types/pmoc";
import {
  avisosDaRevisao,
  dataCivil,
  fatosDaProgramacao,
  primeirasVisitas,
} from "./pmoc-review";
import { Package } from "lucide-react";

import {
  ListState,
  Pagination,
  SearchField,
  useListController,
} from "@/workspace";

const FREQUENCY_LABELS: Readonly<Record<string, string>> = {
  DAYS: "dia(s)",
  WEEKS: "semana(s)",
  MONTHS: "mês(es)",
  YEARS: "ano(s)",
};

/**
 * A periodicidade com que um PMOC nasce.
 *
 * Mensal porque é a mais comum em contrato de manutenção predial — e porque abrir
 * em "Personalizada" obrigaria todo mundo a preencher dois campos para dizer o caso
 * mais frequente.
 */
const FREQUENCIA_PADRAO = {
  amount: 1,
  unit: PmocFrequencyUnit.MONTHS,
} as const;

/** `Select` não aceita item de valor vazio; este é o "ninguém ainda". */
const SEM_TECNICO = "__none__";

/** A saída do catálogo: quem escolhe isto digita o próprio nome. */
const NOME_OUTROS = "__outros__";

const ETAPAS = [
  "Cliente",
  "Equipamentos",
  "Programação",
  "Responsáveis",
  "Unidades",
  "Revisão",
] as const;

export function PmocPlanWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { businessUnitId } = useActiveScope();
  /* O dono é o Responsável Técnico padrão; a sessão é quem sabe quem ele é. */
  const session = useSession();
  const customers = useCustomersList({ limit: 100 });
  const tecnicos = useFieldTechnicians();
  const nomeOpcoes = usePmocPlanNameOptions();

  /** O que está marcado no seletor — um rótulo do catálogo, ou "Outros". */
  const [nomeEscolhido, setNomeEscolhido] = useState("");
  const create = useCreatePmocPlan();
  /* O plano nasce ativo: a revisão é o momento de conferir, e depois dela rascunho
     é um estado que ninguém pediu. */
  const activation = usePmocPlanActivation();
  /**
   * O plano que acabou de ser criado, quando a ativação dele falhou.
   *
   * Enquanto está preenchido, o rodapé oferece **ativar de novo** em vez de criar:
   * o plano já existe, e um segundo "Criar PMOC" produziria um duplicado para
   * resolver um erro que não é de criação.
   */
  const [criadoSemAtivar, setCriadoSemAtivar] = useState<string | null>(null);
  const preview = usePmocPreview();

  const [etapa, setEtapa] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [code, setCode] = useState("");

  /**
   * O usuário mexeu no código?
   *
   * Só para a UX do §121/§122: enquanto ele não mexeu, trocar o cliente
   * recalcula o campo. Depois que mexeu, não sobrescrevemos o que ele
   * escreveu — o campo é dele.
   */
  const [codigoEditado, setCodigoEditado] = useState(false);

  const [name, setName] = useState("");
  const [startsOn, setStartsOn] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [vigenciaAmount, setVigenciaAmount] = useState("12");
  const [vigenciaUnit, setVigenciaUnit] = useState<string>(
    PmocFrequencyUnit.MONTHS,
  );
  /**
   * A periodicidade escolhida por nome.
   *
   * O par (número, unidade) continua sendo o que vai ao servidor; a cadência é o
   * atalho que o contrato usa — mensal, trimestral, semestral. Ver `pmoc-cadence`
   * para por que "1 mês(es)" num campo numérico lia-se como "quantas vezes no mês".
   */
  const [frequenciaAmount, setFrequenciaAmount] = useState(
    String(FREQUENCIA_PADRAO.amount),
  );
  const [frequenciaUnit, setFrequenciaUnit] = useState<string>(
    FREQUENCIA_PADRAO.unit,
  );
  /* Derivada do par, e não um terceiro literal: três constantes que precisam
     concordar é uma a mais do que precisa existir. */
  const [cadencia, setCadencia] = useState<CadenciaKey>(() =>
    cadenciaDoIntervalo(FREQUENCIA_PADRAO.amount, FREQUENCIA_PADRAO.unit),
  );
  const [tecnicoId, setTecnicoId] = useState("");
  const [selecionados, setSelecionados] = useState<readonly Asset[]>([]);

  /** As unidades que este plano atende — ids de `PmocUnit`. */
  const [unidades, setUnidades] = useState<readonly string[]>([]);

  const sugestao = usePmocCodeSuggestion(customerId || null);

  /**
   * O código exibido é **derivado**, não sincronizado.
   *
   * A primeira versão empurrava a sugestão para o estado dentro de um efeito.
   * Funcionava e estava errado: o campo passava a ter duas fontes de verdade —
   * o que o servidor sugeriu e o que o estado guardou — e elas divergiam por
   * um render a cada troca de cliente. Derivando, existe uma só: enquanto o
   * usuário não digitou, o campo **é** a sugestão.
   */
  const codigoExibido = codigoEditado
    ? code
    : (sugestao.data?.suggestedCode ?? "");

  /**
   * Trocar de cliente limpa a seleção — no evento, não num efeito.
   *
   * Os ids que sobrariam são de equipamentos de outro cliente, e o servidor
   * recusaria a criação inteira no fim do wizard, depois de a pessoa ter
   * percorrido cinco etapas.
   */
  const trocarCliente = (proximo: string) => {
    if (proximo === customerId) return;
    setCustomerId(proximo);
    setSelecionados([]);
    if (!codigoEditado) setCode("");
  };

  const assetsController = useListController<AssetQuery>({
    limit: 8,
    initial: { customerId, businessUnitId: businessUnitId ?? undefined },
  });

  /**
   * Cliente e unidade sobrescrevem o que o controlador guardou.
   *
   * O controlador nasce com o cliente da primeira renderização; trocar de
   * cliente na etapa 1 precisa alcançar a consulta, senão a lista continuaria
   * mostrando os equipamentos do cliente anterior.
   */
  const assetsQuery = useMemo(
    () => ({
      ...assetsController.query,
      customerId,
      businessUnitId: businessUnitId ?? undefined,
    }),
    [assetsController.query, customerId, businessUnitId],
  );
  const assets = useAssetsList(assetsQuery);

  const selecionadoIds = useMemo(
    () => new Set(selecionados.map((asset) => asset.id)),
    [selecionados],
  );

  /**
   * A seleção sobrevive à paginação e à busca.
   *
   * Guardamos o objeto inteiro, e não só o id: a revisão precisa do nome, e na
   * página três o equipamento da página um já não está na resposta.
   */
  const alternar = (asset: Asset, marcado: boolean) => {
    setSelecionados((atual) =>
      marcado
        ? atual.some((item) => item.id === asset.id)
          ? atual
          : [...atual, asset]
        : atual.filter((item) => item.id !== asset.id),
    );
  };

  const pagina = assets.data?.data ?? [];
  const paginaInteiraMarcada =
    pagina.length > 0 && pagina.every((asset) => selecionadoIds.has(asset.id));

  const cliente = (customers.data?.data ?? []).find(
    (item) => item.id === customerId,
  );

  /**
   * Escolher a cadência preenche o par que vai ao servidor.
   *
   * O par continua sendo a verdade — é ele que o contrato aceita e o que a projeção
   * recebe. A cadência só escreve nele, e "Personalizada" para de escrever para
   * devolver os dois campos a quem digita.
   */
  const escolherCadencia = (proxima: CadenciaKey) => {
    setCadencia(proxima);
    const intervalo = intervaloDaCadencia(proxima);
    if (!intervalo) return;
    setFrequenciaAmount(String(intervalo.amount));
    setFrequenciaUnit(intervalo.unit);
  };

  /**
   * Os candidatos a Responsável Técnico desta unidade.
   *
   * Seletor próprio, e não o mesmo dos técnicos de campo: são dois papéis e duas
   * perguntas — quem vai ao local, e quem responde tecnicamente pelo contrato. Ver
   * `pmoc-technical-responsible`.
   */
  const responsaveisTecnicos = useTechnicalResponsibles(
    businessUnitId ? { businessUnitId } : undefined,
  );
  const candidatosRT = responsaveisTecnicos.data ?? [];

  /**
   * A escolha, e o padrão aplicado uma vez.
   *
   * `null` significa "ainda não houve escolha nem padrão"; assim a lista chegando
   * depois consegue preencher sem sobrescrever quem o usuário já escolheu.
   */
  const [rtEscolhido, setRtEscolhido] = useState<string | null>(null);
  const rtId =
    rtEscolhido ??
    responsavelTecnicoPadrao(candidatosRT, session.user?.id ?? null);
  const avisoRT = avisoDoResponsavelTecnico(candidatosRT, rtId);

  const entradaDoPreview = useMemo(
    () => ({
      businessUnitId: businessUnitId ?? "",
      customerId,
      startsOn,
      coverageAmount: Number(vigenciaAmount) || 0,
      coverageUnit: vigenciaUnit,
      frequencyAmount: Number(frequenciaAmount) || 0,
      frequencyUnit: frequenciaUnit,
      assetIds: selecionados.map((asset) => asset.id),
    }),
    [
      businessUnitId,
      customerId,
      startsOn,
      vigenciaAmount,
      vigenciaUnit,
      frequenciaAmount,
      frequenciaUnit,
      selecionados,
    ],
  );

  /**
   * A projeção é pedida ao entrar na revisão, e não a cada tecla.
   *
   * Recalcular a cada dígito da data mandaria uma requisição por caractere, e
   * as respostas chegariam fora de ordem — a tela mostraria a projeção de uma
   * data que o usuário já terminou de apagar.
   */
  const [projecao, setProjecao] = useState<PmocPreview | null>(null);
  const projetar = () => {
    if (!businessUnitId || !customerId) return;
    preview.mutate(entradaDoPreview, { onSuccess: setProjecao });
  };

  const podeAvancar = [
    Boolean(customerId && name.trim()),
    selecionados.length > 0,
    Boolean(startsOn) &&
      Number(vigenciaAmount) > 0 &&
      Number(frequenciaAmount) > 0,
    true,
    /*
      Unidade é opcional de propósito: há plano que o owner ainda não modelou
      por unidade, e travar aqui impediria de cadastrar o plano. O aviso na
      própria etapa diz o que a omissão custa no relatório.
    */
    true,
    Boolean(projecao),
  ][etapa];

  const avancar = () => {
    if (!podeAvancar) return;
    if (etapa === 4) projetar();
    setEtapa((atual) => Math.min(atual + 1, ETAPAS.length - 1));
  };

  const fechar = () => {
    setEtapa(0);
    setProjecao(null);
    setUnidades([]);
    /* Volta ao padrão: `null` é "ainda não houve escolha", e é o que faz o dono
       ser pré-selecionado de novo no próximo plano. */
    setRtEscolhido(null);
    setCriadoSemAtivar(null);
    onOpenChange(false);
  };

  /** Só a última etapa cria. Avançar de etapa nunca escreve nada. */
  /**
   * Ativa o plano e só fecha dando certo.
   *
   * Falhando, o diálogo **fica aberto** com o erro: um plano em rascunho na listagem,
   * sem explicação, é o sintoma que não se diagnostica — a pessoa configurou tudo,
   * clicou em criar, e o PMOC não gera ciclo nem entra na agenda. Aqui ela lê o
   * motivo e tenta de novo sem recriar nada.
   */
  const ativar = (planoId: string) => {
    activation.mutate(planoId, {
      onSuccess: fechar,
      onError: () => setCriadoSemAtivar(planoId),
    });
  };

  const criar = () => {
    if (!businessUnitId || !projecao) return;
    create.mutate(
      {
        businessUnitId,
        customerId,
        /**
         * Código só vai quando o usuário mexeu. Mandar o sugerido de volta
         * seria uma corrida perdida: duas telas abertas leem o mesmo `003` e
         * a segunda falharia ao salvar. Omitindo, o servidor aloca o próximo
         * dentro da própria transação.
         */
        ...(codigoEditado && code.trim() ? { code: code.trim() } : {}),
        name: name.trim(),
        startsOn,
        endsOn: projecao.endsOn ?? undefined,
        frequencyAmount: Number(frequenciaAmount),
        frequencyUnit: frequenciaUnit,
        ...(tecnicoId ? { technicianUserId: tecnicoId } : {}),
        ...(rtId ? { technicalResponsibleUserId: rtId } : {}),
        assetIds: selecionados.map((asset) => asset.id),
        ...(unidades.length > 0 ? { unitIds: [...unidades] } : {}),
      },
      {
        /**
         * Criar e ativar, nessa ordem.
         *
         * O plano nascia em rascunho e ficava lá: o wizard coleta tudo — cliente,
         * equipamentos, programação, responsáveis, unidades — e termina numa revisão,
         * que **é** o momento de conferir antes de o plano produzir trabalho. Depois
         * dela, rascunho é um estado que ninguém pediu e que nada na tela mandava
         * sair: o PMOC não gerava ciclo, não entrava na agenda e não avisava por quê.
         *
         * Ativar não é trocar um campo: abre a primeira execução, cria o evento na
         * agenda e agenda as checagens de vencimento. Por isso é uma chamada própria,
         * e por isso ela vem **depois** — uma falha aqui não desfaz o plano, que
         * continua existindo em rascunho com a ação "Ativar" na listagem.
         */
        onSuccess: (plano) => ativar(plano.id),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : fechar())}>
      <DialogContent
        /*
          Cresce na horizontal, e nunca passa da tela na vertical.

          O diálogo base é uma grade sem teto de altura: a revisão ficou mais
          informativa, a caixa cresceu com ela e o rodapé saiu da tela — ficava
          impossível concluir o PMOC depois de configurá-lo todo.

          `max-h-[90dvh]` com coluna flex resolve: cabeçalho e rodapé não encolhem,
          e a sobra fica para o corpo da etapa, que é o único a rolar. `dvh` e não
          `vh` porque no celular a barra do navegador muda a altura visível, e `vh`
          mede a maior — a conta erra exatamente na direção que esconde o rodapé.

          A largura sobe para `4xl`: a revisão tem informação que cabe em duas
          colunas, e usar a horizontal é o que a tira da vertical.
        */
        className="flex max-h-[90dvh] max-w-4xl flex-col gap-4"
        /*
          Clicar fora não fecha, e `Esc` também não.

          São seis etapas de configuração — cliente, equipamentos, programação,
          responsável, unidades — e nada disso é rascunho salvo: fechar descarta
          tudo. Num diálogo de uma pergunta, fechar por clique fora é conveniência;
          aqui é perder dez minutos de trabalho por mirar mal o mouse.
          Sai pelo "Cancelar", que é uma decisão.
        */
        onInteractOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => event.preventDefault()}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>Novo PMOC</DialogTitle>
          <DialogDescription>
            {`Etapa ${etapa + 1} de ${ETAPAS.length} — ${ETAPAS[etapa]}`}
          </DialogDescription>
        </DialogHeader>

        <ol className="flex shrink-0 flex-wrap gap-2" aria-label="Etapas">
          {ETAPAS.map((rotulo, indice) => (
            <li
              key={rotulo}
              aria-current={indice === etapa ? "step" : undefined}
              className={
                indice === etapa
                  ? "rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
                  : indice < etapa
                    ? "rounded-full bg-muted px-3 py-1 text-xs font-medium text-foreground"
                    : "rounded-full px-3 py-1 text-xs text-muted-foreground"
              }
            >
              {rotulo}
            </li>
          ))}
        </ol>

        {/*
          O único que rola.

          `min-h-0` é o que faz o `overflow` valer dentro de uma coluna flex: sem
          ele o item adota a altura do conteúdo e volta a empurrar o rodapé, que é
          o bug que esta linha existe para não deixar voltar.
        */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1">
          {etapa === 0 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="pmoc-customer">Cliente</Label>
                <Select value={customerId} onValueChange={trocarCliente}>
                  <SelectTrigger id="pmoc-customer">
                    <SelectValue placeholder="Selecione o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {(customers.data?.data ?? []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.tradeName ?? item.legalName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pmoc-code">Código</Label>
                <Input
                  id="pmoc-code"
                  value={codigoExibido}
                  maxLength={60}
                  placeholder={
                    sugestao.isPending && customerId
                      ? "Gerando sugestão…"
                      : "Selecione o cliente"
                  }
                  onChange={(event) => {
                    setCode(event.target.value);
                    setCodigoEditado(true);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  {codigoEditado
                    ? "Código próprio. Avisamos se ele já estiver em uso."
                    : "Sugerido automaticamente. Você pode editar."}
                </p>
              </div>

              {/*
                O nome vem de um catálogo, com saída para o que não está nele.

                Era campo livre, e cada plano nascia com uma grafia diferente
                do mesmo serviço — "Manutenção preventiva", "Preventiva",
                "MANUT. PREV." —, o que torna a lista de planos impossível de
                ler e o relatório inconsistente. O catálogo é da plataforma;
                "Outros" continua permitindo qualquer nome.
              */}
              <div className="space-y-2">
                <Label htmlFor="pmoc-name-option">Nome</Label>
                <Select
                  value={nomeEscolhido}
                  onValueChange={(valor) => {
                    setNomeEscolhido(valor);
                    /// Escolher da lista grava o rótulo; "Outros" limpa o
                    /// campo para quem vai digitar.
                    setName(valor === NOME_OUTROS ? "" : valor);
                  }}
                >
                  <SelectTrigger id="pmoc-name-option">
                    <SelectValue placeholder="Selecione o tipo de plano" />
                  </SelectTrigger>
                  <SelectContent>
                    {(nomeOpcoes.data ?? []).map((opcao) => (
                      <SelectItem key={opcao.key} value={opcao.label}>
                        {opcao.label}
                      </SelectItem>
                    ))}
                    <SelectItem value={NOME_OUTROS}>Outros…</SelectItem>
                  </SelectContent>
                </Select>

                {nomeEscolhido === NOME_OUTROS ? (
                  <Input
                    id="pmoc-name"
                    value={name}
                    maxLength={160}
                    autoFocus
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Como este plano se chama"
                  />
                ) : null}
              </div>
            </>
          )}

          {etapa === 1 && (
            <>
              {/*
                A busca ocupa a linha inteira.

                Dividindo espaço com a contagem, ela ficava com pouco mais de
                um terço da largura do diálogo — estreita demais para o que se
                digita nela (nome, identificação, série ou fabricante). A
                contagem é curta e cabe embaixo.
              */}
              <div className="space-y-2">
                <SearchField
                  id="pmoc-wizard-equipment-search"
                  className="w-full"
                  value={assetsController.searchTerm}
                  onChange={assetsController.setSearchTerm}
                  label="Buscar"
                  placeholder="Nome, identificação, série ou fabricante"
                />
                <p className="text-sm text-muted-foreground">
                  {selecionados.length} selecionado
                  {selecionados.length === 1 ? "" : "s"}
                </p>
              </div>

              <ListState
                isPending={assets.isPending}
                error={assets.error}
                onRetry={() => void assets.refetch()}
                items={pagina}
                rows={4}
                empty={{
                  icon: <Package className="size-5" />,
                  title: "Nenhum equipamento para este cliente",
                  description:
                    "Cadastre o equipamento no cliente, ou ajuste a busca.",
                }}
              >
                {(linhas) => (
                  <div
                    /* Sem teto próprio de altura: o corpo da etapa já é o único
                       que rola, e um segundo scroll aqui dentro é o que ninguém
                       encontra. */
                    className="space-y-1"
                  >
                    <label className="flex items-center gap-3 border-b px-1 py-2 text-sm font-medium">
                      <Checkbox
                        checked={paginaInteiraMarcada}
                        onCheckedChange={(valor) => {
                          for (const asset of pagina) {
                            alternar(asset, valor === true);
                          }
                        }}
                        aria-label="Selecionar todos desta página"
                      />
                      Selecionar todos desta página
                    </label>

                    {linhas.map((asset) => (
                      <label
                        key={asset.id}
                        className="flex items-start gap-3 rounded-md px-1 py-2 text-sm hover:bg-muted/60"
                      >
                        <Checkbox
                          checked={selecionadoIds.has(asset.id)}
                          onCheckedChange={(valor) =>
                            alternar(asset, valor === true)
                          }
                          aria-label={asset.name}
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {asset.name}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {[asset.manufacturer, asset.model, asset.location]
                              .filter(Boolean)
                              .join(" · ") || "Sem detalhes cadastrados"}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </ListState>

              <Pagination
                meta={assets.data?.meta}
                onPrevious={assetsController.previousPage}
                onNext={assetsController.nextPage}
                isFetching={assets.isFetching}
              />
            </>
          )}

          {etapa === 2 && (
            <>
              <div className="space-y-2">
                <Label htmlFor="pmoc-starts">Data inicial</Label>
                <Input
                  id="pmoc-starts"
                  type="date"
                  value={startsOn}
                  onChange={(event) => setStartsOn(event.target.value)}
                />
              </div>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">Vigência</legend>
                <p className="text-xs text-muted-foreground">
                  Por quanto tempo o contrato vale.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    id="pmoc-vigencia"
                    type="number"
                    min={1}
                    value={vigenciaAmount}
                    aria-label="Duração da vigência"
                    onChange={(event) => setVigenciaAmount(event.target.value)}
                  />
                  <Select value={vigenciaUnit} onValueChange={setVigenciaUnit}>
                    <SelectTrigger aria-label="Unidade da vigência">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.values(PmocFrequencyUnit).map((valor) => (
                        <SelectItem key={valor} value={valor}>
                          {FREQUENCY_LABELS[valor] ?? valor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </fieldset>

              <fieldset className="space-y-2 rounded-md border p-3">
                <legend className="px-1 text-sm font-medium">
                  Frequência de atendimento
                </legend>
                <p className="text-xs text-muted-foreground">
                  De quanto em quanto tempo a equipe vai ao local.
                </p>

                {/*
                  Pelo nome do contrato, não por número solto.

                  "3" e "mês(es)" é literalmente de três em três meses, mas ninguém
                  lê assim: parecia *quantas vezes* no mês, e quem queria trimestral
                  não achava onde dizer. Personalizada continua existindo porque
                  "a cada 45 dias" é contrato real.
                */}
                <Select
                  value={cadencia}
                  onValueChange={(valor) =>
                    escolherCadencia(valor as CadenciaKey)
                  }
                >
                  <SelectTrigger
                    id="pmoc-cadencia"
                    aria-label="Periodicidade do atendimento"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CADENCIAS.map((item) => (
                      <SelectItem key={item.key} value={item.key}>
                        {item.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="PERSONALIZADA">
                      Personalizada…
                    </SelectItem>
                  </SelectContent>
                </Select>

                {cadencia === "PERSONALIZADA" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Input
                      id="pmoc-frequencia"
                      type="number"
                      min={1}
                      value={frequenciaAmount}
                      aria-label="Intervalo entre atendimentos"
                      onChange={(event) =>
                        setFrequenciaAmount(event.target.value)
                      }
                    />
                    <Select
                      value={frequenciaUnit}
                      onValueChange={setFrequenciaUnit}
                    >
                      <SelectTrigger aria-label="Unidade da frequência">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.values(PmocFrequencyUnit).map((valor) => (
                          <SelectItem key={valor} value={valor}>
                            {FREQUENCY_LABELS[valor] ?? valor}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}

                {/* A frase confirma o que foi escolhido: o nome da cadência sozinho
                    ainda deixa dúvida para quem não usa o termo todo dia. */}
                <p className="text-xs font-medium">
                  A equipe vai ao local{" "}
                  {descricaoDaCadencia(
                    cadencia,
                    Number(frequenciaAmount),
                    frequenciaUnit as PmocFrequencyUnit,
                  )}
                  .
                </p>
              </fieldset>
            </>
          )}

          {etapa === 3 && (
            <div className="space-y-2">
              <Label htmlFor="pmoc-tecnico">
                {PROFESSIONAL_ROLES.FIELD_TECHNICIAN.label}
              </Label>
              {/*
                Seletor, e não campo livre.

                O campo pedia o **id** do técnico e ninguém o tem de cabeça:
                era um `Input` de texto onde se esperava um UUID. Quem
                preenchesse errado só descobriria na recusa do servidor.
              */}
              <Select
                value={tecnicoId || SEM_TECNICO}
                onValueChange={(valor) =>
                  setTecnicoId(valor === SEM_TECNICO ? "" : valor)
                }
              >
                <SelectTrigger id="pmoc-tecnico">
                  <SelectValue placeholder="Definir depois" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_TECNICO}>Definir depois</SelectItem>
                  {(tecnicos.data ?? []).map((pessoa) => (
                    <SelectItem key={pessoa.id} value={pessoa.id}>
                      {pessoa.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* A descrição vem do registry: é a mesma em toda tela que nomeia o
                  papel, e dois textos para o mesmo conceito divergem na primeira
                  mudança. */}
              <p className="text-xs text-muted-foreground">
                {PROFESSIONAL_ROLES.FIELD_TECHNICIAN.description}
              </p>
            </div>
          )}

          {etapa === 3 && (
            <div className="space-y-2">
              <Label htmlFor="pmoc-rt">
                {PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.label}
              </Label>
              {/*
                Outro papel, outro seletor.

                O de cima é quem vai ao local. Este é quem responde tecnicamente
                pelo contrato, costuma ter a credencial de conselho esperada pelo
                PMOC e é, na maioria das organizações, o próprio dono — que por isso
                vem pré-selecionado.

                A coluna existia no plano desde sempre e o wizard não a oferecia:
                dizia "definido no detalhe do plano", e quem criava um PMOC saía com
                um plano que não iniciava execução nenhuma, sem saber por quê.
              */}
              <Select
                value={rtId || SEM_TECNICO}
                onValueChange={(valor) =>
                  setRtEscolhido(valor === SEM_TECNICO ? "" : valor)
                }
              >
                <SelectTrigger id="pmoc-rt">
                  <SelectValue placeholder="Definir depois" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SEM_TECNICO}>Definir depois</SelectItem>
                  {candidatosRT.map((pessoa) => (
                    <SelectItem key={pessoa.id} value={pessoa.id}>
                      {/* O estado da assinatura ao lado do nome: é ela que sai no
                          documento, e sem ela a execução não abre. Descobrir isso
                          aqui é melhor que no dia do atendimento. */}
                      {pessoa.signatureAvailable
                        ? pessoa.name
                        : `${pessoa.name} — sem assinatura`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <p className="text-xs text-muted-foreground">
                {PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.description}
              </p>

              {avisoRT ? (
                <p
                  className={
                    avisoRT.bloqueia
                      ? "text-xs text-warning"
                      : "text-xs text-muted-foreground"
                  }
                >
                  {avisoRT.texto}
                </p>
              ) : null}
            </div>
          )}

          {etapa === 4 && (
            <PmocUnitsField selecionadas={unidades} onChange={setUnidades} />
          )}

          {etapa === 5 && (
            <RevisaoDoPlano
              carregando={preview.isPending}
              projecao={projecao}
              clienteNome={cliente?.tradeName ?? cliente?.legalName ?? ""}
              codigo={codigoEditado ? code.trim() : codigoExibido}
              codigoEditado={codigoEditado}
              planoNome={name.trim() || "Plano sem nome"}
              tecnicoNome={
                (tecnicos.data ?? []).find((pessoa) => pessoa.id === tecnicoId)
                  ?.name ?? null
              }
              unidadesMarcadas={unidades.length}
              responsavelTecnicoNome={
                candidatosRT.find((pessoa) => pessoa.id === rtId)?.name ?? null
              }
              assinaturaDoRT={
                candidatosRT.find((pessoa) => pessoa.id === rtId)
                  ?.signatureAvailable ?? null
              }
            />
          )}
        </div>

        {/* Junto do rodapé e sem encolher: o erro de criação é o que explica por
            que o botão não terminou o trabalho, e precisa estar visível com ele. */}
        <div className="shrink-0">
          <MutationError
            error={create.error ?? activation.error ?? preview.error}
          />
        </div>

        <DialogFooter className="shrink-0 gap-2 sm:justify-between">
          {/*
            Criado o plano, não há mais para onde voltar.

            Enquanto a ativação falha o plano **já existe**, e deixar "Voltar" ali
            convidaria a editar a configuração sem que a edição fosse a lugar
            nenhum — o que o botão aplicaria era criar outro plano. Então sobra
            fechar, e o plano fica na listagem com a ação "Ativar".
          */}
          <Button
            variant="ghost"
            onClick={() =>
              criadoSemAtivar || etapa === 0
                ? fechar()
                : setEtapa((atual) => atual - 1)
            }
          >
            {criadoSemAtivar ? "Fechar" : etapa === 0 ? "Cancelar" : "Voltar"}
          </Button>

          {etapa < ETAPAS.length - 1 ? (
            <Button disabled={!podeAvancar} onClick={avancar}>
              Continuar
            </Button>
          ) : (
            <Button
              disabled={
                (!projecao && !criadoSemAtivar) ||
                create.isPending ||
                activation.isPending
              }
              onClick={() =>
                criadoSemAtivar ? ativar(criadoSemAtivar) : criar()
              }
            >
              {create.isPending
                ? "Criando…"
                : activation.isPending
                  ? "Ativando…"
                  : criadoSemAtivar
                    ? "Ativar de novo"
                    : "Criar PMOC"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * A revisão: o que vai ser criado, em frases que se conferem.
 *
 * ## O que mudou, e por quê
 *
 * Era uma lista de sete `rótulo: valor` e, embaixo, os equipamentos com os números
 * das execuções colados por ponto — `1 · 2 · 3 · 4`. Três problemas de conteúdo,
 * nenhum de enfeite: "Execuções: 4" e "Execuções previstas: 48" não se distinguiam
 * pelo nome; as **datas** vinham no contrato (`dueOn`) e eram descartadas, de modo
 * que a pergunta que traz a pessoa até aqui — "quando a equipe vai?" — era a única
 * sem resposta; e `48` aparecia sem o `4 × 12` que o explica.
 *
 * Os fatos e as frases vêm de `pmoc-review`, onde são testados. Aqui é só arranjo:
 * identificação em cima, programação no meio, avisos antes do botão.
 *
 * Em telas estreitas nada vira tabela horizontal: rolagem lateral dentro de um
 * diálogo é a pior forma de esconder informação.
 */
function RevisaoDoPlano({
  carregando,
  projecao,
  clienteNome,
  codigo,
  codigoEditado,
  planoNome,
  tecnicoNome,
  unidadesMarcadas,
  responsavelTecnicoNome,
  assinaturaDoRT,
}: {
  carregando: boolean;
  projecao: PmocPreview | null;
  clienteNome: string;
  codigo: string;
  codigoEditado: boolean;
  planoNome: string;
  tecnicoNome: string | null;
  unidadesMarcadas: number;
  responsavelTecnicoNome: string | null;
  /** `null` quando não há Responsável Técnico escolhido. */
  assinaturaDoRT: boolean | null;
}) {
  if (carregando) {
    return (
      <p className="text-sm text-muted-foreground">Calculando a programação…</p>
    );
  }
  if (!projecao) {
    return (
      <p className="text-sm text-muted-foreground">
        Volte uma etapa e confirme a programação para ver a projeção.
      </p>
    );
  }

  const fatos = fatosDaProgramacao(projecao);
  const visitas = primeirasVisitas(projecao);
  const avisos = avisosDaRevisao(projecao, unidadesMarcadas);

  return (
    /*
      Duas colunas a partir de `lg`, e uma empilhada abaixo disso.

      A revisão inteira numa coluna só ficava mais alta que a tela e empurrava os
      botões para fora. O conteúdo são blocos independentes — programação, datas,
      responsáveis —, e blocos independentes é exatamente o que cabe em colunas: o
      diálogo cresce na horizontal, que é a direção que sobra.

      `items-start` porque as colunas têm alturas diferentes e nenhuma precisa
      esticar até a altura da outra; `lg:col-span-2` nos blocos que são cabeçalho ou
      aviso, porque eles falam do conjunto e não de uma coluna.
    */
    <div className="grid items-start gap-5 lg:grid-cols-2">
      {/*
        Identificação primeiro: é o cabeçalho do que está sendo criado, e responde
        "é este cliente mesmo?" antes de qualquer número.
      */}
      <header className="space-y-1 rounded-lg border bg-surface-strong/40 p-4 lg:col-span-2">
        <p className="text-sm text-muted-foreground">{clienteNome}</p>
        <h3 className="font-display text-lg font-semibold">{planoNome}</h3>
        <p className="font-mono text-xs text-muted-foreground">
          {codigoEditado ? codigo : `${codigo} · gerado ao salvar`}
        </p>
      </header>

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Programação</h4>
        <dl className="divide-y rounded-lg border">
          {fatos.map((fato) => (
            <div
              key={fato.rotulo}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 p-3"
            >
              <dt className="text-sm text-muted-foreground">{fato.rotulo}</dt>
              <dd className="text-right">
                <span className="text-sm font-medium tabular-nums">
                  {fato.valor}
                </span>
                {/* A nota é o que separa revisar de aceitar: ela diz de onde o
                    número vem, ou o que ele significa. */}
                {fato.nota ? (
                  <span className="block text-xs text-muted-foreground">
                    {fato.nota}
                  </span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {visitas.datas.length > 0 ? (
        <section className="space-y-2">
          <h4 className="text-sm font-semibold">Quando a equipe vai</h4>
          <ul className="flex flex-wrap gap-1.5">
            {visitas.datas.map((data, indice) => (
              <li
                key={data}
                className="rounded-md border px-2 py-1 text-xs tabular-nums"
              >
                <span className="text-muted-foreground">{indice + 1}ª</span>{" "}
                {data}
              </li>
            ))}
          </ul>
          {visitas.restantes > 0 ? (
            <p className="text-xs text-muted-foreground">
              {`+ ${visitas.restantes} depois dessas, dentro da vigência.`}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2">
        <h4 className="text-sm font-semibold">Responsáveis e unidades</h4>
        <dl className="divide-y rounded-lg border">
          <div className="flex items-baseline justify-between gap-4 p-3">
            <dt className="text-sm text-muted-foreground">
              {PROFESSIONAL_ROLES.FIELD_TECHNICIAN.label}
            </dt>
            <dd className="text-sm font-medium">
              {tecnicoNome ?? "A definir"}
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-3">
            <dt className="text-sm text-muted-foreground">
              Unidades atendidas
            </dt>
            <dd className="text-right">
              <span className="text-sm font-medium tabular-nums">
                {unidadesMarcadas}
              </span>
              <span className="block text-xs text-muted-foreground">
                O relatório descreve o serviço por unidade.
              </span>
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 p-3">
            <dt className="text-sm text-muted-foreground">
              {PROFESSIONAL_ROLES.TECHNICAL_RESPONSIBLE.label}
            </dt>
            <dd className="text-right">
              <span className="text-sm font-medium">
                {responsavelTecnicoNome ?? "A definir"}
              </span>
              {/* O estado da assinatura, porque é ela que sai no documento — e é a
                  última chance de ver isso antes de criar o plano. */}
              <span className="block text-xs text-muted-foreground">
                {assinaturaDoRT === null
                  ? "Sem Responsável Técnico, a execução não abre."
                  : assinaturaDoRT
                    ? "Assinatura cadastrada"
                    : "Sem assinatura — a execução não abre"}
              </span>
            </dd>
          </div>
        </dl>
      </section>

      {/*
        Os avisos ficam **antes** do botão, e não no fim da página.
        "Plano sem equipamento" é o defeito que encheu o banco de setenta e cinco
        planos que não mandam ninguém a lugar nenhum; avisar depois do clique não
        serve de nada.
      */}
      {avisos.length > 0 ? (
        <ul className="space-y-1.5 rounded-lg border border-warning/40 bg-warning/5 p-3 lg:col-span-2">
          {avisos.map((aviso) => (
            <li key={aviso} className="text-xs text-warning">
              {aviso}
            </li>
          ))}
        </ul>
      ) : null}

      <details className="rounded-lg border lg:col-span-2">
        <summary className="cursor-pointer p-3 text-sm font-medium">
          {`Atendimentos por equipamento (${projecao.matrix.length})`}
        </summary>
        {/* Recolhido por padrão: com doze equipamentos e quatro visitas são
            quarenta e oito linhas, e elas não são a pergunta da revisão — são a
            conferência de quem desconfia do total. */}
        <ul className="space-y-2 border-t p-3">
          {projecao.matrix.map((linha) => (
            <li key={linha.equipment.id} className="rounded-md border p-3">
              <p className="truncate text-sm font-medium">
                {linha.equipment.name}
              </p>
              <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                {linha.executions
                  .map((execucao) => dataCivil(execucao.dueOn))
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
