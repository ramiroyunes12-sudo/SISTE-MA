---
name: cerrar-paso
description: Al terminar una etapa de un paso (borrador, arreglos de la revisión, prueba confirmada por el dueño) o antes de que termine el chat. Deja los documentos al día para que el próximo chat arranque solo con CONTEXTO.md, y sube los cambios.
---
Hacerlo en cada etapa, no solo al final: si el chat se corta, lo hecho tiene que quedar escrito.

1. **Verificar.** Si hubo cambios de código, skill `verificar` completa (0 tests salteados). Si algo falla, no se cierra la etapa: se anota en el traspaso como bloqueado.
2. **`PASOS.md`** (el paso actual): qué se hizo, cómo probarlo ("Para probarlo: panel → ..."), decisiones tomadas ("Decidido: ..."), revisión ("Revisado con N agentes: ...") y "Para más adelante" con el número de paso donde entra. `[x]` solo cuando el dueño confirma que lo probó.
3. **`README.md`**: si cambió algo que se usa o se configura (pantallas, variables, comandos), actualizar su sección.
4. **`PENDIENTES.md`**: sumar acciones manuales del dueño nuevas (variables en Vercel, pruebas, cuentas) y temas sin paso; borrar lo resuelto.
5. **`CONTEXTO.md`**:
   - "Estado actual": qué está hecho, en qué etapa quedó el paso y cuál es el próximo.
   - "Acciones del dueño pendientes": igual a la de `PENDIENTES.md`, solo lo urgente.
   - "Mapa del código": si apareció una carpeta o módulo nuevo.
   - "Traspaso (último chat)": reemplazar por 2-4 líneas: qué se hizo, qué quedó a medias o bloqueado, y la primera tarea del próximo chat.
   - Que siga por debajo de ~150 líneas: lo que es historia va a `BITACORA.md` o `PASOS.md`.
6. **`BITACORA.md`**: una entrada arriba (fecha, paso, qué se hizo, qué quedó). Si el chat ya tiene entrada, actualizarla.
7. **Commit y push.** Mensaje en español: `Paso N (borrador para revisar): ...`, `Paso N: arreglos de la revisión con agentes`, o `Paso N: ...`. Push a la rama del chat. Si no es la rama principal (`claude/ticket-sales-system-2qfswg`), preguntarle al dueño si se lleva a la principal (eso publica en producción y aplica migraciones).
8. **Mensaje final al dueño**, corto:
   - qué probar y dónde (links a https://siste-ma.vercel.app/...);
   - qué tiene que hacer a mano (de `PENDIENTES.md`);
   - la frase para arrancar el próximo chat, por ejemplo: `/empezar-paso 14`.
