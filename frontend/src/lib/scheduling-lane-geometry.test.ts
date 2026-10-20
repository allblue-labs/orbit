import { describe, expect, it } from "vitest";

import {
  MIN_BLOCK_WIDTH,
  laneGeometry,
} from "./scheduling-lane-geometry";

describe("laneGeometry", () => {
  it("dá a coluna inteira a uma ocorrência sozinha", () => {
    expect(laneGeometry(0, 1)).toEqual({
      left: "0%",
      width: `min(100%, max(100%, ${MIN_BLOCK_WIDTH}))`,
    });
  });

  it("reparte a coluna quando as ocorrências cabem lado a lado", () => {
    const { width } = laneGeometry(1, 4);
    expect(width).toContain("25%");
  });

  it("nunca desce abaixo da largura mínima do bloco", () => {
    /**
     * O caso que originou a correção: oito ocorrências simultâneas numa
     * coluna de 123px davam 14px a cada bloco, e o texto sumia sem aviso.
     */
    const { width } = laneGeometry(7, 8);
    expect(width).toBe(`min(100%, max(12.5%, ${MIN_BLOCK_WIDTH}))`);
  });

  it("mantém a escada dentro da coluna", () => {
    /** A última faixa começa onde a coluna acaba menos a própria largura. */
    const { left, width } = laneGeometry(7, 8);
    expect(left).toBe(`calc(7 * (100% - ${width}) / 7)`);
  });

  it("põe a primeira faixa de um grupo na margem", () => {
    expect(laneGeometry(0, 8).left).toContain("calc(0 *");
  });

  it("trata um total inválido como faixa única, sem dividir por zero", () => {
    expect(laneGeometry(0, 0)).toEqual({
      left: "0%",
      width: `min(100%, max(100%, ${MIN_BLOCK_WIDTH}))`,
    });
  });
});
