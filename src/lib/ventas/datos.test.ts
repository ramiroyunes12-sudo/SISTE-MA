import { describe, expect, it } from "vitest";

import { errorDeDni, errorDeNombre, errorDeTelefono, formatearDni, validarDatosCompra } from "./datos";
import { pedidoATexto, pedidoDesdeTexto, validarPedido } from "./pedido";

const GENERAL = "00000000-0000-4000-8000-000000000001";
const VIP = "00000000-0000-4000-8000-000000000002";

function formulario(campos: Record<string, string>) {
  return (campo: string) => campos[campo];
}

const BIEN = {
  "nombre-0": "  juan   Pérez ",
  "dni-0": "40.123.456",
  "nombre-1": "María José O'Connor-Gómez",
  "dni-1": "7123456",
  email: " Juan.Perez@Gmail.com ",
  email2: "juan.perez@gmail.com",
  telefono: "+54 9 (379) 412-3456",
};

describe("datos del checkout", () => {
  it("nombre y DNI por entrada, email y celular: los deja prolijos", () => {
    expect(validarDatosCompra(formulario(BIEN), 2)).toEqual({
      ok: true,
      datos: {
        email: "juan.perez@gmail.com",
        telefono: "+5493794123456",
        entradas: [
          { nombre: "juan Pérez", dni: "40123456" },
          { nombre: "María José O'Connor-Gómez", dni: "7123456" },
        ],
      },
    });
  });

  it("un mismo DNI puede ir en varias entradas, y el celular es opcional", () => {
    const resultado = validarDatosCompra(formulario({ ...BIEN, "dni-1": "40123456", telefono: "" }), 2);
    expect(resultado).toMatchObject({ ok: true, datos: { telefono: null } });
  });

  it("marca cada campo con su error, entrada por entrada", () => {
    const resultado = validarDatosCompra(
      formulario({ "nombre-0": "Juan", "dni-0": "40.123", "nombre-1": "", "dni-1": "", email: "juan@", email2: "", telefono: "12" }),
      2,
    );
    expect(resultado).toEqual({
      ok: false,
      errores: {
        "nombre-0": "Poné nombre y apellido.",
        "dni-0": "El DNI son 7 u 8 números (con o sin puntos).",
        "nombre-1": "Poné nombre y apellido.",
        "dni-1": "Poné el DNI.",
        email: "Ese email no parece válido. Revisalo.",
        telefono: "Poné un celular válido, por ejemplo 379 412 3456.",
      },
    });
  });

  it("los dos emails tienen que coincidir", () => {
    expect(validarDatosCompra(formulario({ ...BIEN, email2: "juan.perez@gmail.con" }), 2)).toEqual({
      ok: false,
      errores: { email2: "Los dos emails no coinciden." },
    });
  });

  it("si faltan entradas (llegaron menos campos), las marca", () => {
    expect(validarDatosCompra(formulario(BIEN), 3)).toMatchObject({
      ok: false,
      errores: { "nombre-2": expect.any(String), "dni-2": expect.any(String) },
    });
  });

  it("nombres y DNI raros", () => {
    expect(errorDeNombre("Juan 23")).toBe("Solo letras, como figura en el DNI.");
    expect(errorDeNombre("<script> alert")).toBe("Solo letras, como figura en el DNI.");
    expect(errorDeNombre("Ñandú Güemes")).toBeUndefined();
    // Solo letras latinas, como en el DNI (las demás no se pueden imprimir en la entrada).
    expect(errorDeNombre("Иван Петров")).toBe("Solo letras, como figura en el DNI.");
    expect(errorDeNombre("Juan 李")).toBe("Solo letras, como figura en el DNI.");
    expect(errorDeNombre("Zoë Dvořák")).toBeUndefined();
    expect(errorDeNombre(`Juan ${"a".repeat(80)}`)).toBe("Es muy largo (hasta 80 letras).");
    for (const malo of ["0000000", "123456789", "40 123 45a", "-"]) expect(errorDeDni(malo), malo).toBeDefined();
    for (const bueno of ["40123456", "40.123.456", "5.123.456", "123456"]) expect(errorDeDni(bueno), bueno).toBeUndefined();
    expect(errorDeTelefono("379 4123456")).toBeUndefined();
    expect(errorDeTelefono("llamame")).toBeDefined();
  });

  it("muestra el DNI con puntos", () => {
    expect(formatearDni("40123456")).toBe("40.123.456");
    expect(formatearDni("7123456")).toBe("7.123.456");
  });
});

describe("el pedido en la dirección del checkout", () => {
  it("ida y vuelta", () => {
    const pedido = [
      { tipoId: GENERAL, cantidad: 2 },
      { tipoId: VIP, cantidad: 1 },
    ];
    const texto = pedidoATexto(pedido);
    expect(texto).toBe(`${GENERAL}:2,${VIP}:1`);
    expect(validarPedido(pedidoDesdeTexto(texto))).toEqual({ ok: true, pedido });
  });

  it("lo que no tiene forma de pedido se rechaza", () => {
    for (const malo of [undefined, "", "hola", `${GENERAL}`, `${GENERAL}:dos`, `${GENERAL}:1:2`, `${GENERAL}:-1`, `${GENERAL}:100`, "x".repeat(3000)]) {
      expect(validarPedido(pedidoDesdeTexto(malo)), String(malo).slice(0, 40)).toMatchObject({ ok: false });
    }
  });
});
