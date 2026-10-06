import { describe, expect, it } from "vitest";

import { formatearFechaLarga } from "@/lib/fechas";

import { loVeElPublico, puedeVerVistaPrevia, tiposParaElPublico } from "./publico";

function lote(numero: number, cupo: number, vendidas = 0, reservadas = 0) {
  return { id: `lote-${numero}`, numero, nombre: `Lote ${numero}`, precioCentavos: (4000 + numero * 2000) * 100, cupo, vendidas, reservadas };
}

describe("lo que ve el público de cada tipo de entrada", () => {
  it("solo el lote en venta, sin cantidades ni los lotes que siguen", () => {
    const tipos = tiposParaElPublico([{ id: "general", nombre: "General", lotes: [lote(1, 300, 120), lote(2, 200), lote(3, 150)] }]);
    expect(tipos).toEqual([
      { id: "general", nombre: "General", lote: { id: "lote-1", nombre: "Lote 1", precioCentavos: 600000 } },
    ]);
    const enviado = JSON.stringify(tipos);
    for (const oculto of ["cupo", "vendidas", "reservadas", "numero", "Lote 2", "Lote 3", "800000", "1000000", "300", "120"]) {
      expect(enviado, oculto).not.toContain(oculto);
    }
  });

  it("cuando se agota un lote aparece el siguiente (las reservas también ocupan lugar)", () => {
    // desordenados a propósito: manda el número, no el orden en que llegan
    const [tipo] = tiposParaElPublico([{ id: "g", nombre: "General", lotes: [lote(3, 150), lote(2, 200), lote(1, 300, 290, 10)] }]);
    expect(tipo.lote).toEqual({ id: "lote-2", nombre: "Lote 2", precioCentavos: 800000 });
    expect(JSON.stringify(tipo)).not.toContain("Lote 3");
  });

  it("si no queda ningún lote con lugar: agotado", () => {
    const tipos = tiposParaElPublico([
      { id: "vip", nombre: "VIP", lotes: [lote(1, 60, 60), lote(2, 10, 5, 5)] },
      { id: "vacio", nombre: "Sin lotes", lotes: [] },
    ]);
    expect(tipos).toEqual([{ id: "vip", nombre: "VIP", lote: null }]);
  });
});

describe("quién ve la página del evento", () => {
  const activa = { id: "p1", nombre: "La Productora", activa: true };
  const admin = { rol: "ADMIN" as const, productora: null, debeCambiarContrasena: false };
  const organizador = { rol: "ORGANIZADOR" as const, productora: { id: "p1", nombre: "La Productora" }, debeCambiarContrasena: false };

  it("el público: publicados y finalizados de productoras activas", () => {
    expect(loVeElPublico({ estado: "PUBLICADO", productora: activa })).toBe(true);
    expect(loVeElPublico({ estado: "FINALIZADO", productora: activa })).toBe(true);
    expect(loVeElPublico({ estado: "BORRADOR", productora: activa })).toBe(false);
    expect(loVeElPublico({ estado: "PUBLICADO", productora: { ...activa, activa: false } })).toBe(false);
  });

  it("la vista previa: el ADMIN, y el organizador solo de su productora", () => {
    const evento = { productora: activa };
    const deOtra = { productora: { ...activa, id: "p2" } };
    expect(puedeVerVistaPrevia(null, evento)).toBe(false);
    expect(puedeVerVistaPrevia(admin, deOtra)).toBe(true);
    expect(puedeVerVistaPrevia(organizador, evento)).toBe(true);
    expect(puedeVerVistaPrevia(organizador, deOtra)).toBe(false);
    expect(puedeVerVistaPrevia({ ...organizador, rol: "VALIDADOR" }, evento)).toBe(false);
    expect(puedeVerVistaPrevia({ ...organizador, debeCambiarContrasena: true }, evento)).toBe(false);
  });
});

describe("fecha para la página", () => {
  it("día y hora en Argentina, en palabras", () => {
    expect(formatearFechaLarga(new Date("2026-11-21T23:00:00-03:00"))).toBe("Sábado 21 de noviembre · 23:00 hs");
    // 01:30 del domingo en Argentina (en UTC ya son las 04:30)
    expect(formatearFechaLarga(new Date("2026-11-22T04:30:00Z"))).toBe("Domingo 22 de noviembre · 01:30 hs");
  });
});
