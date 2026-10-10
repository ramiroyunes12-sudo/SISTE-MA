-- Paso 18 (decidido por Ramiro, 10/10/2026).
--
-- busquedas: quién buscó qué (un DNI o un nombre) y cuándo en la puerta de
-- cada evento, y el tope de 5 búsquedas por minuto de cada validador
-- (src/lib/entradas/buscar.ts). Tabla nueva: solo la escribe el código nuevo.
--
-- eventos.max_por_compra: como mucho 4 entradas por compra en cualquier
-- evento. Los que tenían más (todos de prueba) pasan a 4. El CHECK de la base
-- sigue en 1 a 20: bajarlo a 4 va en otro deploy, cuando el código viejo (que
-- deja guardar hasta 20) ya no esté publicado.
CREATE TABLE "entradas"."busquedas" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "busquedas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "busquedas_texto_largo" CHECK (char_length("texto") <= 100)
);

CREATE INDEX "busquedas_usuario_id_creado_en_idx" ON "entradas"."busquedas"("usuario_id", "creado_en");
CREATE INDEX "busquedas_evento_id_creado_en_idx" ON "entradas"."busquedas"("evento_id", "creado_en");

ALTER TABLE "entradas"."busquedas" ADD CONSTRAINT "busquedas_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "entradas"."eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "entradas"."busquedas" ADD CONSTRAINT "busquedas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "entradas"."usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

LOCK TABLE "entradas"."eventos" IN ACCESS EXCLUSIVE MODE;

ALTER TABLE "entradas"."eventos" ALTER COLUMN "max_por_compra" SET DEFAULT 4;

UPDATE "entradas"."eventos" SET "max_por_compra" = 4 WHERE "max_por_compra" > 4;
