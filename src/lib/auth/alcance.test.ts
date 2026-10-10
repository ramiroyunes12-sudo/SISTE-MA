import { describe, expect, it } from "vitest";

import { puedeTocarProductora } from "./alcance";

const PROPIA = "0190f2a0-0000-7000-8000-000000000001";
const AJENA = "0190f2a0-0000-7000-8000-000000000002";

describe("qué productora puede tocar cada uno", () => {
  it("el ADMIN, cualquiera", () => {
    expect(puedeTocarProductora({ todo: true }, AJENA)).toBe(true);
  });

  it("un organizador, solo la suya", () => {
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, PROPIA)).toBe(true);
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, AJENA)).toBe(false);
  });

  it("nada que no sea un id", () => {
    expect(puedeTocarProductora({ todo: true }, "x")).toBe(false);
    expect(puedeTocarProductora({ todo: true }, undefined)).toBe(false);
    expect(puedeTocarProductora({ todo: false, productoraId: PROPIA }, null)).toBe(false);
  });
});
