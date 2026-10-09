# Sistema de entradas

Venta de entradas por lotes con QR enviado por mail y validación en la puerta.

- Estado actual y cómo trabajamos (empezar por acá): [CONTEXTO.md](CONTEXTO.md)
- Plan general: [PLAN.md](PLAN.md)
- Pasos y avance: [PASOS.md](PASOS.md)
- Pendientes del dueño y temas sueltos: [PENDIENTES.md](PENDIENTES.md)
- Historial por chat: [BITACORA.md](BITACORA.md)
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

### Tablas y migraciones

- Las tablas están en `prisma/schema.prisma`, dentro del esquema **`entradas`** (no en `public`), así la API automática de Supabase no las publica. En el panel de Supabase se ven en **Table Editor → schema `entradas`**.
- Cada cambio a las tablas es una **migración** en `prisma/migrations/`. En el deploy de **producción**, Vercel aplica las pendientes antes de armar el sistema (`scripts/migrar.mjs`). Los deploys de prueba no tocan la base.
- Las migraciones usan siempre `DIRECT_URL` (nunca `DATABASE_URL`). `prisma.config.ts` le agrega solo el esquema `entradas` y, en una base remota, el cifrado verificando el certificado.
- Las reglas importantes las cuida la propia base (al final de la migración inicial): nunca más vendidas + reservadas que el cupo, cortesías dentro de su cupo, email/titular/DNI obligatorios desde que se paga, una entrada no puede mezclar eventos, no se devuelve más de lo cobrado.
- Preparación de una base nueva (una sola vez, como administrador):

  ```sql
  create role entradas_app with login password '...';
  create schema entradas;
  grant usage, create on schema entradas to entradas_app;
  ```

### Datos de prueba

`npx prisma db seed` carga un **evento de ejemplo** (`evento-de-prueba`): General con Lotes 1, 2 y 3 ($6.000 / $8.000 / $10.000) y VIP ($15.000). Se puede correr varias veces: actualiza lo que existe, no duplica y nunca toca las ventas. Los datos están en `prisma/datos-prueba.ts`.

> Antes de empezar a vender de verdad, hay que borrar el evento de prueba.

### Tests con base de datos

Los archivos `*.integracion.test.ts` prueban contra una base de verdad: las reglas que cuida la base (por ejemplo, que nunca se venda más que el cupo) y el login (bloqueo por intentos, sesiones). Necesitan un PostgreSQL de prueba con las migraciones aplicadas; si no está `TEST_DATABASE_URL`, se saltean:

```bash
TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/prueba" npm test
```

## Panel y usuarios

- Se entra por **`/ingresar`**. Los **admin** y **organizadores** van al panel (`/admin`); los **validadores**, a la puerta (`/validar`). Un validador no puede entrar al panel.
- **Productoras**: la plataforma la usan varias. Cada evento es de una productora, y su gente (organizadores y validadores) ve y toca solo lo suyo. El **ADMIN** (dueño de la plataforma) ve todo y es el único que crea productoras y su gente (Panel → **Productoras**). Desactivar una productora deja afuera a toda su gente enseguida. El filtro está en un solo lugar: `src/lib/auth/alcance.ts`.
- Las contraseñas se guardan cifradas con scrypt (`src/lib/auth/contrasenas.ts`), nunca tal cual. No se aceptan las muy usadas ("1234567890", "argentina1", "qwertyuiop"…) ni las que contienen el email (`src/lib/auth/reglas.ts`).
- La sesión se cierra a los 7 días sin usarla, y siempre a los 30. "Cerrar sesión" la corta en ese navegador; cambiar la contraseña cierra todas las demás.
- 5 contraseñas mal seguidas bloquean la cuenta 15 minutos (después, 1 intento cada 15 minutos hasta acertar). El mensaje de error es siempre el mismo, para no delatar qué emails tienen cuenta.
- Cada página y acción del panel controla el permiso con `requerirUsuario()` (`src/lib/auth/actual.ts`).

### Crear un ADMIN o resetear una contraseña

Las cuentas de las productoras se crean desde el panel (Productoras). Este comando es para el dueño de la plataforma:

```bash
npm run usuario -- --email vos@gmail.com --nombre "Tu Nombre" --rol ADMIN
npm run usuario -- --email ana@gmail.com   # cualquier cuenta que ya exista: contraseña nueva
```

Muestra una **contraseña temporal** que **vence en 72 horas**: al entrar, el sistema le pide elegir una propia. Resetear también desbloquea la cuenta y cierra sus sesiones. Usa la `DATABASE_URL` del `.env`.

Sin acceso a la base desde la compu, `--sql` no se conecta: imprime el SQL para pegar en Supabase (**SQL Editor**). Hacen falta `--nombre` y `--rol`; si el usuario ya existe, solo le resetea la contraseña.

```bash
npm run usuario -- --sql --email vos@gmail.com --nombre "Tu Nombre" --rol ADMIN
```

> Si alguien prueba contraseñas sin parar contra un email, esa cuenta queda bloqueada mientras dure el ataque (las sesiones ya abiertas siguen andando), y resetearla no alcanza. La salida es cambiarle el email a ese usuario.

## Eventos y lotes

En el panel, **Evento y lotes** (`/admin/eventos`): crear un evento, editar sus datos, sus tipos de entrada (General, VIP…) y los lotes de cada tipo. Todo se guarda junto con "Guardar cambios" (`src/lib/eventos/guardar.ts`, en una sola transacción).

- Estado: **Borrador** (no se ve), **Publicado** (a la venta) o **Finalizado**. Para publicar hace falta al menos un lote.
- Se vende de a un lote por vez, en orden: el primero con lugar está "En venta"; cuando se agota, se abre el siguiente (`src/lib/eventos/lotes.ts`).
- No se puede bajar el cupo de un lote por debajo de lo vendido + reservado, ni quitar lotes o tipos que ya tienen entradas (lo frena también la base).
- Precios en pesos como se escriben acá ("8.000", "8000,50"); en la base van en centavos (`src/lib/dinero.ts`). Fechas en hora argentina (`src/lib/fechas.ts`).

## Página del evento

La página pública es `/e/<dirección>` (por ejemplo, https://siste-ma.vercel.app/e/evento-de-prueba). En el panel, el link **Ver página ↗** (o **Vista previa ↗** si es un borrador) lleva directo.

- De cada tipo de entrada, el público ve **solo el lote en venta** (nombre y precio). Ni cantidades vendidas o disponibles, ni los lotes que siguen: esos datos no salen del servidor (`src/lib/eventos/publico.ts`). Cuando un lote se agota, aparece el siguiente; si no queda ninguno, "Agotado".
- Se arma en cada visita (no queda guardada en caché), así el lote que se ve es siempre el de ese momento.
- Borradores y eventos de productoras desactivadas: para el público no existen (404). El ADMIN y los organizadores de esa productora los ven como **vista previa**, con un cartel arriba.
- Finalizado: se ve la información, sin venta.
- "Continuar" **reserva las entradas 15 minutos** y lleva a la compra (`/compra/<llave>`, un link secreto): reloj, resumen con el reparto real por lote, un bloque por entrada con nombre y DNI, y email y celular de quien compra (`src/lib/ventas/datos.ts`, se revisa en el navegador y otra vez en el servidor). Con los datos completos, se elige cómo pagar (ver "Cobros"). El flyer, cuando se puedan subir imágenes.

## Ventas: lotes y reservas

El motor de la venta está en `src/lib/ventas/` (la pantalla de compra llega en los pasos 9 a 12):

- **Reparto** (`pedido.ts`): se vende primero el lote de menor número con lugar; si en ese no entra todo el pedido, el resto va al siguiente, a su precio. Ej.: piden 4 y al Lote 1 le quedan 2 → 2 del Lote 1 y 2 del Lote 2. Las reservas sin pagar ocupan lugar; si vencen, el lote anterior vuelve a estar en venta. Los mensajes de error nunca dicen cuántas quedan.
- **Reservar, liberar y confirmar** (`reservas.ts`): siempre dentro de una transacción. Primero se toma el **turno del evento** (`turno.ts`, un bloqueo de PostgreSQL con fila justa): las compras y las ediciones de un mismo evento pasan de a una, en orden de llegada. Además la base no deja que vendidas + reservadas pasen el cupo.
- Si hay tanta gente que alguien espera su turno más de unos segundos, la operación falla sin cambiar nada y se puede reconocer con `esperoDemasiado()` (`src/lib/errores-db.ts`).
- **Reservas** (`ordenes.ts`): "Continuar" crea la orden PENDIENTE con sus entradas y aparta los lugares por 15 minutos. Si vence o se cancela, la orden se cierra una sola vez y los lugares vuelven. Límite de reservas abiertas: 3 por navegador (cookie) y 15 por conexión (IP); en la base solo quedan huellas de la llave del link, la cookie y la IP.
- **Probar una compra**: en el panel, debajo de cada evento, muestra cómo se cobraría un pedido si alguien comprara ahora (mismas reglas, no reserva nada; `simulacion.ts`). Para ver el reparto entre lotes con el evento de prueba, bajale el cupo al Lote 1 (por ejemplo a 2) y probá 4 de General.

## Cobros

Quien compra elige (`/compra/<llave>`, después de completar los datos):

- **Transferencia (sin recargo)**: ve el alias de la productora y un **monto único** (el total más desde $0,01; primero los centavos más chicos), con botones para copiar. Como una transferencia no dice quién la mandó, el monto exacto es lo que la ata a su compra (`montos_transferencia`: no se repite dentro de la productora; después de cerrada la orden queda atado 2 horas, o 6 si se pagó, por si la plata llega tarde o dos veces). Una misma conexión puede tener como mucho 15 montos sin pagar.
- **Mercado Pago (con cargo por servicio)**: se abre Mercado Pago (en el celu, la app) con todo cargado (Checkout Pro). El cargo cubre la comisión (por defecto 4,4%; la comisión que medimos fue 4,21% con la plata a 18 días) y queda fijo desde el primer cobro. El cobro vence 2 minutos antes que la reserva (si quedan menos de 5 minutos, la reserva se estira una vez).
- Las dos formas necesitan la **cuenta de Mercado Pago de la productora conectada**: sin ella no se ofrece ninguna.

Cómo se sabe que entró la plata (`src/lib/pagos/cobros.ts`): se miran los pagos de la cuenta de Mercado Pago de la productora — mientras quien compra espera en la pantalla (como mucho una consulta cada 5 segundos por productora, pidiendo solo lo nuevo desde la revisión anterior), cuando Mercado Pago avisa (`/api/mercadopago/aviso?p=<productora>`, el link va en cada cobro) y cuando vuelve del cobro. Todo lo que se toma de Mercado Pago se pide con el token de la productora: un aviso inventado no confirma nada.

Al confirmar (`src/lib/pagos/confirmar.ts`), con el turno del evento: la orden pasa a PAGADA una sola vez y sus reservadas, a vendidas. Cada pago se registra una sola vez. Si llega tarde (la reserva ya venció) y todavía hay lugar en esos lotes, se confirma igual; si no hay lugar, o si es un pago repetido, queda **para devolver** (el panel lo muestra, y quien compra lo ve en su link). Una reserva que ya eligió cómo pagar no se cancela sola al volver a elegir, y "Cambiar entradas" pregunta antes.

En el panel:
- **Productoras → (una) → Cobros** (ADMIN): alias o CVU, a nombre de quién está, cargo por servicio y la cuenta de Mercado Pago (se pega el Access Token de producción; se guarda cifrado con `CLAVE_CIFRADO` y no se vuelve a mostrar). El alias tiene que ser de esa misma cuenta: es la que se revisa. Una cuenta de Mercado Pago se puede conectar a una sola productora.
- **Evento → Pagos**: lo cobrado, las compras esperando la plata (con **Confirmar pago** para los casos raros, por ejemplo si transfirió sin los centavos), los pagos para devolver (con "Dar las entradas igual" si pagó tarde y se hizo lugar) y los pagos que Mercado Pago revirtió (devolución o contracargo). "Buscar pagos ahora" revisa los movimientos en el momento.

| Variable | Qué es |
|---|---|
| `CLAVE_CIFRADO` | Clave para cifrar los tokens de Mercado Pago en la base (32+ caracteres al azar; generala en el panel → Claves). Si se cambia, hay que volver a conectar las cuentas (el panel avisa). |
| `CLAVE_CODIGOS` | Clave para firmar el código de cada entrada (otra distinta, 32+ caracteres al azar; panel → Claves). Si se cambia, ningún QR ya emitido sirve más: guardala aparte. |
| `URL_PUBLICA` | Opcional. A dónde vuelve y avisa Mercado Pago. En Vercel no hace falta. |

## Entradas: el código

Cada entrada tiene un código (`src/lib/entradas/codigo.ts`) que va dentro de su QR: `E1-<128 bits al azar>-<firma>`, en hexadecimal con mayúsculas. La firma es un HMAC-SHA256 con su propia clave (`CLAVE_CODIGOS`, separada de la de los tokens); `E1` es la versión de esa clave.

En la base (`entradas.codigo`) se guarda solo la parte al azar: con una copia de la base no se puede armar un QR válido, y con la clave sola tampoco. Al leer un código se revisa primero la firma (sin tocar la base) y después se busca la entrada.

Las claves secretas (`CLAVE_CODIGOS`, `CLAVE_CIFRADO`) se generan en el panel, **Claves** (solo ADMIN): se arman en el navegador, no pasan por el servidor ni por ningún chat.

En el panel, **Evento → Verificar una entrada**: se pega un código y dice si es VÁLIDA (y de quién es), YA USADA, SIN PAGAR, ANULADA o NO VÁLIDA. Solo mira: no la marca usada.

## Entradas: QR y PDF

En una compra paga, el link de la compra (`/compra/<llave>`) muestra cada entrada con su **QR** y el código escrito abajo (por si no se puede escanear). El QR lleva solo el código firmado, nunca nombre ni DNI (`src/lib/entradas/qr.ts`). La página es siempre clara, para que el modo oscuro del celu no invierta el QR.

- **Descargar las N entradas (PDF)**: un PDF con una página (A6) por entrada: evento, fecha, lugar, tipo, nombre, DNI y QR (y "YA USADA" si ya entró). **Descargar solo esta**: la de una persona, para pasársela (aparece con 2 entradas o más). Se abre en el visor del celu; desde ahí se guarda o se comparte.
- Los PDF se arman en el momento en nuestro servidor (`src/lib/entradas/pdf.ts`, con `pdf-lib`) y no se guardan: se vuelven a armar desde la base cuando hace falta. La ruta es `/compra/<llave>/pdf` (`?entrada=N` para una sola, `src/lib/entradas/descarga.ts`); como la página, la llave del link es el permiso.
- Solo salen las entradas válidas o usadas de compras pagas; las anuladas lo dicen, sin QR.
- Los nombres de cada entrada se aceptan solo con letras latinas (con acentos), como en el DNI, para poder imprimirlos.

## Publicación (Vercel)

El proyecto `siste-ma` de Vercel está conectado a este repo: cada cambio que se sube a GitHub se publica solo en https://siste-ma.vercel.app. Las funciones corren en São Paulo (`gru1`, en `vercel.json`), al lado de la base.

## Claude Code (`.claude/`)

- `settings.json`: permisos. Prohíbe lo destructivo (resetear o empujar el esquema con Prisma, `git push --force`, borrar ramas, leer `.env` o las variables del entorno, migrar o pausar producción por el MCP de Supabase, comprar dominios) y pide confirmación para lo que toca producción (SQL en Supabase, claves y deploys de Vercel, mails, merges).
- `skills/verificar`: cómo dar un paso por terminado (test que falla primero, typecheck, lint y tests con la base local, sin salteados).
- `skills/empezar-paso` y `skills/cerrar-paso`: arrancar un chat con el contexto justo y, al cerrar cada etapa, dejar al día `PASOS.md`, `CONTEXTO.md`, `PENDIENTES.md` y `BITACORA.md`. `CLAUDE.md` importa `CONTEXTO.md`, así cada chat nuevo lo recibe solo.
- `rules/`: reglas que se cargan solo al tocar esos archivos: `base-de-datos.md` (prisma, `src/lib`, `src/app/api`) y `datos-personales.md` (`src`).
- Adaptado de [ECC](https://github.com/affaan-m/everything-claude-code) (2.2.3) a mano: sin hooks ni instalador.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Levanta el sistema en modo desarrollo (se actualiza solo al guardar). |
| `npm run build` | Arma la versión final optimizada. |
| `npm run start` | Corre la versión armada con `build`. |
| `npm test` | Corre los tests automáticos. |
| `npm run lint` | Revisa errores comunes en el código. |
| `npm run typecheck` | Revisa los tipos de TypeScript. |
| `npm run usuario -- ...` | Crea un usuario del panel o le resetea la contraseña (ver "Panel y usuarios"). |

## Tecnologías

- [Next.js 16](https://nextjs.org) (App Router) + TypeScript
- [Tailwind CSS 4](https://tailwindcss.com) para los estilos
- [Prisma 7](https://www.prisma.io) + PostgreSQL en [Supabase](https://supabase.com)
- [Vitest](https://vitest.dev) para los tests
