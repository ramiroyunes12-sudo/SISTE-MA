// Arma las opciones de conexión a PostgreSQL a partir de las variables de entorno.

import { SUPABASE_ROOT_CA_2021 } from "./supabase-ca";

export type MotivoErrorConfigDb =
  | "falta_database_url"
  | "database_url_invalida"
  | "falta_certificado";

export class ErrorConfigDb extends Error {
  readonly motivo: MotivoErrorConfigDb;

  constructor(motivo: MotivoErrorConfigDb, mensaje: string) {
    super(mensaje);
    this.name = "ErrorConfigDb";
    this.motivo = motivo;
  }
}

export type OpcionesConexion = {
  connectionString: string;
  ssl: false | { ca: string; rejectUnauthorized: true };
};

// Variables de entorno (se lee DATABASE_URL y DATABASE_CA_CERT).
type VariablesDb = Record<string, string | undefined>;

const HOSTS_LOCALES = new Set(["localhost", "127.0.0.1", "::1"]);

// Si la URL trae estos parámetros, `pg` los usa por encima de la opción `ssl`
// que armamos acá. Los sacamos para que siempre mande nuestra configuración.
const PARAMETROS_SSL = [
  "ssl",
  "sslmode",
  "sslcert",
  "sslkey",
  "sslrootcert",
  "sslpassword",
  "uselibpqcompat",
];

export function opcionesConexion(env: VariablesDb): OpcionesConexion {
  const valor = env.DATABASE_URL?.trim();
  if (!valor) {
    throw new ErrorConfigDb(
      "falta_database_url",
      "Falta la variable DATABASE_URL. Copiá .env.example como .env y completala.",
    );
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErrorConfigDb(
      "database_url_invalida",
      "DATABASE_URL no es una dirección válida. Revisá que la contraseña no tenga caracteres especiales sin codificar.",
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new ErrorConfigDb(
      "database_url_invalida",
      "DATABASE_URL tiene que empezar con postgresql://",
    );
  }

  for (const parametro of PARAMETROS_SSL) {
    url.searchParams.delete(parametro);
  }
  const connectionString = url.toString();

  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (HOSTS_LOCALES.has(host)) {
    return { connectionString, ssl: false };
  }

  // Supabase firma sus certificados con su propia autoridad (Supabase Root 2021 CA),
  // que Node no conoce. Para cifrar y además verificar el servidor, hay que pasarle ese certificado.
  // DATABASE_CA_CERT permite usar otro (por ejemplo, si Supabase lo renueva o se cambia de proveedor).
  const ca =
    env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim() ||
    (esHostDeSupabase(host) ? SUPABASE_ROOT_CA_2021 : undefined);
  if (!ca) {
    throw new ErrorConfigDb(
      "falta_certificado",
      "La base no es de Supabase: falta la variable DATABASE_CA_CERT con el certificado del servidor.",
    );
  }

  return { connectionString, ssl: { ca, rejectUnauthorized: true } };
}

function esHostDeSupabase(host: string) {
  return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}
