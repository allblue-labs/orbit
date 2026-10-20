import { redirect } from "next/navigation";

import { ROUTES } from "@/lib/routes";

/**
 * O editor de estrutura, sem porta de entrada.
 *
 * ## Por que redireciona em vez de abrir
 *
 * O Artifact Studio existe e funciona: 3.400 linhas de editor de estrutura, com
 * árvore, inspetor, versões e comparação. O que não existe é o caso de uso —
 * construir um modelo de PMOC campo por campo produz um documento pior que o
 * oficial, com o trabalho de um dia, e era o primeiro caminho que a tela de
 * Modelos oferecia.
 *
 * O código fica: é a única forma de inspecionar a estrutura de um template, e
 * volta quando houver caso real de personalização. Reescrevê-lo depois seria o
 * desperdício, e um arquivo no histórico do git não compila.
 *
 * O redirecionamento é do servidor para que um endereço guardado nos favoritos
 * não pisque a tela antes de sair dela.
 */
export default function ArtifactStudioPage() {
  redirect(ROUTES.artifacts);
}
