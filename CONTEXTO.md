# Contexto del proyecto

> Este archivo se carga solo en cada chat nuevo (lo importa `CLAUDE.md`). Es la fuente de verdad del **estado actual**: se actualiza al cerrar cada paso o etapa de un paso (skill `cerrar-paso`). Mantenerlo corto (menos de ~150 líneas): el detalle va en los otros documentos.

## Qué es

Sistema de venta de entradas por lotes para varias **productoras** (se alquila por evento): página pública del evento, compra con reserva de 15 min, cobro por transferencia o Mercado Pago, entrada con código firmado, QR y PDF (después, por mail) y validación en la puerta. El dueño de la plataforma es Ramiro (ADMIN).

## Dónde está todo

| Qué | Dónde |
|---|---|
| Producción | https://siste-ma.vercel.app (Vercel, proyecto `siste-ma`, funciones en São Paulo `gru1`) |
| Rama principal | `claude/ticket-sales-system-2qfswg` (la default de GitHub). **Lo que entra ahí se publica solo** y aplica las migraciones pendientes en Supabase. |
| Base | Supabase (São Paulo), PostgreSQL, esquema `entradas`, usuario `entradas_app` |
| Stack | Next.js 16 (App Router, ver `AGENTS.md`), TypeScript, Tailwind 4, Prisma 7, Vitest, Node ≥ 22.12 |
| Diseño de pantallas | https://claude.ai/artifact/TEQZ3qY3s5V2eufJfgSWtJ |

## Estado actual

- **Hechos y probados:** pasos 1 a 17 (base, login, productoras, evento y lotes, página pública, reparto entre lotes, datos del checkout, reserva, cobro por transferencia y Mercado Pago con plata real el 8/10/2026, código firmado de cada entrada, QR y PDF, y el mail con las entradas, probados el 9/10/2026; "Compra confirmada" y "Reenviar mis entradas", y el escáner de la puerta con "Validadores", probados el 10/10/2026).
- El panel todavía **no lista las compras pagas ni sus entradas** (llega en el paso 20): solo muestra cuántas, lo cobrado y los mails que no salieron. El código de cada entrada se ve en el link secreto de la compra y en el mail.
- Los mails salen por Gmail (`sistemaentradas@gmail.com`, contraseña de aplicación). Ramiro no quiere pagar un servicio de mails: se queda Gmail aunque algunos caigan en spam.
- Decidido por Ramiro (10/10): **las devoluciones de plata no van por el sistema**; quien la pide se contacta con él (WhatsApp de ayuda). En el paso 20, en vez de reembolsos, ver un "Anular compra" para que esos QR no entren.
- Decidido por Ramiro (10/10): **la menor cantidad de mails**. Las compras de una misma persona (mismo email) en un evento que salen a la vez van en un solo mail; el reenvío llega con el asunto "Te reenviamos tus entradas…".
- **Paso 18** (buscar por DNI o nombre y contador en la puerta): **borrador probado por Ramiro en producción** (10/10/2026); revisión con agentes en curso. Decidido por Ramiro: DNI completo o nombre desde 3 letras (hasta 10); marcar el ingreso sin QR, solo organizador y ADMIN; "Ingresaron X de Y" para todos. Después de la revisión, que Ramiro pruebe los arreglos (ver "Para probarlo" del paso 18 en `PASOS.md`).

## Acciones del dueño pendientes

Cosas que hace Ramiro a mano (no se pueden hacer desde el chat). Lista completa en `PENDIENTES.md`.

1. Después de cada evento, vaciar "Enviados" de `sistemaentradas@gmail.com` (guarda copia de las entradas).

## Cómo trabajamos

- **Un chat por paso** (o por etapa de un paso largo). El chat arranca con `/empezar-paso` y cierra cada etapa con `/cerrar-paso`. Así el próximo chat no necesita nada de este.
- **Etapas de un paso:** (1) si hay decisiones abiertas, preguntarle al dueño con opciones y una recomendación → (2) borrador: commit `Paso N (borrador para revisar): ...` → (3) revisión con agentes en paralelo, verificar cada hallazgo → (4) commit `Paso N: arreglos de la revisión con agentes` → (5) el dueño lo prueba en producción → `[x]` en `PASOS.md`.
- **Antes de cada commit:** skill `verificar` (test que falla primero en lo delicado; typecheck, lint y tests con Postgres local, 0 salteados).
- **Idioma:** todo en español rioplatense y simple (código, commits, docs, mensajes). Ramiro no necesita jerga: decir qué probar y dónde hacer clic.
- **Ramas:** el chat no publica solo. Al cerrar cada etapa abre un pull request de su rama hacia la principal y le da a Ramiro **el link directo al PR** para que toque "Merge pull request" → "Confirm merge" (pedido por él el 9/10/2026). Si ya hay un PR abierto de la rama, se reusa y se le vuelve a pasar el link.

## Reglas que no se negocian

Detalle en `.claude/rules/` (se cargan solas al tocar esos archivos) y permisos en `.claude/settings.json`.

- Nunca `migrate dev`/`reset`/`db push` ni SQL que escriba contra Supabase. Las migraciones las aplica el deploy (`scripts/migrar.mjs`).
- Nada de Mercado Pago, mails, QR ni PDF dentro de una transacción. Cambios de una sola vez con `UPDATE` condicionado y mirar `count`.
- Datos personales (nombre, DNI, email, celular) nunca en URLs, logs, `localStorage` ni el QR.
- Claves nunca en el repo ni en el chat: se generan en el panel → Claves y se cargan en Vercel.
- Cada acción nueva: `requerirUsuario()` + filtro de `src/lib/auth/alcance.ts` (cada productora ve solo lo suyo).

## Mapa de documentos

| Archivo | Para qué | Cuándo se toca |
|---|---|---|
| `CONTEXTO.md` | Estado actual, cómo trabajamos, traspaso | Al cerrar cada etapa |
| `PASOS.md` | Los 21 pasos con notas, decisiones ("Decidido") y "Para más adelante" de cada uno | Al cerrar cada etapa |
| `PENDIENTES.md` | Acciones manuales del dueño y cosas sin paso asignado | Cuando aparece o se resuelve algo |
| `BITACORA.md` | Historial corto: qué hizo cada chat | Al cerrar cada chat |
| `PLAN.md` | Alcance, seguridad, modelo de datos (cambia poco) | Solo si cambia el alcance |
| `README.md` | Cómo funciona cada parte, para quien lo usa o instala | Cuando cambia algo visible |

## Mapa del código

| Carpeta | Qué hay |
|---|---|
| `src/app/e/[slug]` | Página pública del evento, "Continuar" (reserva) y `mis-entradas` ("Reenviar mis entradas" con email y DNI) |
| `src/app/compra/[llave]` | La compra: datos, reloj, pago, "Compra confirmada" con el QR de las entradas, "Reenviar el mail" y `pdf/` (descarga) |
| `src/app/admin/` | Panel: `eventos` (lotes, pagos, verificar entrada), `productoras` (gente, cobros), `validadores` (del organizador), `claves` |
| `src/app/validar` | Puerta: elegir el evento y `[id]`: `puerta.tsx` (contador y pestañas), `escaner.tsx` (cámara, BarcodeDetector o jsQR), `buscar.tsx` (DNI o nombre, marcar ingreso), `resultado.tsx` (verde/rojo en pantalla completa) |
| `src/app/api/` | `mercadopago/aviso` (aviso de pagos), `mails/pendientes` (tarea diaria de Vercel), `puerta/` (`escanear`, `buscar`, `marcar` y `contador`; lo común en `comun.ts`), `salud` (estado de la base) |
| `src/lib/auth` | Login, sesiones, contraseñas, `alcance.ts` (qué ve cada rol) |
| `src/lib/eventos` | Guardar evento, lotes, vista pública |
| `src/lib/ventas` | Reparto por lote, reservas, órdenes, turno del evento, simulación |
| `src/lib/pagos` | Cobros, confirmar, montos únicos, cuenta de Mercado Pago |
| `src/lib/entradas` | Código firmado (`codigo.ts`), verificar, escanear y marcar sin QR en la puerta (`escanear.ts`), buscar por DNI o nombre y el contador (`buscar.ts`), lo que ve la puerta (`puerta.ts`), QR (`qr.ts`, también el PNG del mail), entradas con QR (`imprimir.ts`), PDF (`pdf.ts`, `texto-pdf.ts`, `descarga.ts`) |
| `src/lib/mails` | Mail con las entradas: SMTP (`cartero.ts`), contenido (`entradas.ts`, una o varias compras de la misma persona), envío una sola vez, compras juntas y reintentos (`pendientes.ts`), reenviar con límite (`reenviar.ts`), `after()` (`despues.ts`). El WhatsApp para consultas: `src/lib/ayuda.ts` |
| `prisma/` | `schema.prisma`, migraciones, datos de prueba |
| `scripts/` | `migrar.mjs` (deploy), `usuario.ts` (crear ADMIN / resetear contraseña) |

## Traspaso (último chat)

- **10/10/2026:** paso 17 `[x]` (Ramiro probó los arreglos). Paso 18: borrador publicado (PR #15) y probado por Ramiro en su iPhone; se lanzó la revisión con 3 agentes (seguridad y datos personales, base y carreras, pantalla del celu).
- **Para el próximo chat:** si la revisión no quedó anotada en `PASOS.md` (paso 18, "Revisado con…"), volver a hacerla: agentes en paralelo, verificar cada hallazgo, arreglar con su test y commit `Paso 18: arreglos de la revisión con agentes`. Arrancar con `/empezar-paso 18`.
