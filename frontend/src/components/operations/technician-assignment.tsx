"use client";
import {
  useFieldAssistants,
  useFieldTechnicians,
} from "@/hooks/workforce/use-workforce";
import { PROFESSIONAL_ROLES } from "@/registry";
import { Label } from "@/components/ui/label";
import { X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
const SEM_RESPONSAVEL = "__none__";
export function TechnicianAssignment({
  businessUnitId,
  persistedResponsibleId = "",
  responsibleId,
  auxiliaryIds,
  onChange,
}: {
  /** O responsável já gravado. Vazio na criação, onde não há o que desfazer. */
  persistedResponsibleId?: string;
  /// A unidade do atendimento, não a do contexto: é por ela que o servidor
  /// confere a atribuição, e é dela que as duas listas têm de sair.
  businessUnitId: string;
  responsibleId: string;
  auxiliaryIds: string[];
  onChange: (patch: {
    responsibleId?: string;
    auxiliaryIds?: string[];
  }) => void;
}) {
  /**
   * Duas listas, porque são duas perguntas.
   *
   * Executar pede designação profissional; acompanhar pede vínculo com acesso ao
   * aplicativo. Os dois campos liam a lista de técnicos, e o resultado era que
   * **ninguém com o papel "Auxiliar técnico" podia ser auxiliar** — ele não tem
   * perfil profissional, por não assinar nada, e por isso não aparecia.
   *
   * ## Por que a unidade entra na consulta
   *
   * `validateTechnicianAssignments` confere a elegibilidade **na unidade do
   * atendimento**. Sem o recorte aqui, o formulário oferecia o elenco da
   * organização inteira e o servidor recusava a escolha no envio — a pessoa
   * perdia o preenchimento por um erro que a tela ajudou a cometer.
   */
  const semUnidade = !businessUnitId;
  const scope = businessUnitId ? { businessUnitId } : undefined;
  const technicians = useFieldTechnicians(scope, Boolean(businessUnitId));
  const assistants = useFieldAssistants(scope, Boolean(businessUnitId));
  const pessoas = technicians.data ?? [];
  const acompanhantes = assistants.data ?? [];

  const nomeDe = (id: string) =>
    [...pessoas, ...acompanhantes].find((pessoa) => pessoa.id === id)?.name ??
    "Pessoa selecionada";

  const disponiveisComoAuxiliar = acompanhantes.filter(
    (pessoa) =>
      pessoa.id !== responsibleId && !auxiliaryIds.includes(pessoa.id),
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        {/*
          "Técnico Operacional", e não "Técnico responsável".

          O produto usava "Técnico responsável" aqui e "Responsável Técnico" no
          PMOC — as mesmas palavras em ordens diferentes, para coisas opostas: um
          executa no cliente, o outro responde pelo contrato e assina o documento
          com a credencial que a norma exige. O rótulo vem do registry, que é onde
          os dois papéis têm nome.
        */}
        <Label htmlFor="operation-responsible">
          {PROFESSIONAL_ROLES.FIELD_TECHNICIAN.label}
        </Label>
        <Select
          value={responsibleId || SEM_RESPONSAVEL}
          onValueChange={(value) =>
            onChange({
              responsibleId: value === SEM_RESPONSAVEL ? "" : value,
              /// Se a pessoa já era auxiliar, deixa de ser ao virar
              /// responsável: os dois papéis se excluem.
              auxiliaryIds: auxiliaryIds.filter((id) => id !== value),
            })
          }
        >
          <SelectTrigger id="operation-responsible">
            <SelectValue placeholder="Definir depois" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={SEM_RESPONSAVEL}>Definir depois</SelectItem>
            {pessoas
              .filter((pessoa) => !auxiliaryIds.includes(pessoa.id))
              .map((pessoa) => (
                <SelectItem key={pessoa.id} value={pessoa.id}>
                  {pessoa.name}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {/*
          A lista vazia se explica.

          Era isto que escondia o problema: o seletor abria sem ninguém dentro,
          idêntico a "ainda não escolhi", e nada na tela dizia que faltava
          habilitar o perfil profissional da pessoa. Quem cadastrou o técnico
          cinco minutos antes não tinha como adivinhar.
        */}
        {/*
          Tirar o responsável não é possível, e a tela diz isso.

          Os comandos de atribuição exigem um `userId`: a API não tem "desatribuir
          responsável", porque atendimento sem dono é o estado que a atribuição existe
          para evitar. Deixar o campo esvaziar em silêncio faria quem salvou acreditar
          que tirou — e o técnico continuaria recebendo no celular.
        */}
        {persistedResponsibleId && !responsibleId ? (
          <p className="text-xs text-warning">
            Este atendimento já tem responsável, e ele não pode ficar sem um.
            Para mudar, escolha outra pessoa; deixar em branco mantém quem está.
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {semUnidade
              ? "Escolha a unidade de negócio para ver quem atende nela."
              : technicians.isPending
                ? "Carregando quem atende nesta unidade…"
                : pessoas.length === 0
                  ? "Ninguém desta unidade tem o perfil de técnico de campo. Habilite em Equipe › o membro › Perfil profissional."
                  : "Executa o atendimento no aplicativo de campo."}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="operation-auxiliary">Auxiliares</Label>
        <Select
          value=""
          onValueChange={(value) =>
            onChange({ auxiliaryIds: [...auxiliaryIds, value] })
          }
          disabled={!responsibleId || disponiveisComoAuxiliar.length === 0}
        >
          <SelectTrigger id="operation-auxiliary">
            <SelectValue
              placeholder={
                responsibleId
                  ? "Adicionar auxiliar"
                  : "Escolha o técnico operacional"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {disponiveisComoAuxiliar.map((pessoa) => (
              <SelectItem key={pessoa.id} value={pessoa.id}>
                {pessoa.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {auxiliaryIds.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {auxiliaryIds.map((id) => (
              <li key={id}>
                <span className="inline-flex items-center gap-1 rounded-md bg-surface-strong px-2 py-0.5 text-xs">
                  {nomeDe(id)}
                  <button
                    type="button"
                    aria-label={`Remover ${nomeDe(id)}`}
                    onClick={() =>
                      onChange({
                        auxiliaryIds: auxiliaryIds.filter(
                          (item) => item !== id,
                        ),
                      })
                    }
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <p className="text-xs text-muted-foreground">
          {semUnidade
            ? "Escolha a unidade de negócio para ver quem pode acompanhar."
            : assistants.isPending
              ? "Carregando quem pode acompanhar…"
              : acompanhantes.length === 0
                ? "Ninguém desta unidade tem acesso ao aplicativo de campo."
                : "Acompanham: leem o atendimento e os documentos emitidos, sem executar."}
        </p>
      </div>
    </div>
  );
}
