-- Paso 19: cortesías (decidido por Ramiro, 10/10/2026).
--
-- El email de una cortesía es opcional: sin email, el organizador baja el
-- PDF desde el panel y se lo pasa a la persona. La regla "email obligatorio
-- desde que se paga" queda solo para las ventas. Es aflojar la regla: el
-- código viejo la cumple igual.
--
-- Y una cortesía siempre es gratis (total 0). El código viejo no crea
-- cortesías, así que ninguna fila la rompe.
LOCK TABLE "entradas"."ordenes" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "entradas"."ordenes" DROP CONSTRAINT "ordenes_email_requerido";
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_email_requerido" CHECK (
  "tipo" = 'CORTESIA' OR "estado" IN ('PENDIENTE', 'VENCIDA', 'CANCELADA') OR "email" IS NOT NULL
);

ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_cortesia_gratis" CHECK (
  "tipo" <> 'CORTESIA' OR "total_centavos" = 0
);
