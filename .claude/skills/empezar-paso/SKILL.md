---
name: empezar-paso
description: Al arrancar un chat para trabajar en un paso del proyecto (o cuando el dueño dice "seguí con el paso N" / "sigamos"). Pone al día la rama, junta solo el contexto necesario y confirma el plan antes de programar.
---
1. **Rama al día.** `git fetch origin claude/ticket-sales-system-2qfswg` y traer la rama principal a la rama del chat (`git merge origin/claude/ticket-sales-system-2qfswg`). Si hay cambios sin commitear o la rama del chat tiene commits que la principal no tiene, avisar antes de seguir.
2. **Contexto mínimo.** `CONTEXTO.md` ya está cargado. Leer solo:
   - el paso en `PASOS.md` (con sus notas y los "Para más adelante" de pasos anteriores que lo nombran: `grep -n "paso N" PASOS.md`);
   - `PENDIENTES.md` (por si una acción del dueño bloquea el paso);
   - la sección del `README.md` y los archivos de `src/` que el paso toca.
   No leer todo el repo ni todo el README.
3. **Lo que bloquea.** Si una acción del dueño en `CONTEXTO.md` todavía está pendiente y el paso depende de ella, decirlo primero. Si el dueño confirma que probó el paso anterior, marcarlo `[x]` en `PASOS.md`.
4. **Decisiones abiertas.** Si el paso tiene decisiones sin tomar (qué ve el público, plata, datos personales, servicios pagos), preguntarle al dueño con 2-4 opciones y una recomendación, antes de programar. Las de código, decidirlas y contarlas después.
5. **Next.js.** Antes de usar APIs de Next que no estén ya en el proyecto, leer la guía en `node_modules/next/dist/docs/` (ver `AGENTS.md`).
6. **Base local para tests.** Prepararla como dice la skill `verificar` (Postgres 16 local, nunca Supabase).
7. **Plan.** Contarle al dueño en 3-6 líneas qué se va a hacer y cómo lo va a poder probar, y arrancar.
