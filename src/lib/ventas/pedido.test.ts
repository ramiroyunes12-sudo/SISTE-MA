import { describe, expect, it } from "vitest";

import { repartirEnLotes } from "@/lib/eventos/lotes";

import { planearCompra, type TipoConLotes, validarPedido } from "./pedido";

function lote(numero: number, cupo: number, ocupadas = { vendidas: 0, reservadas: 0 }) {
  return { id: `l${numero}`, numero, nombre: `Lote ${numero}`, precioCentavos: (4000 + numero * 2000) * 100, cupo, ...ocupadas };
}

const GENERAL = "00000000-0000-4000-8000-000000000001";
const VIP = "00000000-0000-4000-8000-000000000002";
const OTRO = "00000000-0000-4000-8000-000000000009";

describe("repartir un pedido entre los lotes", () => {
  it("si en el lote no entra todo, sigue en el próximo (piden 4, quedan 2 → 2 + 2)", () => {
    const lotes = [lote(1, 300, { vendidas: 298, reservadas: 0 }), lote(2, 200), lote(3, 150)];
    expect(repartirEnLotes(lotes, 4)).toEqual([
      { loteId: "l1", cantidad: 2, precioCentavos: 600000 },
      { loteId: "l2", cantidad: 2, precioCentavos: 800000 },
    ]);
  });

  it("entra todo en el lote en venta: no toca el siguiente", () => {
    expect(repartirEnLotes([lote(2, 200), lote(1, 300, { vendidas: 10, reservadas: 5 })], 6)).toEqual([
      { loteId: "l1", cantidad: 6, precioCentavos: 600000 },
    ]);
  });

  it("puede cruzar varios lotes y saltea los llenos (las reservas ocupan lugar)", () => {
    const lotes = [
      lote(1, 10, { vendidas: 9, reservadas: 0 }), // 1 libre (por ejemplo, una reserva que venció)
      lote(2, 5, { vendidas: 3, reservadas: 2 }), // lleno
      lote(3, 1),
      lote(4, 100),
    ];
    expect(repartirEnLotes(lotes, 5)).toEqual([
      { loteId: "l1", cantidad: 1, precioCentavos: 600000 },
      { loteId: "l3", cantidad: 1, precioCentavos: 1000000 },
      { loteId: "l4", cantidad: 3, precioCentavos: 1200000 },
    ]);
  });

  it("si no hay lugar para todas, no reparte nada", () => {
    expect(repartirEnLotes([lote(1, 2), lote(2, 1)], 4)).toBeNull();
    expect(repartirEnLotes([lote(1, 2), lote(2, 1)], 3)).toHaveLength(2);
    expect(repartirEnLotes([], 1)).toBeNull();
    expect(repartirEnLotes([lote(1, 0)], 1)).toBeNull();
  });

  it("cantidades raras: nada", () => {
    for (const cantidad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(repartirEnLotes([lote(1, 100)], cantidad), String(cantidad)).toBeNull();
    }
  });
});

describe("lo que llega del navegador", () => {
  it("acepta tipos con cantidades enteras e ignora los que van en 0", () => {
    expect(validarPedido([{ tipoId: GENERAL, cantidad: 2 }, { tipoId: VIP, cantidad: 0 }])).toEqual({
      ok: true,
      pedido: [{ tipoId: GENERAL, cantidad: 2 }],
    });
  });

  it("sin entradas elegidas avisa", () => {
    expect(validarPedido([])).toEqual({ ok: false, error: "Elegí al menos una entrada." });
    expect(validarPedido([{ tipoId: GENERAL, cantidad: 0 }])).toEqual({ ok: false, error: "Elegí al menos una entrada." });
  });

  it("rechaza todo lo que no tenga forma de pedido", () => {
    const malos: unknown[] = [
      null,
      "2 general",
      { tipoId: GENERAL, cantidad: 2 },
      [null],
      [{ tipoId: "general", cantidad: 1 }],
      [{ tipoId: GENERAL, cantidad: "2" }],
      [{ tipoId: GENERAL, cantidad: 1.5 }],
      [{ tipoId: GENERAL, cantidad: -1 }],
      [{ tipoId: GENERAL, cantidad: 21 }],
      [{ tipoId: GENERAL, cantidad: 1 }, { tipoId: GENERAL, cantidad: 1 }], // repetido
      Array.from({ length: 51 }, () => ({ tipoId: GENERAL, cantidad: 0 })),
    ];
    for (const malo of malos) expect(validarPedido(malo), JSON.stringify(malo)).toMatchObject({ ok: false });
  });
});

describe("planear la compra", () => {
  const tipos: TipoConLotes[] = [
    { id: GENERAL, nombre: "General", lotes: [lote(1, 300, { vendidas: 299, reservadas: 0 }), lote(2, 200)] },
    { id: VIP, nombre: "VIP", lotes: [lote(1, 60)] },
  ];

  it("detalle por tipo y lote, en el orden de la página, con el total", () => {
    const plan = planearCompra(tipos, [{ tipoId: VIP, cantidad: 1 }, { tipoId: GENERAL, cantidad: 3 }], 6);
    expect(plan).toEqual({
      ok: true,
      cantidad: 4,
      totalCentavos: 600000 + 2 * 800000 + 600000,
      lineas: [
        { tipoId: GENERAL, tipoNombre: "General", loteId: "l1", loteNombre: "Lote 1", cantidad: 1, precioCentavos: 600000 },
        { tipoId: GENERAL, tipoNombre: "General", loteId: "l2", loteNombre: "Lote 2", cantidad: 2, precioCentavos: 800000 },
        { tipoId: VIP, tipoNombre: "VIP", loteId: "l1", loteNombre: "Lote 1", cantidad: 1, precioCentavos: 600000 },
      ],
    });
  });

  it("respeta el máximo por compra (sumando todos los tipos)", () => {
    expect(planearCompra(tipos, [{ tipoId: GENERAL, cantidad: 4 }, { tipoId: VIP, cantidad: 3 }], 6)).toEqual({
      ok: false,
      error: "Se pueden comprar hasta 6 entradas por vez.",
    });
  });

  it("un tipo que no es de este evento: no se reserva nada", () => {
    expect(planearCompra(tipos, [{ tipoId: GENERAL, cantidad: 1 }, { tipoId: OTRO, cantidad: 1 }], 6)).toMatchObject({
      ok: false,
      error: expect.stringContaining("ya no está a la venta"),
    });
  });

  it("si no alcanza, avisa sin decir cuántas quedan", () => {
    const pocos: TipoConLotes[] = [{ id: VIP, nombre: "VIP", lotes: [lote(1, 3, { vendidas: 1, reservadas: 0 })] }];
    const plan = planearCompra(pocos, [{ tipoId: VIP, cantidad: 3 }], 6);
    expect(plan).toEqual({ ok: false, error: 'No quedan 3 entradas "VIP". Probá con menos.' });
    expect(JSON.stringify(plan)).not.toMatch(/\b2\b/);
    const agotado: TipoConLotes[] = [{ id: VIP, nombre: "VIP", lotes: [lote(1, 3, { vendidas: 2, reservadas: 1 })] }];
    expect(planearCompra(agotado, [{ tipoId: VIP, cantidad: 1 }], 6)).toEqual({ ok: false, error: '"VIP" está agotado.' });
  });
});
