import { describe, expect, it } from "vitest";

import { ErrorConfigDb, opcionesConexion } from "./db-config";

const CERT = "-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----";
const SUPABASE =
  "postgresql://postgres.abc:clave123@aws-0-sa-east-1.pooler.supabase.com:6543/postgres";

function motivoDe(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error instanceof ErrorConfigDb ? error.motivo : "otro_error";
  }
  return "sin_error";
}

describe("opcionesConexion", () => {
  it("falla si no hay DATABASE_URL", () => {
    expect(motivoDe(() => opcionesConexion({}))).toBe("falta_database_url");
    expect(motivoDe(() => opcionesConexion({ DATABASE_URL: "  " }))).toBe(
      "falta_database_url",
    );
  });

  it("falla si DATABASE_URL no es una dirección de PostgreSQL", () => {
    expect(motivoDe(() => opcionesConexion({ DATABASE_URL: "cualquier cosa" }))).toBe(
      "database_url_invalida",
    );
    expect(
      motivoDe(() => opcionesConexion({ DATABASE_URL: "https://supabase.com" })),
    ).toBe("database_url_invalida");
  });

  it("en una base local no usa SSL", () => {
    const opciones = opcionesConexion({
      DATABASE_URL: "postgresql://postgres:local@localhost:5432/entradas",
    });
    expect(opciones.ssl).toBe(false);
  });

  it("en una base remota exige el certificado", () => {
    expect(motivoDe(() => opcionesConexion({ DATABASE_URL: SUPABASE }))).toBe(
      "falta_certificado",
    );
  });

  it("en una base remota verifica el servidor con el certificado", () => {
    const opciones = opcionesConexion({ DATABASE_URL: SUPABASE, DATABASE_CA_CERT: CERT });
    expect(opciones.ssl).toEqual({ ca: CERT, rejectUnauthorized: true });
  });

  it("acepta el certificado escrito en una sola línea con \\n", () => {
    const enUnaLinea = CERT.replace(/\n/g, "\\n");
    const opciones = opcionesConexion({
      DATABASE_URL: SUPABASE,
      DATABASE_CA_CERT: enUnaLinea,
    });
    expect(opciones.ssl).toEqual({ ca: CERT, rejectUnauthorized: true });
  });

  it("saca de la URL los parámetros de SSL y deja los demás", () => {
    const opciones = opcionesConexion({
      DATABASE_URL: `${SUPABASE}?pgbouncer=true&sslmode=require&sslrootcert=x.crt`,
      DATABASE_CA_CERT: CERT,
    });
    const url = new URL(opciones.connectionString);
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.has("sslrootcert")).toBe(false);
    expect(url.searchParams.get("pgbouncer")).toBe("true");
    expect(url.username).toBe("postgres.abc");
    expect(url.password).toBe("clave123");
    expect(url.port).toBe("6543");
  });
});
