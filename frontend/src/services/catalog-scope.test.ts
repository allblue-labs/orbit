import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { catalogService } from "./catalog.service";

describe("carregamento do catálogo por escopo", () => {
  it.each(["PRODUCT", "SERVICE"] as const)(
    "%s aguarda a organização e busca novamente após inicializar a sessão",
    async (kind) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const query = { kind, page: 1, limit: 20, businessUnitId: "unit-1" };
      client.setQueryData(catalogService.keys.list(query), { data: [] });
      const load = vi
        .fn()
        .mockResolvedValue({ data: [{ id: "item-1", kind }] });
      const observer = new QueryObserver(client, {
        queryKey: catalogService.keys.scopedList(query, null),
        queryFn: load,
        enabled: false,
      });
      const unsubscribe = observer.subscribe(() => {});
      expect(load).not.toHaveBeenCalled();
      observer.setOptions({
        queryKey: catalogService.keys.scopedList(query, "org-1"),
        queryFn: load,
        enabled: true,
      });
      await observer.refetch();
      expect(observer.getCurrentResult().data).toEqual({
        data: [{ id: "item-1", kind }],
      });
      expect(load).toHaveBeenCalled();
      unsubscribe();
      client.clear();
    },
  );

  it("uma resposta atrasada de outro escopo não substitui os itens atuais", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let finishOld!: (value: string[]) => void;
    const old = new Promise<string[]>((resolve) => {
      finishOld = resolve;
    });
    const observer = new QueryObserver(client, {
      queryKey: catalogService.keys.scopedList(
        { kind: "PRODUCT", businessUnitId: "unit-a" },
        "org-a",
      ),
      queryFn: () => old,
    });
    const unsubscribe = observer.subscribe(() => {});
    observer.setOptions({
      queryKey: catalogService.keys.scopedList(
        { kind: "PRODUCT", businessUnitId: "unit-b" },
        "org-b",
      ),
      queryFn: async () => ["Produto B"],
    });
    await observer.refetch();
    finishOld(["Produto A"]);
    await old;
    expect(observer.getCurrentResult().data).toEqual(["Produto B"]);
    unsubscribe();
    client.clear();
  });

  it("invalidação por catálogo alcança produtos e serviços de todos os escopos", async () => {
    const client = new QueryClient();
    const keys = [
      catalogService.keys.scopedList(
        { kind: "PRODUCT", businessUnitId: "a" },
        "org-1",
      ),
      catalogService.keys.scopedList(
        { kind: "SERVICE", businessUnitId: "b" },
        "org-1",
      ),
      catalogService.keys.scopedList({ kind: "PRODUCT" }, "org-2"),
    ];
    keys.forEach((key) => client.setQueryData(key, { data: [] }));
    await client.invalidateQueries({
      queryKey: catalogService.keys.lists(),
      refetchType: "none",
    });
    keys.forEach((key) =>
      expect(client.getQueryState(key)?.isInvalidated).toBe(true),
    );
    client.clear();
  });
});
