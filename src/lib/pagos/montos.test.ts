import { describe, expect, it } from "vitest";

import { bpsAPorcentaje, porcentajeABps, recargoMercadoPago } from "./montos";

describe("cargo por servicio de Mercado Pago", () => {
  it("es un porcentaje del total, redondeado para arriba a pesos enteros", () => {
    expect(recargoMercadoPago(1_600_000, 440)).toBe(70_400); // $16.000 → $704
    expect(recargoMercadoPago(800_000, 440)).toBe(35_200); // $8.000 → $352
    expect(recargoMercadoPago(10_000, 440)).toBe(500); // $100 → $4,40 → $5
    expect(recargoMercadoPago(100, 440)).toBe(100); // $1 → unos centavos → $1
  });

  it("sin cargo o sin total, es 0", () => {
    expect(recargoMercadoPago(1_600_000, 0)).toBe(0);
    expect(recargoMercadoPago(0, 440)).toBe(0);
    expect(recargoMercadoPago(-5, 440)).toBe(0);
    expect(recargoMercadoPago(1.5, 440)).toBe(0);
  });

  it("cubre la comisión de 4,21% (a quien vende le queda el total)", () => {
    for (const total of [600_000, 800_000, 1_000_000, 1_234_500]) {
      const cobrado = total + recargoMercadoPago(total, 440);
      expect(Math.round(cobrado * (1 - 0.0421))).toBeGreaterThanOrEqual(total);
    }
  });
});

describe("porcentaje del panel", () => {
  it("acepta coma o punto, con o sin %", () => {
    expect(porcentajeABps("4,4")).toBe(440);
    expect(porcentajeABps("4.40")).toBe(440);
    expect(porcentajeABps(" 4,4 % ")).toBe(440);
    expect(porcentajeABps("0")).toBe(0);
    expect(porcentajeABps("20")).toBe(2000);
  });

  it("rechaza lo que no es un porcentaje de 0 a 20", () => {
    for (const malo of ["", "abc", "21", "-1", "4,444", "4,4,4", null, 4.4]) expect(porcentajeABps(malo)).toBeNull();
  });

  it("vuelve a texto", () => {
    expect(bpsAPorcentaje(440)).toBe("4,4");
    expect(bpsAPorcentaje(421)).toBe("4,21");
    expect(bpsAPorcentaje(0)).toBe("0");
  });
});
