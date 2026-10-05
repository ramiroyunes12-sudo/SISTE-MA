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

El sistema guarda todo en una base PostgreSQL en [Supabase](https://supabase.com) (proyecto en São Paulo). Se conecta con un usuario propio, `entradas_app`, que no es administrador: la contraseña principal de Supabase queda solo para el dueño.

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Dirección que usa el sistema (Transaction pooler, puerto **6543**). |
| `DIRECT_URL` | Dirección para crear y modificar tablas (Session pooler, puerto **5432**). |
| `DATABASE_CA_CERT` | Opcional. El certificado de Supabase ya viene en el código (`src/lib/supabase-ca.ts`). |

Las direcciones tienen contraseña: van solo en Vercel (Settings → Environment Variables) o en tu `.env`. **Nunca en GitHub.**

### Probar la conexión

Abrí https://siste-ma.vercel.app/api/salud (o `http://localhost:3000/api/salud` en tu compu):

- `{"estado":"ok","baseDeDatos":"conectada"}` → anda.
- Si dice `"estado":"error"`, mirá el `motivo`:

| `motivo` | Qué revisar |
|---|---|
| `falta_database_url` | No está cargada `DATABASE_URL`. |
| `database_url_invalida` | La dirección está mal copiada o la contraseña tiene símbolos. |
| `falta_certificado` | La base no es de Supabase y falta `DATABASE_CA_CERT`. |
| `sin_conexion` | Contraseña incorrecta o Supabase pausado. El detalle está en los logs de Vercel. |

## Publicación (Vercel)

El proyecto `siste-ma` de Vercel está conectado a este repo: cada cambio que se sube a GitHub se publica solo en https://siste-ma.vercel.app. Las funciones corren en São Paulo (`gru1`, en `vercel.json`), al lado de la base.

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
