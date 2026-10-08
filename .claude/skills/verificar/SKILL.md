---
name: verificar
description: Antes de dar por terminado un paso o un arreglo, o de hacer commit: test que falla primero; después typecheck, lint y tests con la base local, sin tests de integración salteados.
---
1. Bug o lógica delicada (código firmado, escaneo, cupos, plata): primero el test. `npx vitest run <archivo>` y verlo FALLAR por el motivo buscado (no por un import o el setup). Recién ahí arreglar y correr el mismo archivo en verde. En concurrencia, el test tiene que fallar si se saca el turno o el UPDATE condicionado.
2. En orden, parando en el primer error: `npm run typecheck` → `npm run lint` → `TEST_DATABASE_URL=<base local> npm test`.
3. Sin `TEST_DATABASE_URL` los `*.integracion.test.ts` se saltean y el verde no prueba nada. Si Vitest muestra salteados: levantar el PostgreSQL 16 local (`/usr/lib/postgresql/16/bin`, con el usuario `postgres`, no root), crear una base y migrarla con `DIRECT_URL=<esa base> npx prisma migrate deploy`. Nunca contra Supabase.
4. `npm run build` solo antes de publicar.
5. Informe en 4 líneas: typecheck / lint / tests (N pasaron, 0 salteados) / build. Sin % de cobertura ni informes en archivos.
