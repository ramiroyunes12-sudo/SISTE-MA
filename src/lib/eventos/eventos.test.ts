import { describe, expect, it } from "vitest";

import { formatearPesos, parsearPesos, pesosParaEditar } from "@/lib/dinero";
import { aFechaLocal, deFechaLocal, formatearFecha } from "@/lib/fechas";

import { type EventoEditado, slugDesde, validarEvento } from "./editor";
import { estadosDeLotes } from "./lotes";

describe("fechas en hora argentina", () => {
  it("el campo de día y hora se interpreta en Argentina (UTC−3) y vuelve igual", () => {
    const fecha = deFechaLocal("2026-11-21T23:00");
    expect(fecha?.toISOString()).toBe("2026-11-22T02:00:00.000Z");
    expect(aFechaLocal(fecha!)).toBe("2026-11-21T23:00");
    expect(formatearFecha(fecha!)).toBe("sáb 21/11/2026 23:00");
  });

  it("no acepta fechas que no existen ni texto suelto", () => {
    for (const malo of ["", "mañana", "2026-02-30T22:00", "2026-11-21T25:00", "2026-11-21", "21/11/2026 23:00"]) {
      expect(deFechaLocal(malo), malo).toBeNull();
    }
  });
});

describe("plata", () => {
  it("entiende cómo se escriben los precios en Argentina", () => {
    const casos: [string, number | null][] = [
      ["6000", 600000],
      ["6.000", 600000],
      ["$ 6.000", 600000],
      ["$6.000,50", 600050],
      ["1.250.000", 125000000],
      ["8000,5", 800050],
      ["8000.50", 800050],
      ["", null],
      ["seis mil", null],
      ["-500", null],
      ["6.00.0", null],
      ["6,000.00", null],
    ];
    for (const [texto, centavos] of casos) expect(parsearPesos(texto), texto).toBe(centavos);
  });

  it("muestra los precios con puntos de miles", () => {
    expect(pesosParaEditar(600000)).toBe("6.000");
    expect(pesosParaEditar(125000050)).toBe("1.250.000,50");
    expect(formatearPesos(1500000)).toBe("$ 15.000");
    expect(parsearPesos(pesosParaEditar(123456789))).toBe(123456789);
  });
});

describe("estado de los lotes", () => {
  const lote = (id: string, numero: number, cupo: number, vendidas: number, reservadas = 0) => ({
    id,
    numero,
    cupo,
    vendidas,
    reservadas,
  });

  it("se vende de a un lote, en orden: el primero con lugar está en venta", () => {
    const estados = estadosDeLotes([lote("c", 3, 150, 0), lote("a", 1, 300, 300), lote("b", 2, 200, 140)]);
    expect(Object.fromEntries(estados)).toEqual({ a: "AGOTADO", b: "EN_VENTA", c: "EN_ESPERA" });
  });

  it("las reservas también ocupan lugar; si se liberan, el lote vuelve a la venta", () => {
    expect(estadosDeLotes([lote("a", 1, 10, 8, 2), lote("b", 2, 10, 0)]).get("a")).toBe("AGOTADO");
    expect(estadosDeLotes([lote("a", 1, 10, 8, 1), lote("b", 2, 10, 0)]).get("a")).toBe("EN_VENTA");
  });

  it("si no queda lugar en ninguno, todos agotados", () => {
    const estados = estadosDeLotes([lote("a", 1, 10, 10), lote("b", 2, 0, 0)]);
    expect([...estados.values()]).toEqual(["AGOTADO", "AGOTADO"]);
  });
});

describe("validar el evento", () => {
  const valido = (): EventoEditado => ({
    nombre: "Fiesta de Primavera",
    slug: "",
    fecha: "2026-11-21T23:00",
    lugar: "Club Regatas",
    direccion: "",
    descripcion: "",
    maxPorCompra: "6",
    cupoCortesias: "50",
    estado: "PUBLICADO",
    tipos: [
      {
        nombre: "General",
        lotes: [
          { nombre: "Lote 1", precio: "6.000", cupo: "300" },
          { nombre: "Lote 2", precio: "$ 8000", cupo: "200" },
        ],
      },
    ],
  });

  it("convierte todo: fecha, precios en centavos y la dirección de la página", () => {
    const resultado = validarEvento(valido());
    if (!resultado.ok) throw new Error(JSON.stringify(resultado.errores));
    expect(resultado.datos).toMatchObject({
      nombre: "Fiesta de Primavera",
      slug: "fiesta-de-primavera",
      slugAutomatico: true,
      direccion: null,
      maxPorCompra: 6,
      cupoCortesias: 50,
      tipos: [
        {
          nombre: "General",
          orden: 0,
          lotes: [
            { nombre: "Lote 1", precioCentavos: 600000, cupo: 300 },
            { nombre: "Lote 2", precioCentavos: 800000, cupo: 200 },
          ],
        },
      ],
    });
    expect(resultado.datos.fecha.toISOString()).toBe("2026-11-22T02:00:00.000Z");
  });

  it("arma la dirección sin tildes ni símbolos", () => {
    expect(slugDesde("¡Noche de Peñas en Corrientes 2026!")).toBe("noche-de-penas-en-corrientes-2026");
  });

  it("marca cada campo con su problema", () => {
    const malo = valido();
    malo.nombre = "x";
    malo.slug = "Con Espacios";
    malo.fecha = "";
    malo.maxPorCompra = "0";
    malo.cupoCortesias = "-1";
    malo.tipos[0].lotes[0].precio = "0";
    malo.tipos[0].lotes[1].cupo = "mucho";
    malo.tipos.push({ nombre: "general", lotes: [] }); // repetido (sin importar mayúsculas)
    const resultado = validarEvento(malo);
    expect(resultado.ok).toBe(false);
    if (resultado.ok) return;
    expect(Object.keys(resultado.errores).sort()).toEqual(
      [
        "nombre",
        "slug",
        "fecha",
        "maxPorCompra",
        "cupoCortesias",
        "tipos.0.lotes.0.precio",
        "tipos.0.lotes.1.cupo",
        "tipos.1.nombre",
      ].sort(),
    );
    expect(resultado.errores["tipos.0.lotes.0.precio"]).toMatch(/cortesías/);
  });

  it("no deja publicar un evento sin lotes (como borrador sí)", () => {
    const sinLotes = { ...valido(), tipos: [] };
    expect(validarEvento(sinLotes)).toMatchObject({ ok: false, errores: { estado: /al menos un tipo/ } });
    expect(validarEvento({ ...sinLotes, estado: "BORRADOR" })).toMatchObject({ ok: true });
  });

  it("no se deja engañar con datos armados a mano", () => {
    for (const raro of [null, "texto", 42, { ...valido(), estado: "CUALQUIERA" }, { ...valido(), tipos: "no" }]) {
      expect(validarEvento(raro).ok, JSON.stringify(raro)).toBe(false);
    }
    const conIdFalso = valido();
    conIdFalso.tipos[0].id = "'; drop table eventos; --";
    expect(validarEvento(conIdFalso)).toMatchObject({ ok: false, errores: { general: /no son válidos/ } });
  });
});
