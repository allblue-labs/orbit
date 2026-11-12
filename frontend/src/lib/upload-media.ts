import { ApiError } from "@/lib/api-error";
import { browserUrlFor } from "@/lib/backend-url";

/** A signed upload carries only an object capability; never forward the session to R2. */
export async function uploadMedia(
  target: { url: string; requiredHeaders: Readonly<Record<string, string>> },
  blob: Blob,
  fileName = "imagem",
) {
  const headers = new Headers(target.requiredHeaders);
  const multipart = headers.get("x-orbit-upload-mode") === "multipart";
  let body: BodyInit = blob;
  if (multipart) {
    headers.delete("content-type");
    headers.delete("x-orbit-upload-mode");
    const form = new FormData();
    form.append("file", blob, fileName);
    body = form;
  }
  const response = await fetch(browserUrlFor(target.url), {
    method: "PUT",
    headers,
    body,
    credentials: browserUrlFor(target.url).startsWith("/")
      ? "same-origin"
      : "omit",
  });
  if (!response.ok)
    throw new ApiError({
      kind: "http",
      status: response.status,
      code: "UPLOAD_FAILED",
      message:
        "Não foi possível enviar a imagem. Verifique o arquivo e tente novamente.",
    });
}

/** Convert the existing cropper output into a real multipart file. */
export function brandImageForm(dataUrl: string): FormData {
  const match =
    /^data:(image\/(?:png|jpeg|webp|heic));base64,([A-Za-z0-9+/=]+)$/.exec(
      dataUrl,
    );
  if (!match) throw new Error("Imagem inválida.");
  const bytes = Uint8Array.from(atob(match[2]!), (character) =>
    character.charCodeAt(0),
  );
  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: match[1] }),
    `logo.${match[1]!.split("/")[1]}`,
  );
  return form;
}
