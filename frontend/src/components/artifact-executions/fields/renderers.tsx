"use client";

/**
 * Renderizadores de campo, por **família de tipo**.
 *
 * Nada aqui é específico de PMOC, Ordem de Serviço ou Relatório Técnico. O
 * Workspace não sabe que esses artefatos existem: ele recebe seções e campos
 * do Snapshot e pergunta ao registry quem sabe desenhar cada tipo.
 *
 * O valor de uma resposta é `unknown` no contrato — o backend guarda JSON e
 * não o interpreta. Cada renderizador decide **como apresentar e que forma
 * enviar**, o que é escolha de apresentação; nenhum deles decide se o valor é
 * válido, o que é do servidor.
 */
import { useState } from "react";
import { CircleCheck, Paperclip, PenLine } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FieldEditorProps, FieldViewProps } from "./registry";

/* -------------------------------------------------------------------------- */
/* Apoio                                                                       */
/* -------------------------------------------------------------------------- */

/** Sinaliza "sem resposta" sem inventar um valor no lugar. */
export function EmptyAnswer() {
  return <span className="text-sm text-muted-foreground">Sem resposta</span>;
}

function SaveRow({
  dirty,
  saving,
  disabled,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  disabled: boolean;
  onSave: () => void;
}) {
  if (!dirty) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={disabled || saving}
      onClick={onSave}
    >
      {saving ? "Salvando…" : "Salvar resposta"}
    </Button>
  );
}

/**
 * Opções de um campo de escolha.
 *
 * `configuration` é JSON livre: cada organização monta as opções à sua
 * maneira. O leitor aceita as formas usuais e, quando não reconhece nenhuma,
 * devolve vazio — e o renderizador cai para entrada livre em vez de mostrar
 * uma lista vazia que travaria o preenchimento.
 */
export function readOptions(
  configuration: Readonly<Record<string, unknown>>,
): readonly { value: string; label: string }[] {
  const raw =
    configuration.options ?? configuration.choices ?? configuration.values;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((option) => {
    if (typeof option === "string" || typeof option === "number") {
      return [{ value: String(option), label: String(option) }];
    }
    if (option && typeof option === "object") {
      const record = option as Record<string, unknown>;
      const value = record.value ?? record.id ?? record.key;
      const label = record.label ?? record.title ?? record.name ?? value;
      if (value === undefined || value === null) return [];
      return [{ value: String(value), label: String(label) }];
    }
    return [];
  });
}

const asText = (value: unknown): string =>
  value === undefined || value === null ? "" : String(value);

/* -------------------------------------------------------------------------- */
/* Texto                                                                       */
/* -------------------------------------------------------------------------- */

export function TextView({ response, field }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {asText(response.value)}
      {field.unit ? (
        <span className="ml-1 text-muted-foreground">{field.unit}</span>
      ) : null}
    </p>
  );
}

export function TextEditor({
  field,
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const [value, setValue] = useState(() => asText(response?.value));
  const dirty = value !== asText(response?.value);

  return (
    <div className="space-y-2">
      <Input
        value={value}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
      <SaveRow
        dirty={dirty}
        saving={saving}
        disabled={disabled}
        onSave={() => onSave(value)}
      />
    </div>
  );
}

export function LongTextEditor({
  field,
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const [value, setValue] = useState(() => asText(response?.value));
  const dirty = value !== asText(response?.value);

  return (
    <div className="space-y-2">
      <Textarea
        value={value}
        rows={4}
        disabled={disabled}
        placeholder={field.placeholder}
        onChange={(event) => setValue(event.target.value)}
      />
      <SaveRow
        dirty={dirty}
        saving={saving}
        disabled={disabled}
        onSave={() => onSave(value)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Número                                                                      */
/* -------------------------------------------------------------------------- */

export function NumberView({ field, response }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  const unit = response.unit ?? field.unit;
  return (
    <p className="text-sm font-medium tabular-nums">
      {asText(response.value)}
      {unit ? (
        <span className="ml-1 font-normal text-muted-foreground">{unit}</span>
      ) : null}
    </p>
  );
}

export function NumberEditor({
  field,
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const [value, setValue] = useState(() => asText(response?.value));
  const dirty = value !== asText(response?.value);
  const numeric = value.trim() === "" ? null : Number(value.replace(",", "."));
  const invalid = numeric !== null && Number.isNaN(numeric);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Input
          value={value}
          inputMode="decimal"
          disabled={disabled}
          placeholder={field.placeholder}
          className={cn("max-w-48", invalid && "border-destructive")}
          onChange={(event) => setValue(event.target.value)}
        />
        {field.unit ? (
          <span className="text-sm text-muted-foreground">{field.unit}</span>
        ) : null}
      </div>
      {invalid ? (
        <p className="text-xs text-destructive">Informe um número.</p>
      ) : null}
      <SaveRow
        dirty={dirty && !invalid}
        saving={saving}
        disabled={disabled}
        onSave={() => onSave(numeric)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Booleano                                                                    */
/* -------------------------------------------------------------------------- */

export function BooleanView({ response }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  const checked = response.value === true || response.value === "true";
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <CircleCheck
        className={cn(
          "size-4",
          checked ? "text-emerald-400" : "text-muted-foreground",
        )}
        aria-hidden
      />
      {checked ? "Sim" : "Não"}
    </span>
  );
}

export function BooleanEditor({
  field,
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const current = response?.value === true || response?.value === "true";
  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox
        checked={current}
        disabled={disabled || saving}
        onCheckedChange={(checked) => onSave(checked === true)}
      />
      {field.placeholder ?? "Confirmar"}
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/* Escolha                                                                     */
/* -------------------------------------------------------------------------- */

export function ChoiceView({ field, response }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  const options = readOptions(field.configuration);
  const label = options.find(
    (option) => option.value === asText(response.value),
  )?.label;
  return <p className="text-sm">{label ?? asText(response.value)}</p>;
}

export function ChoiceEditor(props: FieldEditorProps) {
  const { field, response, disabled, saving, onSave } = props;
  const options = readOptions(field.configuration);

  /** Sem opções declaradas, entrada livre é melhor que uma lista vazia. */
  if (options.length === 0) return <TextEditor {...props} />;

  return (
    <Select
      value={asText(response?.value)}
      disabled={disabled || saving}
      onValueChange={(value) => onSave(value)}
    >
      <SelectTrigger className="max-w-sm">
        <SelectValue placeholder={field.placeholder ?? "Selecione"} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function MultiChoiceView({ field, response }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  const values = Array.isArray(response.value)
    ? response.value.map(asText)
    : [asText(response.value)];
  const options = readOptions(field.configuration);

  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <Badge key={value} variant="secondary">
          {options.find((option) => option.value === value)?.label ?? value}
        </Badge>
      ))}
    </div>
  );
}

export function MultiChoiceEditor(props: FieldEditorProps) {
  const { field, response, disabled, saving, onSave } = props;
  const options = readOptions(field.configuration);
  const selected = new Set(
    Array.isArray(response?.value) ? response.value.map(asText) : [],
  );

  if (options.length === 0) return <TextEditor {...props} />;

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onSave([...next]);
  };

  return (
    <div className="flex flex-wrap gap-3">
      {options.map((option) => (
        <label key={option.value} className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={selected.has(option.value)}
            disabled={disabled || saving}
            onCheckedChange={() => toggle(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Data e hora                                                                 */
/* -------------------------------------------------------------------------- */

const HTML_INPUT_TYPE: Readonly<Record<string, string>> = {
  DATE: "date",
  TIME: "time",
  DATETIME: "datetime-local",
};

export function DateTimeEditor({
  field,
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const [value, setValue] = useState(() => asText(response?.value));
  const dirty = value !== asText(response?.value);

  return (
    <div className="space-y-2">
      <Input
        type={HTML_INPUT_TYPE[field.type] ?? "text"}
        value={value}
        disabled={disabled}
        className="max-w-64"
        onChange={(event) => setValue(event.target.value)}
      />
      <SaveRow
        dirty={dirty}
        saving={saving}
        disabled={disabled}
        onSave={() => onSave(value)}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Mídia e assinatura — sem endpoint de binário nesta PR                       */
/* -------------------------------------------------------------------------- */

/**
 * Campo de mídia.
 *
 * O contrato de anexos recebe `storageKey` — o binário chega ao
 * armazenamento por outro caminho, que o backend ainda não expõe para
 * execuções. O campo mostra os anexos já vinculados e diz o que falta, em vez
 * de oferecer um seletor de arquivo que não teria para onde enviar.
 */
export function MediaView({ response, attachments }: FieldViewProps) {
  const linked = attachments ?? [];
  if (linked.length === 0 && !response) return <EmptyAnswer />;

  return (
    <div className="space-y-2">
      {linked.map((attachment) => (
        <div
          key={attachment.id}
          className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
        >
          <Paperclip className="size-4 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{attachment.fileName}</span>
          <Badge variant="secondary" className="text-[10px]">
            {attachment.kind}
          </Badge>
        </div>
      ))}
      {response ? (
        <p className="font-mono text-xs text-muted-foreground">
          {asText(response.value)}
        </p>
      ) : null}
    </div>
  );
}

export function MediaEditor({
  attachments,
  response,
  field,
}: FieldEditorProps) {
  return (
    <div className="space-y-2">
      <MediaView field={field} response={response} attachments={attachments} />
      <p className="text-xs text-muted-foreground">
        O envio de arquivo ainda não está disponível nas execuções. Anexos podem ser registrados no painel
        de anexos, informando a chave de armazenamento.
      </p>
    </div>
  );
}

/** Campo de assinatura dentro da seção — o ato de assinar não é desta PR. */
export function SignatureFieldView() {
  return (
    <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <PenLine className="size-4" aria-hidden />
      Coletada no painel de assinaturas
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Estruturado — o que não tem forma conhecida                                 */
/* -------------------------------------------------------------------------- */

export function StructuredView({ response }: FieldViewProps) {
  if (!response) return <EmptyAnswer />;
  if (response.value === null || typeof response.value !== "object") {
    return <p className="text-sm break-words">{asText(response.value)}</p>;
  }
  return (
    <pre className="overflow-x-auto rounded-lg bg-surface-strong/60 p-2 font-mono text-xs">
      {JSON.stringify(response.value, null, 2)}
    </pre>
  );
}

export function StructuredEditor({
  response,
  disabled,
  saving,
  onSave,
}: FieldEditorProps) {
  const initial =
    response?.value === undefined
      ? ""
      : JSON.stringify(response.value, null, 2);
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);

  const save = () => {
    const trimmed = text.trim();
    if (trimmed === "") return onSave(null);
    try {
      onSave(JSON.parse(trimmed));
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        rows={4}
        spellCheck={false}
        disabled={disabled}
        className={cn("font-mono text-xs", invalid && "border-destructive")}
        onChange={(event) => setText(event.target.value)}
      />
      {invalid ? (
        <p className="text-xs text-destructive">JSON inválido.</p>
      ) : null}
      <SaveRow
        dirty={text !== initial}
        saving={saving}
        disabled={disabled}
        onSave={save}
      />
    </div>
  );
}
