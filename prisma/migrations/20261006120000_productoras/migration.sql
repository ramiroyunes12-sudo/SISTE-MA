-- Paso 6b: productoras (varios organizadores usando la plataforma).
-- Cada evento es de una productora; organizadores y validadores son de una
-- productora; el ADMIN (dueño de la plataforma) no tiene productora.

-- AlterEnum (el valor nuevo no se usa en esta misma migración)
ALTER TYPE "entradas"."Rol" ADD VALUE 'ORGANIZADOR';

-- CreateTable
CREATE TABLE "entradas"."productoras" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "creada_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizada_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "productoras_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "productoras_nombre_key" ON "entradas"."productoras"("nombre");

-- AlterTable
ALTER TABLE "entradas"."usuarios" ADD COLUMN     "productora_id" UUID;
ALTER TABLE "entradas"."eventos" ADD COLUMN     "productora_id" UUID;

-- ─── Lo que ya existía (todo de prueba) pasa a una "Productora de prueba" ───
INSERT INTO "entradas"."productoras" ("id", "nombre", "actualizada_en")
SELECT gen_random_uuid(), 'Productora de prueba', CURRENT_TIMESTAMP
WHERE EXISTS (SELECT 1 FROM "entradas"."eventos")
   OR EXISTS (SELECT 1 FROM "entradas"."usuarios" WHERE "rol" <> 'ADMIN');

UPDATE "entradas"."eventos"
SET "productora_id" = (SELECT "id" FROM "entradas"."productoras" WHERE "nombre" = 'Productora de prueba')
WHERE "productora_id" IS NULL;

UPDATE "entradas"."usuarios"
SET "productora_id" = (SELECT "id" FROM "entradas"."productoras" WHERE "nombre" = 'Productora de prueba')
WHERE "rol" <> 'ADMIN' AND "productora_id" IS NULL;

ALTER TABLE "entradas"."eventos" ALTER COLUMN "productora_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX "usuarios_productora_id_idx" ON "entradas"."usuarios"("productora_id");
CREATE INDEX "eventos_productora_id_idx" ON "entradas"."eventos"("productora_id");

-- AddForeignKey
ALTER TABLE "entradas"."usuarios" ADD CONSTRAINT "usuarios_productora_id_fkey" FOREIGN KEY ("productora_id") REFERENCES "entradas"."productoras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "entradas"."eventos" ADD CONSTRAINT "eventos_productora_id_fkey" FOREIGN KEY ("productora_id") REFERENCES "entradas"."productoras"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Reglas que la base hace cumplir sola (escritas a mano) ─────────────────

ALTER TABLE "entradas"."productoras" ADD CONSTRAINT "productoras_nombre_valido" CHECK (
  length(btrim("nombre")) BETWEEN 2 AND 80
);

-- El dueño de la plataforma no es de ninguna productora; el resto, de una sí.
ALTER TABLE "entradas"."usuarios" ADD CONSTRAINT "usuarios_productora_segun_rol" CHECK (
  ("rol" = 'ADMIN') = ("productora_id" IS NULL)
);
