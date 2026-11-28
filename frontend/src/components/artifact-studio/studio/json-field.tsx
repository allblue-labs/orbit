"use client";

/**
 * Editor de um valor JSON livre.
 *
 * `configuration`, `validations`, `dependencies`, `conditionalExpression` e
 * `defaultValue` são JSON sem esquema: o backend valida que são objeto/array e
 * que o conjunto é serializável, nada além disso — "the engine does not
 * interpret it", nas palavras do próprio DTO.
 *
 * Um formulário com campos nomeados aqui inventaria uma estrutura que o
 * servidor não tem e que cada agente de execução interpreta à sua maneira.
 * Editar o JSON é o que corresponde ao contrato; o que o editor acrescenta é
 * avisar quando o texto deixou de ser JSON válido.
 *
 * O texto digitado é estado local, e não uma projeção do valor: reformatar a
 * cada tecla atrapalharia quem escreve. O texto só é reescrito quando o valor
 * chega de fora — troca do nó selecionado, descarte de edição — e essa
 * comparação acontece durante a renderização, não em efeito.
 */
import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Draft {
  /** Último valor conhecido, para detectar mudança vinda de fora. */
  source: unknown;
  text: string;
  invalid: boolean;
}

export function JsonField({
  id,
  label,
  description,
  value,
  disabled,
  rows = 4,
  onChange,
}: {
  id: string;
  label: string;
  description?: string;
  value: unknown;
  disabled?: boolean;
  rows?: number;
  onChange: (value: unknown) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    source: value,
    text: stringify(value),
    invalid: false,
  }));

  /**
   * Ajuste durante a renderização: o valor mudou por fora, então o texto
   * volta a refletir o que o documento guarda.
   */
  if (!Object.is(draft.source, value)) {
    setDraft({ source: value, text: stringify(value), invalid: false });
  }

  const handleChange = (next: string) => {
    const trimmed = next.trim();

    if (trimmed === "") {
      setDraft({ source: undefined, text: next, invalid: false });
      onChange(undefined);
      return;
    }

    try {
      const parsed: unknown = JSON.parse(trimmed);
      /** `source` recebe o mesmo valor emitido — o retorno não reformata. */
      setDraft({ source: parsed, text: next, invalid: false });
      onChange(parsed);
    } catch {
      /** Texto inválido fica na tela; o documento mantém o último válido. */
      setDraft((current) => ({ ...current, text: next, invalid: true }));
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={draft.text}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        onChange={(event) => handleChange(event.target.value)}
        className={cn(
          "font-mono text-xs",
          draft.invalid && "border-destructive",
        )}
      />
      <p
        className={cn(
          "text-xs",
          draft.invalid ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {draft.invalid
          ? "Conteúdo em formato inválido — o último valor válido continua guardado."
          : (description ??
            "Configuração avançada do campo.")}
      </p>
    </div>
  );
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return "";
  return JSON.stringify(value, null, 2);
}
