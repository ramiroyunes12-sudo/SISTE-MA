# Pendientes

Lo que **no** está atado a un paso de `PASOS.md`: acciones manuales del dueño y temas sueltos. Lo que sí es de un paso va en las notas de ese paso (no repetirlo acá). Cuando algo se resuelve, se borra de acá y, si vale la pena, se anota en `BITACORA.md`.

## Acciones del dueño (a mano)

| Qué | Por qué | Desde |
|---|---|---|
| Crear una cuenta de Gmail solo para la plataforma, activarle la verificación en 2 pasos y sacar una contraseña de aplicación (myaccount.google.com/apppasswords). En Vercel → siste-ma → Settings → Environment Variables (Production): `SMTP_HOST` = `smtp.gmail.com`, `SMTP_PUERTO` = `465`, `SMTP_USUARIO` = la cuenta, `SMTP_CLAVE` = la contraseña de aplicación, y `CRON_SECRET` = una clave nueva del panel → Claves. Mejor antes del merge del paso 15; si es después, Deployments → ⋯ → Redeploy | Sin eso no sale ningún mail (paso 15); sin `CRON_SECRET`, la tarea diaria que manda los pendientes no hace nada | 9/10/2026 |
| Después de cada evento, vaciar "Enviados" de la cuenta de Gmail de la plataforma | Gmail guarda ahí una copia de cada mail, con los QR, nombres y DNI | 9/10/2026 |
| Cargar el "Mail de contacto" de cada productora (Productoras → la productora → Datos) | A dónde llegan las respuestas al mail con las entradas | 9/10/2026 |
| Probar el paso 15 en producción | Qué probar: `PASOS.md`, paso 15 | 9/10/2026 |

## Temas sin paso asignado

| Qué | Notas |
|---|---|
| Subir imágenes del flyer | Hoy hay espacios marcados para historia (9:16) y publicación (4:5). Decidir dónde se guardan (por ejemplo Supabase Storage) y en qué paso entra. |
| Conectar Mercado Pago con un botón (OAuth) | Hoy el ADMIN pega el Access Token de cada productora. |
| Plan B de transferencias | Que quien compra pegue el código del comprobante ("ID COELSA" = `e2e_id` en Mercado Pago). Probar antes con 2-3 apps de bancos. |
| Limitar intentos de login por IP | Opcional, con el firewall de Vercel (hoy hay bloqueo por cuenta). |
| Índices para 6 claves foráneas | Los sugiere Supabase (entradas.lote/orden/tipo, validada_por, escaneos.usuario, ordenes.emitida_por). Sumarlos en una migración cuando haya datos. |
