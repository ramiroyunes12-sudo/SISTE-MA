# Sistema de entradas

Venta de entradas por lotes con QR enviado por mail y validación en la puerta.

- Plan general: [PLAN.md](PLAN.md)
- Pasos y avance: [PASOS.md](PASOS.md)
- Diseño de pantallas: https://claude.ai/artifact/TEQZ3qY3s5V2eufJfgSWtJ

## Correrlo en tu compu

Necesitás **Node.js 22.12 o más nuevo** (lo más fácil: bajá la versión LTS de nodejs.org) y **Git**.

```bash
git clone https://github.com/ramiroyunes12-sudo/SISTE-MA.git
cd SISTE-MA
npm install       # baja las librerías (la primera vez y cada vez que bajes cambios con git pull)
cp .env.example .env   # después completá .env (ver "Base de datos")
npm run dev       # levanta el sistema
```

Después abrí http://localhost:3000 en el navegador.

## Base de datos (Supabase)

El sistema guarda todo en una base PostgreSQL en [Supabase](https://supabase.com). Se configura con tres variables:

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Dirección que usa el sistema (Transaction pooler, puerto **6543**). |
| `DIRECT_URL` | Dirección para crear y modificar tablas (Session pooler, puerto **5432**). |
| `DATABASE_CA_CERT` | Certificado de Supabase, para que la conexión vaya cifrada y verificada. |

### 1. Crear el proyecto

1. En supabase.com → **New project**.
2. **Database Password**: usá solo letras y números (los símbolos rompen la dirección de conexión). Guardala bien.
3. **Region**: South America (São Paulo), la más cercana a Argentina.

### 2. Copiar las direcciones

En el proyecto, botón **Connect** (arriba):

- **Transaction pooler** → copiá la dirección en `DATABASE_URL`.
- **Session pooler** → copiá la dirección en `DIRECT_URL`.

En las dos, reemplazá `[YOUR-PASSWORD]` por tu contraseña (sin los corchetes).

### 3. Bajar el certificado

En **Database → Settings → SSL Configuration** tocá **Download certificate** (se baja `prod-ca-2021.crt`). Abrilo con el Bloc de notas y copiá todo el texto, desde `-----BEGIN CERTIFICATE-----` hasta `-----END CERTIFICATE-----`, en `DATABASE_CA_CERT`.

> El certificado es público (es igual para todos los proyectos de Supabase). Las direcciones de conexión, en cambio, **tienen tu contraseña**: no las compartas ni las subas a GitHub.

### 4. Cargar las variables

- **En Vercel** (para probarlo en internet): Project → **Settings → Environment Variables**, una por una.
- **En tu compu**: en el archivo `.env` (copia de `.env.example`).

### 5. Probar la conexión

Abrí `/api/salud` (por ejemplo `https://tu-proyecto.vercel.app/api/salud` o `http://localhost:3000/api/salud`):

- `{"estado":"ok","baseDeDatos":"conectada"}` → anda.
- Si dice `"estado":"error"`, mirá el `motivo`:

| `motivo` | Qué revisar |
|---|---|
| `falta_database_url` | No está cargada `DATABASE_URL`. |
| `database_url_invalida` | La dirección está mal copiada o la contraseña tiene símbolos. |
| `falta_certificado` | No está cargado `DATABASE_CA_CERT`. |
| `sin_conexion` | Contraseña incorrecta, certificado mal pegado o Supabase pausado. El detalle está en los logs de Vercel. |

## Probarlo en internet (Vercel)

1. En vercel.com → **Add New… → Project** → importá el repo **SISTE-MA**.
2. Antes de tocar **Deploy**, abrí **Environment Variables** y cargá las tres variables de arriba.
3. **Deploy**. Al terminar te da una dirección tipo `https://siste-ma.vercel.app`.

Cada vez que se sube un cambio a GitHub, Vercel lo vuelve a publicar solo.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el sistema en modo desarrollo (se actualiza solo al guardar). |
| `npm run build` | Arma la versión final optimizada. |
| `npm run start` | Corre la versión armada con `build`. |
| `npm test` | Corre los tests automáticos. |
| `npm run lint` | Revisa errores comunes en el código. |
| `npm run typecheck` | Revisa los tipos de TypeScript. |

## Tecnologías

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) para los estilos
- [Prisma 7](https://www.prisma.io) + PostgreSQL en [Supabase](https://supabase.com)
- [Vitest](https://vitest.dev) para los tests
