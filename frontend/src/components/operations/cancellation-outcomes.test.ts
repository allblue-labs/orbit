/**
 * Os desfechos que o dono pode escolher para um pedido de cancelamento.
 *
 * O que se protege aqui é a **exaustividade**. O mapa é uma tabela, e tabela não
 * erra sozinha; o que erra é o domínio ganhar um desfecho novo e ninguém o
 * acrescentar — e aí o botão simplesmente não existe, sem erro de tipo e sem
 * falha em lugar nenhum. O pedido ficaria esperando uma decisão que a tela não
 * oferece.
 */
import { describe, expect, it } from "vitest";

import { CANCELLATION_OUTCOMES } from "./cancellation-queue.panel";
import type { OperationCancellationDecision } from "@/types/operations";

/** Os desfechos do contrato, escritos à mão de propósito. */
const DO_CONTRATO: readonly OperationCancellationDecision[] = [
  "CANCELLED",
  "RESCHEDULED",
  "REASSIGNED",
  "DISMISSED",
];

describe("desfechos do pedido de cancelamento", () => {
  it("todo desfecho do contrato tem botão", () => {
    /*
     * A lista acima é literal e não derivada do mapa: derivá-la faria o teste
     * concordar consigo mesmo. Ela é a cópia do que o backend aceita em
     * `ocr_resolution_check`, e divergir das duas é o que este teste pega.
     */
    for (const desfecho of DO_CONTRATO) {
      expect(CANCELLATION_OUTCOMES[desfecho]).toBeDefined();
      expect(CANCELLATION_OUTCOMES[desfecho].label).not.toBe("");
    }
  });

  it("o mapa não oferece desfecho que o servidor recusaria", () => {
    expect(Object.keys(CANCELLATION_OUTCOMES).sort()).toEqual(
      [...DO_CONTRATO].sort(),
    );
  });

  it("só cancelar é destrutivo", () => {
    /* Remarcar e trocar o técnico mantêm o atendimento de pé; pintá-los de
       vermelho faria o dono hesitar na decisão mais comum. */
    const destrutivos = DO_CONTRATO.filter(
      (desfecho) => CANCELLATION_OUTCOMES[desfecho].destructive,
    );

    expect(destrutivos).toEqual(["CANCELLED"]);
  });

  it("manter como está não pede ação depois", () => {
    /* `followUp` é o que ainda falta fazer no atendimento. "Manter" não deixa
       nada pendente, e inventar um passo ali mandaria o dono procurar o que
       não existe. */
    expect(CANCELLATION_OUTCOMES.DISMISSED.followUp).toBeNull();
    expect(CANCELLATION_OUTCOMES.RESCHEDULED.followUp).not.toBeNull();
    expect(CANCELLATION_OUTCOMES.REASSIGNED.followUp).not.toBeNull();
  });
});
