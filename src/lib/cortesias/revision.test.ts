import { describe, expect, it } from "vitest";

import { leerPlanilla } from "./planilla";
import { claveDni, revisarFilas } from "./revision";

const GENERAL = { id: "t-general", nombre: "General" };
const VIP = { id: "t-vip", nombre: "VIP" };
const TIPOS = [GENERAL, VIP];

function revisar(texto: string, porDefecto: typeof GENERAL | null = GENERAL) {
  return revisarFilas(leerPlanilla(texto, ["General", "VIP"]).filas, TIPOS, porDefecto);
}

describe("revisar cada cortesía", () => {
  it("una fila bien: nombre ordenado, DNI solo números, email en minúsculas y el tipo", () => {
    expect(revisar("Nombre\tDNI\tEmail\tTipo\n  juana   pérez \t40.123.456\tJuana@Mail.COM\tvip")).toEqual([
      { fila: 2, nombre: "juana pérez", dni: "40123456", email: "juana@mail.com", tipoId: "t-vip", tipo: "VIP", errores: [] },
    ]);
  });

  it("sin email y sin tipo: el email queda vacío y el tipo es el elegido para las que no lo dicen", () => {
    expect(revisar("Ana Ruiz\t30111222")[0]).toMatchObject({ email: null, tipoId: "t-general", errores: [] });
  });

  it("cada problema de la fila, en castellano", () => {
    const [fila] = revisar("Nombre\tDNI\tEmail\tTipo\nAna\t123\tana@\tPlatea");
    expect(fila.errores).toEqual([
      "Poné nombre y apellido.",
      "El DNI son 7 u 8 números (con o sin puntos).",
      "Ese email no parece válido.",
      'No hay un tipo "Platea" en este evento (hay: General, VIP).',
    ]);
  });

  it("falta el nombre o el DNI", () => {
    const [sinDni, sinNombre] = revisar("Nombre\tDNI\nAna Ruiz\t\n\t30111222");
    expect(sinDni.errores).toEqual(["Falta el DNI."]);
    expect(sinNombre.errores).toEqual(["Falta el nombre y apellido."]);
  });

  it("un nombre que no se puede imprimir en la entrada (otras letras o emojis) no pasa", () => {
    expect(revisar("Ana 🎉 Ruiz\t30111222")[0].errores).toEqual(["Solo letras, como figura en el DNI."]);
  });

  it("un DNI repetido en la lista (también con un cero adelante) es error en la segunda vez", () => {
    const filas = revisar("Ana Ruiz\t4123456\nBeto Ruiz\t30111222\nAna R. Ruiz\t04.123.456");
    expect(filas.map((f) => f.errores)).toEqual([[], [], ["Este DNI ya está en la fila 1."]]);
  });

  it("sin tipo elegido y una fila que no lo dice: falta el tipo", () => {
    expect(revisar("Ana Ruiz\t30111222", null)[0].errores).toEqual(["Falta el tipo de entrada."]);
  });

  it("el DNI para comparar: sin puntos ni ceros adelante", () => {
    expect(claveDni("04.123.456")).toBe("4123456");
    expect(claveDni("40123456")).toBe("40123456");
  });
});
