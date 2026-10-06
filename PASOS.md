# Pasos

Cada paso termina con algo para probar. Se marca `[x]` cuando está revisado.

## Bloque 0 — Preparar el terreno
- [x] **1. Crear el proyecto vacío** — Next.js + TypeScript + Tailwind, página de bienvenida.
- [x] **2. Conectar la base de datos** — PostgreSQL en Supabase + Prisma. https://siste-ma.vercel.app/api/salud → conectada.
  - Ojo: instalar Prisma 7 con versión explícita (`prisma@7`, `@prisma/client@7`). Hoy el `latest` de `prisma` es una 8.0 RC sin `generate` ni `migrate`.
  - El sistema usa el usuario `entradas_app` (sin permisos de administrador).
- [x] **3. Definir las tablas** — usuarios, eventos, tipos_entrada, lotes, ordenes, pagos, entradas, escaneos.
  - Esquema `entradas` (no `public`): la API de Supabase no lo publica. Migraciones automáticas en el deploy de producción.
  - Pendiente (menor): Supabase sugiere índices para 6 claves foráneas (entradas.lote/orden/tipo, validada_por, escaneos.usuario, ordenes.emitida_por). Sumarlos en una migración cuando haya datos.
  - Para el paso 9: ¿una misma persona (DNI) puede tener dos entradas del mismo evento? Hoy la base lo permite.
- [x] **4. Datos de prueba** — `npx prisma db seed`: "Evento de prueba" (sáb 21/11/2026 23:00) con General (Lotes 1–3) y VIP. Cargado en Supabase.
  - Borrar el evento de prueba antes del paso 21 (salir a vender).
  - El usuario admin se crea en el paso 5, junto con el login.

## Bloque 1 — Admin: login y evento
- [x] **5. Login del administrador** — roles admin y validador. Entrar por `/ingresar`: el admin va a `/admin`, el validador a `/validar`.
  - Usuarios nuevos o contraseña olvidada: `npm run usuario` (da una contraseña temporal que vence en 72 h y se cambia al entrar; con `--sql` imprime el SQL para Supabase).
  - Revisado por 5 revisores + verificadores: se arreglaron 30 hallazgos (contraseñas comunes, carreras al cambiar la contraseña, mensajes que delataban emails, errores en español, vencimiento de la temporal).
  - Para más adelante (opcional): además del bloqueo por cuenta, limitar intentos por IP con el firewall de Vercel.
- [x] **6. Pantalla "Evento y lotes"** — crear/editar evento, tipos y lotes. Panel → "Evento y lotes" (`/admin/eventos`).
  - Precios en pesos ("8.000"), fecha en hora argentina. No deja bajar un cupo por debajo de lo vendido ni quitar lotes o tipos con entradas.
  - El flyer se sube más adelante (por ahora, el espacio marcado).
- [x] **6b. Productoras** — varias productoras usan la plataforma; cada una ve solo lo suyo.
  - Roles: ADMIN (vos: todo), ORGANIZADOR (sus eventos y números), VALIDADOR (solo la puerta). Panel → "Productoras" (solo ADMIN): crear productora con su organizador, sumar gente, contraseña temporal nueva, desactivar.
  - Cobros: cada productora con su propio Mercado Pago (pasos 11-12); vos cobrás un alquiler fijo por evento, aparte.
  - Flyer: espacios marcados para historia (9:16) y publicación (4:5) con su botón; subir imágenes, más adelante.
  - Revisado con 2 agentes (aislamiento entre productoras).

## Bloque 2 — Página pública
- [x] **7. Página del evento** — flyer, datos y el lote en venta de cada tipo. `/e/<dirección>` (ej.: `/e/evento-de-prueba`); desde el panel, "Ver página ↗".
  - Flyer: por ahora el espacio marcado (las imágenes se suben más adelante).
  - El público ve SOLO el lote en venta (nombre y precio). Nada de cantidades vendidas ni disponibles, y los lotes siguientes no se muestran (ni se mandan al navegador) hasta que se agote el anterior. Si no queda nada: "Agotado".
  - Elegir cantidades con + y − (hasta el máximo por compra) y ver el total. "Continuar" queda deshabilitado hasta la compra (pasos 9-12).
  - Borradores: vista previa solo para el ADMIN y la gente de esa productora; para el resto, 404.
- [x] **8. Lógica de lotes** — paso automático de lote sin vender de más (con tests). Para probarlo: panel → evento → "Probar una compra".
  - Decidido (1a): si alguien pide 4 y en el lote quedan 2, van 2 de ese lote y 2 del siguiente, cada una a su precio.
  - Decidido (2a): las reservas sin pagar ocupan lugar; si vencen, el lote anterior (más barato) vuelve a estar en venta.
  - Compras y ediciones de un mismo evento pasan de a una, en fila ("turno del evento"): nunca se vende de más ni se traba, y editar en plena venta no queda esperando para siempre.
  - Revisado con 19 agentes: 8 hallazgos confirmados y arreglados (un editor duplicado en pantalla al guardar, editar trabado durante una ola de compras, y tests que no probaban lo que decían).
- [x] **9. Formulario de datos (checkout)** — nombre y DNI por entrada. En la página del evento, elegir entradas → "Continuar" (`/e/<dirección>/datos`).
  - Un bloque por entrada ("Entrada 1 · General", "Entrada 2 · VIP"…) con nombre y apellido y DNI de quien la usa; abajo, email (dos veces) y celular (opcional).
  - Decidido: no hay límite por DNI (un mismo DNI puede tener varias entradas).
  - El resumen muestra el reparto real por lote (si el pedido cruza de lote, lo explica). Todavía no reserva ni cobra: al tocar "Continuar al pago" se revisan los datos y listo.
- [ ] **10. Reserva temporal** — 10 minutos para pagar.
  - "Continuar" pasa a reservar (orden PENDIENTE con sus entradas) y el checkout pasa a leer la orden (`/compra/<orden>`) en vez del pedido de la dirección, con el reloj de 10 minutos. Los datos del formulario se guardan en la orden y sus entradas.
  - Crear la orden y sus entradas en la misma transacción que reservarEntradas, y que esa transacción sea corta (nada de llamadas a Mercado Pago adentro). Fijar maxWait/timeout de la transacción y traducir esperoDemasiado() a "Hay mucha gente comprando, probá de nuevo".
  - Liberar vencidas: una orden por transacción. Primero el UPDATE condicionado (PENDIENTE → VENCIDA) y solo si cambió, liberarReservas con las porciones armadas desde las entradas de esa orden (así nunca se libera dos veces).
  - Que nadie acapare el cupo con reservas repetidas (límite por persona o por IP).

## Bloque 3 — Cobrar con Mercado Pago
- [ ] **11. Conectar Mercado Pago (modo prueba)** — Checkout Pro.
  - Cada productora conecta su propio Mercado Pago desde su panel (OAuth): la plata le llega directo.
- [ ] **12. Confirmar el pago (webhook)** — sin entradas dobles.
  - Igual que al liberar: UPDATE condicionado (PENDIENTE → PAGADA) y recién ahí confirmarReservas con las porciones de esa orden; un aviso repetido no hace nada.
  - Pago que llega con la reserva ya vencida: dar las entradas solo si todavía hay lugar en ese lote; si no, devolver la plata.

## Bloque 4 — Entrada, QR y mail
- [ ] **13. Código de cada entrada** — token aleatorio firmado (HMAC).
- [ ] **14. QR y PDF**
- [ ] **15. Enviar el mail** — Gmail SMTP.
  - Con varias productoras, el límite de Gmail (~500 por día) puede quedar corto: evaluar Resend con dominio propio.
- [ ] **16. "Compra confirmada" y "Reenviar mis entradas"**

## Bloque 5 — Puerta
- [ ] **17. Escáner** — cámara del celu, marcar usada de forma atómica.
  - Incluye la pantalla "Validadores" para que cada organizador maneje los suyos (hoy los suma el ADMIN desde Productoras).
- [ ] **18. Búsqueda por DNI y contador**

## Bloque 6 — Admin completo
- [ ] **19. Cortesías** — individual, carga masiva, cupo aparte.
- [ ] **20. Ventas, resumen, exportar y reembolsos**
  - Cada organizador ve las estadísticas de sus eventos; el ADMIN, de todos (y por productora).

## Bloque 7 — Salir a producción
- [ ] **21. Publicarlo en internet** — Vercel + claves reales + compra de prueba real.
