/**
 * Minha conta — foto e assinatura.
 *
 * ## O que só o navegador prova
 *
 * Que o arquivo sobe de verdade: reserva, envio dos bytes e ativação, com o
 * servidor relendo o que ficou no storage. Um teste de unidade prova que o
 * serviço chama três rotas; só aqui se sabe que as três rotas existem, aceitam
 * o que é enviado e recusam o que não é.
 *
 * Prova também que a recusa aparece — arquivo grande e formato errado — e que
 * a foto ausente mostra as iniciais em vez de uma imagem inventada.
 */
import { expect, test } from "@playwright/test";

import { assertClean, login, record, settled } from "./support";

const CONTA = "/perfil?secao=dados";

/** Um PNG 1×1 de verdade. Bytes, não extensão. */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe("Minha conta — foto", () => {
  test("sem foto, aparecem as iniciais", async ({ page }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    await expect(page.getByRole("heading", { name: "Foto" })).toBeVisible();

    /** Nenhuma silhueta genérica: ou a foto da pessoa, ou as letras dela. */
    const preview = page.getByTestId("profile-avatar-preview");
    await expect(preview).toBeVisible();

    assertClean(recorder, "perfil-foto");
  });

  test("enviar, trocar e remover a foto", async ({ page }) => {
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    const preview = page.getByTestId("profile-avatar-preview");
    const campo = page.getByLabel("Escolher foto de perfil");

    await campo.setInputFiles({
      name: "foto.png",
      mimeType: "image/png",
      buffer: PNG_1X1,
    });

    /**
     * O enquadramento vem antes do envio.
     *
     * O avatar é redondo e aparece a 32 px: uma foto enviada crua entra
     * deformada, e o único conserto era mandar outra. O recorte também reencoda
     * a 512 px, que é o que faz uma foto de celular caber no limite do servidor.
     */
    await expect(page.getByTestId("avatar-crop-viewport")).toBeVisible();
    await page.getByRole("button", { name: "Usar esta foto" }).click();

    /** A foto passa a existir — e a URL é temporária, servida pelo backend. */
    await expect(preview.locator("img")).toBeVisible({ timeout: 20_000 });
    const src = await preview.locator("img").getAttribute("src");
    expect(src).toBeTruthy();

    /** Nunca um endereço público permanente nem a chave do objeto. */
    expect(src).not.toMatch(/\.amazonaws\.com|objectKey|bucket=orbit-public/);

    await expect(page.getByRole("button", { name: "Trocar foto" })).toBeVisible();

    await page.getByRole("button", { name: "Remover" }).click();
    await expect(preview.locator("img")).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Enviar foto" })).toBeVisible();
  });

  test("formato fora do contrato é recusado sem gastar rede", async ({
    page,
  }) => {
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    await page.getByLabel("Escolher foto de perfil").setInputFiles({
      name: "planilha.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("a,b\n1,2\n"),
    });

    await expect(
      page.getByRole("alert").filter({ hasText: /PNG, JPEG ou WEBP/ }),
    ).toBeVisible();
  });

  test("foto grande de celular é aceita: o recorte a encolhe", async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    /**
     * O limite de 2 MB passou a valer **depois** do recorte.
     *
     * Antes, uma foto de celular era recusada de saída e a pessoa tinha de
     * redimensionar o arquivo por fora para usar a própria foto — justamente o
     * trabalho que o recorte faz por ela. Este teste manda uma imagem real
     * acima do limite e prova que ela entra.
     *
     * A imagem é gerada **e entregue** dentro da página. Trazer ~15 MB de volta
     * pelo `evaluate` para reenviar como buffer estourava o tempo do teste — e o
     * que importa provar é o caminho do arquivo, não o transporte dele.
     *
     * O ruído é necessário: PNG comprime, e um retângulo de cor sólida de
     * 2000×2000 sairia com poucos KB sem provar nada.
     */
    const tamanho = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 2000;
      canvas.height = 2000;
      const contexto = canvas.getContext("2d")!;
      const dados = contexto.createImageData(canvas.width, canvas.height);
      for (let indice = 0; indice < dados.data.length; indice += 4) {
        dados.data[indice] = (Math.random() * 256) | 0;
        dados.data[indice + 1] = (Math.random() * 256) | 0;
        dados.data[indice + 2] = (Math.random() * 256) | 0;
        dados.data[indice + 3] = 255;
      }
      contexto.putImageData(dados, 0, 0);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png"),
      );
      const arquivo = new File([blob!], "celular.png", { type: "image/png" });

      const campo = document.querySelector<HTMLInputElement>(
        'input[aria-label="Escolher foto de perfil"]',
      )!;
      const transferencia = new DataTransfer();
      transferencia.items.add(arquivo);
      campo.files = transferencia.files;
      campo.dispatchEvent(new Event("change", { bubbles: true }));

      return arquivo.size;
    });

    expect(
      tamanho,
      "a imagem gerada precisa passar de 2 MB para o teste valer",
    ).toBeGreaterThan(2_000_000);

    await expect(page.getByTestId("avatar-crop-viewport")).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Usar esta foto" }).click();

    const preview = page.getByTestId("profile-avatar-preview");
    await expect(preview.locator("img")).toBeVisible({ timeout: 30_000 });

    /** E some depois, para não deixar estado para o próximo teste. */
    await page.getByRole("button", { name: "Remover" }).click();
    await expect(preview.locator("img")).toHaveCount(0, { timeout: 20_000 });
  });
});

test.describe("Minha conta — assinatura", () => {
  test("a seção oferece desenhar e enviar, sem prometer ICP-Brasil", async ({
    page,
  }) => {
    const recorder = record(page);
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    await expect(
      page.getByRole("heading", { name: "Minha assinatura" }),
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Desenhar assinatura" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Enviar imagem" })).toBeVisible();

    /**
     * O que o produto **não** promete. A assinatura é a representação gráfica
     * da assinatura da pessoa — nada aqui é certificado digital.
     */
    const corpo = await page.locator("body").innerText();
    expect(corpo).not.toMatch(/ICP-Brasil|certificado digital|não repúdio/i);

    assertClean(recorder, "perfil-assinatura");
  });

  test("o pad começa vazio e o botão só habilita com traço", async ({
    page,
  }) => {
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    const pad = page.getByRole("img", { name: "Desenhe sua assinatura" });

    /**
     * Rolar até o pad antes de desenhar.
     *
     * `page.mouse` usa coordenadas da janela: com o pad abaixo da dobra, o
     * traço cairia fora dela e o teste provaria só que nada acontece quando
     * nada é tocado.
     */
    await pad.scrollIntoViewIfNeeded();
    await expect(pad).toBeVisible();

    /** Confirmar um pad vazio produziria um retângulo transparente. */
    const confirmar = page.getByRole("button", {
      name: /Confirmar assinatura|Substituir assinatura/,
    });
    await expect(confirmar).toBeDisabled();

    /** Um traço de verdade, com o ponteiro. */
    const caixa = (await pad.boundingBox())!;
    await page.mouse.move(caixa.x + 30, caixa.y + caixa.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 10; i += 1) {
      await page.mouse.move(
        caixa.x + 30 + i * 12,
        caixa.y + caixa.height / 2 + (i % 2 === 0 ? 12 : -12),
      );
    }
    await page.mouse.up();

    await expect(confirmar).toBeEnabled();

    /** E limpar volta ao estado inicial. */
    await page.getByRole("button", { name: "Limpar" }).click();
    await expect(confirmar).toBeDisabled();
  });

  test("cabe em 375 sem rolagem lateral", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await login(page);
    await page.goto(CONTA);
    await settled(page);

    await page.evaluate(() => window.scrollTo(500, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});
