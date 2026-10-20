"use client";

/**
 * Criação e edição de categoria.
 *
 * Escreve em `POST /catalog/categories` e `PATCH /catalog/categories/:id`. O
 * DTO aceita três campos: nome, descrição e categoria pai.
 *
 * ## O que não é decidido aqui
 *
 * - **`slug`.** É derivado do nome pelo servidor e publicado no Read Model. A
 *   tela o exibe, nunca o gera — duas implementações de slug divergiriam no
 *   primeiro acento.
 * - **Ciclos na hierarquia.** Escolher a si mesma como pai é impedido no
 *   seletor porque é obviamente errado; cadeias mais longas (A → B → A) são
 *   decisão do servidor, que tem a árvore inteira.
 * - **Dependências.** Excluir uma categoria com filhas ou itens é recusado com
 *   409 pelo backend (`categoryDependencies`). A tela não pré-verifica.
 */
import { useState } from "react";

import { MutationError } from "@/components/artifact-studio/mutation-error";
import { Button } from "@/components/ui/button";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useCreateCatalogCategory,
  useUpdateCatalogCategory,
} from "@/hooks/catalog/use-catalog";
import {
  CATALOG_LIMITS,
  type CatalogCategory,
  type CreateCatalogCategoryInput,
} from "@/types/catalog";

const ROOT = "__root__";

export function CatalogCategoryFormDialog({
  open,
  onOpenChange,
  editing = null,
  parent = null,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editing?: CatalogCategory | null;
  /** Pré-seleciona o pai quando a criação parte de "Nova subcategoria". */
  parent?: CatalogCategory | null;
  categories: readonly CatalogCategory[];
}) {
  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <Body
          key={editing?.id ?? `new:${parent?.id ?? "root"}`}
          editing={editing}
          parent={parent}
          categories={categories}
          onOpenChange={onOpenChange}
        />
      </DialogContent>
    </Dialog>
  );
}

function Body({
  editing,
  parent,
  categories,
  onOpenChange,
}: {
  editing: CatalogCategory | null;
  parent: CatalogCategory | null;
  categories: readonly CatalogCategory[];
  onOpenChange: (open: boolean) => void;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [parentId, setParentId] = useState(
    editing?.parentId ?? parent?.id ?? "",
  );

  const create = useCreateCatalogCategory();
  const update = useUpdateCatalogCategory(editing?.id ?? "");
  const mutation = editing ? update : create;

  const payload = (): CreateCatalogCategoryInput => ({
    name: name.trim(),
    description: description.trim() || undefined,
    parentId: parentId || undefined,
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    mutation.mutate(payload(), { onSuccess: () => onOpenChange(false) });
  };

  /** Uma categoria não pode ser pai de si mesma. */
  const available = categories.filter(
    (category) => category.id !== editing?.id,
  );

  const incomplete =
    name.trim().length < CATALOG_LIMITS.categoryNameMinLength;

  return (
    <form onSubmit={submit} className="space-y-5">
      <DialogHeader>
        <DialogTitle>
          {editing ? "Editar categoria" : "Nova categoria"}
        </DialogTitle>
        <DialogDescription>
          Categorias são compartilhadas por produtos, serviços e peças.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="category-name">Nome</Label>
          <Input
            id="category-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={CATALOG_LIMITS.categoryNameMaxLength}
            placeholder="Ex.: Climatização"
            required
          />
          {editing ? (
            <p className="text-xs text-muted-foreground">
              O identificador (<span className="font-mono">{editing.slug}</span>
              ) é gerado a partir do nome.
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor="category-parent">Categoria pai</Label>
          <Select
            value={parentId || ROOT}
            onValueChange={(value) => setParentId(value === ROOT ? "" : value)}
          >
            <SelectTrigger id="category-parent">
              <SelectValue placeholder="Nenhuma (raiz)" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROOT}>Nenhuma (raiz)</SelectItem>
              {available.map((category) => (
                <SelectItem key={category.id} value={category.id}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="category-description">Descrição</Label>
          <Textarea
            id="category-description"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
          />
        </div>
      </div>

      <MutationError error={mutation.error} />

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onOpenChange(false)}
        >
          Cancelar
        </Button>
        <Button type="submit" disabled={incomplete || mutation.isPending}>
          {mutation.isPending ? "Salvando…" : editing ? "Salvar" : "Criar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
