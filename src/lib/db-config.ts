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
  connectionTimeoutMillis: number;
  query_timeout: number;
};

// Si la base no contesta, mejor cortar y mostrar "no pudimos conectar" que
// dejar la pantalla esperando minutos.
const LIMITES = { connectionTimeoutMillis: 5_000, query_timeout: 20_000 };

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
  const url = leerUrl(env, "DATABASE_URL");
  const host = hostDe(url);
  if (HOSTS_LOCALES.has(host)) {
    return { connectionString: url.toString(), ssl: false, ...LIMITES };
  }
  return {
    connectionString: url.toString(),
    ssl: { ca: certificadoPara(host, env), rejectUnauthorized: true },
    ...LIMITES,
  };
}

// Dirección para `prisma migrate` (DIRECT_URL). Siempre usa el esquema "entradas"
// y, si la base es remota, exige cifrado verificando el certificado del servidor.
// `guardarCertificado` escribe el certificado en un archivo y devuelve su ruta,
// porque Prisma lo lee de un archivo y no de una variable.
export function urlMigraciones(
  env: VariablesDb,
  guardarCertificado: (pem: string) => string,
): string | undefined {
  if (!env.DIRECT_URL?.trim()) return undefined; // `prisma generate` no necesita la base
  const url = leerUrl(env, "DIRECT_URL");
  url.searchParams.delete("sslaccept");
  url.searchParams.set("schema", "entradas");
  const host = hostDe(url);
  if (!HOSTS_LOCALES.has(host)) {
    url.searchParams.set("sslmode", "require");
    url.searchParams.set("sslaccept", "strict");
    url.searchParams.set("sslcert", guardarCertificado(certificadoPara(host, env)));
  }
  return url.toString();
}

function leerUrl(env: VariablesDb, variable: "DATABASE_URL" | "DIRECT_URL"): URL {
  const valor = env[variable]?.trim();
  if (!valor) {
    throw new ErrorConfigDb(
      "falta_database_url",
      `Falta la variable ${variable}. Copiá .env.example como .env y completala.`,
    );
  }

  let url: URL;
  try {
    url = new URL(valor);
  } catch {
    throw new ErrorConfigDb(
      "database_url_invalida",
      `${variable} no es una dirección válida. Revisá que la contraseña no tenga caracteres especiales sin codificar.`,
    );
  }
  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new ErrorConfigDb(
      "database_url_invalida",
      `${variable} tiene que empezar con postgresql://`,
    );
  }

  for (const parametro of PARAMETROS_SSL) {
    url.searchParams.delete(parametro);
  }
  return url;
}

function hostDe(url: URL) {
  return url.hostname.replace(/^\[|\]$/g, "");
}

// Supabase firma sus certificados con su propia autoridad (Supabase Root 2021 CA),
// que Node no conoce. Para cifrar y además verificar el servidor, hay que pasarle ese certificado.
// DATABASE_CA_CERT permite usar otro (por ejemplo, si Supabase lo renueva o se cambia de proveedor).
function certificadoPara(host: string, env: VariablesDb): string {
  const ca =
    env.DATABASE_CA_CERT?.replace(/\\n/g, "\n").trim() ||
    (esHostDeSupabase(host) ? SUPABASE_ROOT_CA_2021 : undefined);
  if (!ca) {
    throw new ErrorConfigDb(
      "falta_certificado",
      "La base no es de Supabase: falta la variable DATABASE_CA_CERT con el certificado del servidor.",
    );
  }
  return ca;
}

function esHostDeSupabase(host: string) {
  return host.endsWith(".supabase.com") || host.endsWith(".supabase.co");
}
