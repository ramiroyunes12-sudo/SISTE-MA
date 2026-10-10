import { describe, expect, it } from "vitest";

import {
  bloqueaRepetir,
  leerContador,
  leerRespuestaBusqueda,
  leerRespuestaPuerta,
  puedeMarcarSinQr,
  respuestaBusqueda,
  respuestaPuerta,
} from "./puerta";

const ENTRADA = { titular: "Ana Pérez", dni: "30111222", tipo: "VIP", compra: 12 };
const AHORA = new Date("2026-11-22T01:10:00-03:00");

describe("lo que ve la puerta", () => {
  it("PASA: los datos de la persona, con el DNI con puntos", () => {
    expect(respuestaPuerta({ resultado: "pasa", entrada: ENTRADA }, "yo", AHORA)).toEqual({
      resultado: "pasa",
      persona: { titular: "Ana Pérez", dni: "30.111.222", tipo: "VIP", compra: 12 },
    });
  });

  it("YA INGRESÓ: a qué hora y quién (o 'vos' si fue quien escanea)", () => {
    const usadaEn = new Date("2026-11-21T23:41:00-03:00");
    const otro = respuestaPuerta(
      { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "otro", nombre: "Beto" }, metodo: "QR" },
      "yo",
      AHORA,
    );
    expect(otro).toMatchObject({ resultado: "ya_ingreso", entro: "a las 23:41", por: "Beto", porDni: false }); // hace 89 minutos
    const yo = respuestaPuerta(
      { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "yo", nombre: "Ana" }, metodo: "QR" },
      "yo",
      AHORA,
    );
    expect(yo).toMatchObject({ entro: "a las 23:41", por: "vos" });
  });

  it("YA INGRESÓ marcada sin el QR: dice que fue por DNI", () => {
    const usadaEn = new Date("2026-11-21T23:41:00-03:00");
    expect(
      respuestaPuerta(
        { resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: { id: "otro", nombre: "Beto" }, metodo: "DNI" },
        "yo",
        AHORA,
      ),
    ).toMatchObject({ por: "Beto", porDni: true });
  });

  it("YA INGRESÓ en la última hora: cuánto hace (para no confundir un QR repetido con el escaneo propio que se cortó)", () => {
    const ya = (segundos: number) =>
      respuestaPuerta(
        {
          resultado: "ya_ingreso",
          entrada: ENTRADA,
          usadaEn: new Date(AHORA.getTime() - segundos * 1000),
          validadaPor: null,
          metodo: null,
        },
        "yo",
        AHORA,
      );
    expect(ya(20)).toMatchObject({ entro: "a las 01:09, hace menos de un minuto" });
    expect(ya(90)).toMatchObject({ entro: "a las 01:08, hace 1 minuto" });
    expect(ya(59 * 60)).toMatchObject({ entro: "a las 00:11, hace 59 minutos" });
    expect(ya(60 * 60)).toMatchObject({ entro: "a las 00:10" });
    expect(ya(-30)).toMatchObject({ entro: "a las 01:10, hace menos de un minuto" }); // reloj de otro servidor adelantado
  });

  it("YA INGRESÓ hace más de 12 horas: con el día", () => {
    const usadaEn = new Date("2026-11-20T23:41:00-03:00");
    expect(
      respuestaPuerta({ resultado: "ya_ingreso", entrada: ENTRADA, usadaEn, validadaPor: null, metodo: null }, "yo", AHORA),
    ).toMatchObject({ entro: "el vie 20/11/2026 23:41", por: null });
  });

  it("NO VÁLIDA: el motivo, y la persona solo si se sabe de quién es", () => {
    expect(respuestaPuerta({ resultado: "no_valida", motivo: "firma" }, "yo", AHORA)).toEqual({
      resultado: "no_valida",
      motivo: "firma",
    });
    expect(respuestaPuerta({ resultado: "no_valida", motivo: "sin_pagar", entrada: ENTRADA }, "yo", AHORA)).toMatchObject({
      motivo: "sin_pagar",
      persona: { titular: "Ana Pérez" },
    });
  });
});

describe("lo que cree la pantalla de la puerta", () => {
  const PASA = { resultado: "pasa", persona: { titular: "Ana", dni: "30.111.222", tipo: "VIP", compra: 1 } };

  it("un resultado solo si el servidor contestó bien y con un resultado conocido", () => {
    expect(leerRespuestaPuerta(true, PASA)).toEqual(PASA);
    expect(leerRespuestaPuerta(true, { resultado: "no_valida", motivo: "firma" })).toEqual({ resultado: "no_valida", motivo: "firma" });
  });

  it("nunca PASA con un error, una respuesta rara o vacía: falló la conexión", () => {
    const conexion = { error: "conexion" };
    expect(leerRespuestaPuerta(false, PASA)).toEqual(conexion); // un 500 que dice "pasa" no se cree
    expect(leerRespuestaPuerta(true, { resultado: "PASA" })).toEqual(conexion);
    expect(leerRespuestaPuerta(true, { resultado: "pasa_igual" })).toEqual(conexion);
    expect(leerRespuestaPuerta(true, null)).toEqual(conexion);
    expect(leerRespuestaPuerta(true, "pasa")).toEqual(conexion);
    expect(leerRespuestaPuerta(true, { error: "sesion" })).toEqual(conexion);
    expect(leerRespuestaPuerta(false, { error: "otra_cosa" })).toEqual(conexion);
  });

  it("los errores conocidos del servidor, tal cual", () => {
    for (const error of ["sesion", "evento", "pedido", "conexion", "permiso"]) {
      expect(leerRespuestaPuerta(false, { error })).toEqual({ error });
    }
  });

  it("el QR de recién se bloquea solo si el servidor contestó (después de un error hay que poder escanearlo de nuevo)", () => {
    expect(bloqueaRepetir(PASA as never)).toBe(true);
    expect(bloqueaRepetir({ resultado: "ya_ingreso", persona: PASA.persona, entro: null, por: null, porDni: false })).toBe(true);
    expect(bloqueaRepetir({ resultado: "no_valida", motivo: "formato" })).toBe(true);
    expect(bloqueaRepetir({ error: "conexion" })).toBe(false);
    expect(bloqueaRepetir({ error: "pedido" })).toBe(false);
  });
});

describe("buscar sin el QR", () => {
  const ENCONTRADA = { id: "e1", titular: "Ana Pérez", dni: "30111222", tipo: "VIP", compra: 12 };

  it("marcar el ingreso sin el QR: solo el organizador y el ADMIN (decidido por Ramiro)", () => {
    expect(puedeMarcarSinQr("ADMIN")).toBe(true);
    expect(puedeMarcarSinQr("ORGANIZADOR")).toBe(true);
    expect(puedeMarcarSinQr("VALIDADOR")).toBe(false);
  });

  it("cada entrada con sus datos para la puerta y, si ya entró, cuándo y quién", () => {
    const usadaEn = new Date("2026-11-22T01:07:00-03:00");
    const respuesta = respuestaBusqueda(
      {
        resultado: "ok",
        hayMas: true,
        entradas: [
          { ...ENCONTRADA, ingreso: null },
          { ...ENCONTRADA, id: "e2", ingreso: { usadaEn, validadaPor: { id: "yo", nombre: "Ana" }, metodo: "DNI" } },
        ],
      },
      "yo",
      AHORA,
    );
    expect(respuesta).toEqual({
      hayMas: true,
      encontradas: [
        { id: "e1", persona: { titular: "Ana Pérez", dni: "30.111.222", tipo: "VIP", compra: 12 }, ingreso: null },
        {
          id: "e2",
          persona: { titular: "Ana Pérez", dni: "30.111.222", tipo: "VIP", compra: 12 },
          ingreso: { entro: "a las 01:07, hace 3 minutos", por: "vos", porDni: true },
        },
      ],
    });
  });

  it("lo que falta para buscar, tal cual", () => {
    expect(respuestaBusqueda({ resultado: "falta", motivo: "dni" }, "yo", AHORA)).toEqual({ falta: "dni" });
  });

  it("la pantalla cree una búsqueda solo si salió bien; si no, el error conocido o falló la conexión", () => {
    const ok = { hayMas: false, encontradas: [] };
    expect(leerRespuestaBusqueda(true, ok)).toEqual(ok);
    expect(leerRespuestaBusqueda(true, { falta: "corto" })).toEqual({ falta: "corto" });
    expect(leerRespuestaBusqueda(true, { falta: "otra" })).toEqual({ error: "conexion" });
    expect(leerRespuestaBusqueda(true, { encontradas: "x" })).toEqual({ error: "conexion" });
    expect(leerRespuestaBusqueda(false, ok)).toEqual({ error: "conexion" });
    expect(leerRespuestaBusqueda(false, { error: "sesion" })).toEqual({ error: "sesion" });
    expect(leerRespuestaBusqueda(true, null)).toEqual({ error: "conexion" });
  });

  it("el contador: solo números enteros que cierran; si no, null (la pantalla deja el último)", () => {
    expect(leerContador(true, { ingresaron: 3, total: 10 })).toEqual({ ingresaron: 3, total: 10 });
    expect(leerContador(false, { ingresaron: 3, total: 10 })).toBeNull();
    expect(leerContador(true, { ingresaron: "3", total: 10 })).toBeNull();
    expect(leerContador(true, { ingresaron: 11, total: 10 })).toBeNull();
    expect(leerContador(true, { ingresaron: -1, total: 10 })).toBeNull();
    expect(leerContador(true, null)).toBeNull();
  });
});
