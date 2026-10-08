---
paths:
  - "prisma/**"
  - "src/lib/**"
  - "src/app/api/**"
---
# Base de datos y errores
- Nunca `migrate dev`/`reset`/`db push` contra Supabase, ni cambios con el MCP de Supabase (`apply_migration`, `execute_sql` que escriba): las migraciones las aplica el deploy de producción (`scripts/migrar.mjs`). El SQL se genera contra el Postgres local (`DIRECT_URL` local + `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`). No editar migraciones ya aplicadas.
- `DATABASE_URL` es Transaction pooler: solo `pg_advisory_xact_lock` y `set_config(..., true)`; nada de locks de sesión ni `SET`.
- En `$transaction` nada de Mercado Pago, SMTP, QR ni PDF: guardar qué mandar y mandarlo después del commit.
- Cambios de una sola vez (entrada usada, orden pagada): condición en el `where` y mirar `count` (o `updateManyAndReturn`), nunca leer y después escribir.
- P2002 en un código: reintentar con otro. Carga masiva: `createMany`.
- Ningún `catch` que devuelva éxito, `null` o `[]` callado: mail fallido = orden marcada para reintentar; error de la API de Mercado Pago ≠ "no pagó"; el escáner ante error dice NO VÁLIDA.
