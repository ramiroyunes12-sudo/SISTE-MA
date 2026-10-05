import { describe, expect, it } from "vitest";

import { ErrorConfigDb, opcionesConexion, urlMigraciones } from "./db-config";
import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";

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

  it("si la base no contesta, corta en segundos (local y remota)", () => {
    for (const url of ["postgresql://postgres:local@localhost:5432/entradas", SUPABASE]) {
      const opciones = opcionesConexion({ DATABASE_URL: url });
      expect(opciones.connectionTimeoutMillis).toBe(5_000);
      expect(opciones.query_timeout).toBe(20_000);
    }
  });

  it("en Supabase usa su certificado sin necesidad de cargarlo", () => {
    for (const url of [SUPABASE, "postgresql://postgres:x@db.abc.supabase.co:5432/postgres"]) {
      const opciones = opcionesConexion({ DATABASE_URL: url });
      expect(opciones.ssl).toEqual({ ca: SUPABASE_ROOT_CA_2021, rejectUnauthorized: true });
    }
  });

  it("en otra base remota exige el certificado", () => {
    for (const url of [
      "postgresql://u:p@db.ejemplo.com:5432/postgres",
      // que "supabase.com" aparezca en el nombre no alcanza
      "postgresql://u:p@supabase.com.ejemplo.net:5432/postgres",
    ]) {
      expect(motivoDe(() => opcionesConexion({ DATABASE_URL: url }))).toBe(
        "falta_certificado",
      );
    }
  });

  it("DATABASE_CA_CERT reemplaza al certificado de Supabase", () => {
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

describe("urlMigraciones", () => {
  const SESION = "postgresql://entradas_app.abc:clave123@aws-0-sa-east-1.pooler.supabase.com:5432/postgres";
  const guardados: string[] = [];
  const guardar = (pem: string) => {
    guardados.push(pem);
    return "/tmp/ca.crt";
  };

  it("sin DIRECT_URL no devuelve nada (prisma generate no la necesita)", () => {
    expect(urlMigraciones({}, guardar)).toBeUndefined();
    // nunca usa DATABASE_URL (el pooler de transacciones no sirve para migrar)
    expect(urlMigraciones({ DATABASE_URL: SUPABASE }, guardar)).toBeUndefined();
  });

  it("siempre usa el esquema entradas", () => {
    const url = new URL(urlMigraciones({ DIRECT_URL: `${SESION}?schema=public` }, guardar)!);
    expect(url.searchParams.get("schema")).toBe("entradas");
  });

  it("en Supabase exige cifrado verificando su certificado", () => {
    guardados.length = 0;
    const url = new URL(urlMigraciones({ DIRECT_URL: `${SESION}?sslmode=disable` }, guardar)!);
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(url.searchParams.get("sslaccept")).toBe("strict");
    expect(url.searchParams.get("sslcert")).toBe("/tmp/ca.crt");
    expect(guardados).toEqual([SUPABASE_ROOT_CA_2021]);
  });

  it("en una base local no usa SSL", () => {
    const url = new URL(
      urlMigraciones({ DIRECT_URL: "postgresql://u:p@localhost:5432/db?sslaccept=strict" }, guardar)!,
    );
    expect(url.searchParams.has("sslmode")).toBe(false);
    expect(url.searchParams.has("sslaccept")).toBe(false);
  });
});
