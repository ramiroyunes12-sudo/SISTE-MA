import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { cifrar } from "@/lib/cifrado";

import { cuentaMpDe } from "./cuenta";

describe("la cuenta de Mercado Pago guardada", () => {
  const anterior = process.env.CLAVE_CIFRADO;
  beforeEach(() => {
    process.env.CLAVE_CIFRADO = "una-clave-de-prueba-bien-larga-de-mas-de-32";
  });
  afterEach(() => {
    process.env.CLAVE_CIFRADO = anterior;
    vi.restoreAllMocks();
  });

  const productora = (token: string | null) => ({ id: "p1", mpUsuarioId: token ? "123" : null, mpTokenCifrado: token });

  it("descifra el token", () => {
    expect(cuentaMpDe(productora(cifrar("APP_USR-secreto", "mp-token:p1")))).toEqual({
      productoraId: "p1",
      mpUsuarioId: "123",
      token: "APP_USR-secreto",
    });
  });

  it("sin cuenta: null", () => {
    expect(cuentaMpDe(productora(null))).toBeNull();
  });

  it("si cambió CLAVE_CIFRADO: null (hay que reconectar) y lo deja anotado sin el token, en vez de romper la página", () => {
    const guardado = cifrar("APP_USR-secreto", "mp-token:p1");
    process.env.CLAVE_CIFRADO = "otra-clave-nueva-tambien-de-mas-de-32-letras";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(cuentaMpDe(productora(guardado))).toBeNull();
    expect(error).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(error.mock.calls)).toContain("p1");
    expect(JSON.stringify(error.mock.calls)).not.toContain("APP_USR");
  });
});
