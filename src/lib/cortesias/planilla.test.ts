import { describe, expect, it } from "vitest";

import { aTexto, celdasATexto, leerPlanilla } from "./planilla";

const TIPOS = ["General", "VIP"];

describe("leer la lista de cortesías", () => {
  it("pegada desde el Excel con títulos: cada columna por su título (las demás no se miran)", () => {
    const texto = "Nombre\tApellido\tDNI\tTeléfono\tE-mail\tTipo\r\nJuana\tPérez\t40.123.456\t3794123456\tJUANA@Mail.com\tvip\r\n";
    const { titulos, filas } = leerPlanilla(texto, TIPOS);
    expect(titulos).toEqual(["Nombre", "Apellido", "DNI", "Teléfono", "E-mail", "Tipo"]);
    expect(filas).toEqual([
      expect.objectContaining({ fila: 2, nombre: "Juana Pérez", dni: "40.123.456", email: "JUANA@Mail.com", tipo: "vip" }),
    ]);
  });

  it("sin títulos: cada celda se reconoce sola, en cualquier orden", () => {
    const { titulos, filas } = leerPlanilla("40123456\tGómez\tCarlos\tcarlos@mail.com\tVIP\nAna Ruiz\t30111222", TIPOS);
    expect(titulos).toBeNull();
    expect(filas).toEqual([
      expect.objectContaining({ fila: 1, nombre: "Gómez Carlos", dni: "40123456", email: "carlos@mail.com", tipo: "VIP" }),
      expect.objectContaining({ fila: 2, nombre: "Ana Ruiz", dni: "30111222", email: "", tipo: "" }),
    ]);
  });

  it("CSV del Excel en castellano (con ;) y con comillas: una coma o un salto de línea adentro no corta la celda", () => {
    const texto = 'nombre;dni;mail\n"Pérez, Juana";40123456;juana@mail.com\n"María\nJosé López";"30.111.222";\n';
    const { filas } = leerPlanilla(texto, TIPOS);
    expect(filas.map((f) => [f.fila, f.nombre, f.dni, f.email])).toEqual([
      [2, "Pérez, Juana", "40123456", "juana@mail.com"],
      [3, "María José López", "30.111.222", ""],
    ]);
  });

  it("CSV con comas y comillas dobles escapadas", () => {
    const { filas } = leerPlanilla('Nombre,DNI\n"Juan ""el Turco"" Pérez",40123456', TIPOS);
    expect(filas[0]).toMatchObject({ nombre: 'Juan "el Turco" Pérez', dni: "40123456" });
  });

  it("escrita a mano, una persona por renglón (el tipo solo si es la última palabra; el DNI con espacios también)", () => {
    const { filas } = leerPlanilla("Juana Pérez 40.123.456 juana@mail.com VIP\nCarlos General 38 999 111\n\n  Ana   Ruiz 30111222  ", TIPOS);
    expect(filas.map((f) => [f.fila, f.nombre, f.dni, f.email, f.tipo])).toEqual([
      [1, "Juana Pérez", "40.123.456", "juana@mail.com", "VIP"],
      [2, "Carlos General", "38.999.111", "", ""],
      [4, "Ana Ruiz", "30111222", "", ""],
    ]);
  });

  it("los renglones vacíos no son filas, pero los números siguen siendo los del Excel", () => {
    const { filas } = leerPlanilla("Nombre\tDNI\n\nJuana Pérez\t40123456\n\t\nAna Ruiz\t30111222\n", TIPOS);
    expect(filas.map((f) => f.fila)).toEqual([3, 5]);
  });

  it("una primera fila con un DNI no se toma como títulos", () => {
    const { titulos, filas } = leerPlanilla("Nombre Apellido\t40123456", TIPOS);
    expect(titulos).toBeNull();
    expect(filas).toHaveLength(1);
  });

  it("sacando el BOM del CSV de Excel", () => {
    const { titulos } = leerPlanilla("﻿Nombre;DNI\nJuana Pérez;40123456", TIPOS);
    expect(titulos).toEqual(["Nombre", "DNI"]);
  });

  it("vacía o solo con títulos: sin filas", () => {
    expect(leerPlanilla("  \n\t\n", TIPOS).filas).toEqual([]);
    expect(leerPlanilla("Nombre\tDNI\tEmail", TIPOS).filas).toEqual([]);
  });

  it("las filas pedidas vuelven a texto con los títulos (lo que queda para corregir)", () => {
    const planilla = leerPlanilla("Nombre;DNI\nJuana Pérez;40123456\nCarlos;1", TIPOS);
    expect(aTexto(planilla, [planilla.filas[1]])).toBe("Nombre\tDNI\nCarlos\t1");
    expect(aTexto(planilla, [])).toBe("");
  });

  it("las celdas de un archivo pasan a texto con tabulaciones (sin tabs ni saltos adentro)", () => {
    expect(celdasATexto([["Nombre", "DNI"], ["Juana\tPérez", "40123456"], [], ["Ana\nRuiz", "30111222"], [], []])).toBe(
      "Nombre\tDNI\nJuana Pérez\t40123456\n\nAna Ruiz\t30111222",
    );
  });
});
