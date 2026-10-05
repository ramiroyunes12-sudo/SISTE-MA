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
- [ ] **6. Pantalla "Evento y lotes"** — crear/editar evento, tipos y lotes.

## Bloque 2 — Página pública
- [ ] **7. Página del evento** — flyer, datos y lotes con su estado.
- [ ] **8. Lógica de lotes** — paso automático de lote sin vender de más (con tests).
- [ ] **9. Formulario de datos (checkout)** — nombre y DNI por entrada.
- [ ] **10. Reserva temporal** — 10 minutos para pagar.

## Bloque 3 — Cobrar con Mercado Pago
- [ ] **11. Conectar Mercado Pago (modo prueba)** — Checkout Pro.
- [ ] **12. Confirmar el pago (webhook)** — sin entradas dobles.

## Bloque 4 — Entrada, QR y mail
- [ ] **13. Código de cada entrada** — token aleatorio firmado (HMAC).
- [ ] **14. QR y PDF**
- [ ] **15. Enviar el mail** — Gmail SMTP.
- [ ] **16. "Compra confirmada" y "Reenviar mis entradas"**

## Bloque 5 — Puerta
- [ ] **17. Escáner** — cámara del celu, marcar usada de forma atómica.
  - Incluye la pantalla "Validadores" del panel: crearlos, desactivarlos y darles contraseña temporal.
- [ ] **18. Búsqueda por DNI y contador**

## Bloque 6 — Admin completo
- [ ] **19. Cortesías** — individual, carga masiva, cupo aparte.
- [ ] **20. Ventas, resumen, exportar y reembolsos**

## Bloque 7 — Salir a producción
- [ ] **21. Publicarlo en internet** — Vercel + claves reales + compra de prueba real.
