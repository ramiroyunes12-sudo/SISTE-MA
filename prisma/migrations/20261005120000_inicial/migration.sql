-- El esquema "entradas" lo crea un administrador antes (ver README):
-- el usuario del sistema no tiene permiso para crear esquemas.

-- CreateEnum
CREATE TYPE "entradas"."Rol" AS ENUM ('ADMIN', 'VALIDADOR');

-- CreateEnum
CREATE TYPE "entradas"."EstadoEvento" AS ENUM ('BORRADOR', 'PUBLICADO', 'FINALIZADO');

-- CreateEnum
CREATE TYPE "entradas"."TipoOrden" AS ENUM ('VENTA', 'CORTESIA');

-- CreateEnum
CREATE TYPE "entradas"."EstadoOrden" AS ENUM ('PENDIENTE', 'PAGADA', 'VENCIDA', 'CANCELADA', 'REEMBOLSADA');

-- CreateEnum
CREATE TYPE "entradas"."EstadoEntrada" AS ENUM ('PENDIENTE', 'VALIDA', 'USADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "entradas"."MetodoIngreso" AS ENUM ('QR', 'DNI');

-- CreateEnum
CREATE TYPE "entradas"."ResultadoEscaneo" AS ENUM ('PASA', 'YA_INGRESO', 'NO_VALIDA');

-- CreateTable
CREATE TABLE "entradas"."usuarios" (
    "id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "hash_contrasena" TEXT NOT NULL,
    "rol" "entradas"."Rol" NOT NULL DEFAULT 'VALIDADOR',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."eventos" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "descripcion" TEXT,
    "fecha" TIMESTAMPTZ(3) NOT NULL,
    "lugar" TEXT NOT NULL,
    "direccion" TEXT,
    "flyer_url" TEXT,
    "max_por_compra" INTEGER NOT NULL DEFAULT 6,
    "cupo_cortesias" INTEGER NOT NULL DEFAULT 0,
    "cortesias_emitidas" INTEGER NOT NULL DEFAULT 0,
    "estado" "entradas"."EstadoEvento" NOT NULL DEFAULT 'BORRADOR',
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."tipos_entrada" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "nombre" TEXT NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tipos_entrada_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."lotes" (
    "id" UUID NOT NULL,
    "tipo_entrada_id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "nombre" TEXT NOT NULL,
    "precio_centavos" INTEGER NOT NULL,
    "cupo" INTEGER NOT NULL,
    "vendidas" INTEGER NOT NULL DEFAULT 0,
    "reservadas" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "lotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."ordenes" (
    "id" UUID NOT NULL,
    "numero" SERIAL NOT NULL,
    "evento_id" UUID NOT NULL,
    "tipo" "entradas"."TipoOrden" NOT NULL DEFAULT 'VENTA',
    "estado" "entradas"."EstadoOrden" NOT NULL DEFAULT 'PENDIENTE',
    "email" TEXT,
    "telefono" TEXT,
    "total_centavos" INTEGER NOT NULL,
    "vence_en" TIMESTAMPTZ(3),
    "pagada_en" TIMESTAMPTZ(3),
    "reembolsada_en" TIMESTAMPTZ(3),
    "mp_preferencia_id" TEXT,
    "emitida_por_id" UUID,
    "mail_enviado_en" TIMESTAMPTZ(3),
    "mail_intentos" INTEGER NOT NULL DEFAULT 0,
    "mail_error" TEXT,
    "reenvios_count" INTEGER NOT NULL DEFAULT 0,
    "reenvios_desde" TIMESTAMPTZ(3),
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ordenes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."pagos" (
    "id" UUID NOT NULL,
    "orden_id" UUID NOT NULL,
    "mp_pago_id" TEXT NOT NULL,
    "estado_mp" TEXT NOT NULL,
    "monto_centavos" INTEGER NOT NULL,
    "reembolsado_centavos" INTEGER NOT NULL DEFAULT 0,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pagos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."entradas" (
    "id" UUID NOT NULL,
    "orden_id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "tipo_entrada_id" UUID NOT NULL,
    "lote_id" UUID,
    "titular" TEXT,
    "dni" TEXT,
    "codigo" TEXT NOT NULL,
    "precio_centavos" INTEGER NOT NULL,
    "estado" "entradas"."EstadoEntrada" NOT NULL DEFAULT 'PENDIENTE',
    "usada_en" TIMESTAMPTZ(3),
    "validada_por_id" UUID,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizado_en" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "entradas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas"."escaneos" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "entrada_id" UUID,
    "usuario_id" UUID NOT NULL,
    "metodo" "entradas"."MetodoIngreso" NOT NULL,
    "resultado" "entradas"."ResultadoEscaneo" NOT NULL,
    "codigo_leido" TEXT,
    "creado_en" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escaneos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "entradas"."usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "eventos_slug_key" ON "entradas"."eventos"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_entrada_evento_id_nombre_key" ON "entradas"."tipos_entrada"("evento_id", "nombre");

-- CreateIndex
CREATE UNIQUE INDEX "tipos_entrada_id_evento_id_key" ON "entradas"."tipos_entrada"("id", "evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_tipo_entrada_id_numero_key" ON "entradas"."lotes"("tipo_entrada_id", "numero");

-- CreateIndex
CREATE UNIQUE INDEX "lotes_id_tipo_entrada_id_key" ON "entradas"."lotes"("id", "tipo_entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_numero_key" ON "entradas"."ordenes"("numero");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_mp_preferencia_id_key" ON "entradas"."ordenes"("mp_preferencia_id");

-- CreateIndex
CREATE INDEX "ordenes_evento_id_estado_idx" ON "entradas"."ordenes"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "ordenes_email_idx" ON "entradas"."ordenes"("email");

-- CreateIndex
CREATE INDEX "ordenes_estado_vence_en_idx" ON "entradas"."ordenes"("estado", "vence_en");

-- CreateIndex
CREATE INDEX "ordenes_estado_mail_enviado_en_idx" ON "entradas"."ordenes"("estado", "mail_enviado_en");

-- CreateIndex
CREATE UNIQUE INDEX "ordenes_id_evento_id_key" ON "entradas"."ordenes"("id", "evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "pagos_mp_pago_id_key" ON "entradas"."pagos"("mp_pago_id");

-- CreateIndex
CREATE INDEX "pagos_orden_id_idx" ON "entradas"."pagos"("orden_id");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_codigo_key" ON "entradas"."entradas"("codigo");

-- CreateIndex
CREATE INDEX "entradas_evento_id_dni_idx" ON "entradas"."entradas"("evento_id", "dni");

-- CreateIndex
CREATE INDEX "entradas_evento_id_estado_idx" ON "entradas"."entradas"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "entradas_orden_id_idx" ON "entradas"."entradas"("orden_id");

-- CreateIndex
CREATE INDEX "escaneos_evento_id_creado_en_idx" ON "entradas"."escaneos"("evento_id", "creado_en");

-- CreateIndex
CREATE INDEX "escaneos_entrada_id_idx" ON "entradas"."escaneos"("entrada_id");

-- AddForeignKey
ALTER TABLE "entradas"."tipos_entrada" ADD CONSTRAINT "tipos_entrada_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "entradas"."eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."lotes" ADD CONSTRAINT "lotes_tipo_entrada_id_fkey" FOREIGN KEY ("tipo_entrada_id") REFERENCES "entradas"."tipos_entrada"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "entradas"."eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_emitida_por_id_fkey" FOREIGN KEY ("emitida_por_id") REFERENCES "entradas"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."pagos" ADD CONSTRAINT "pagos_orden_id_fkey" FOREIGN KEY ("orden_id") REFERENCES "entradas"."ordenes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_orden_id_evento_id_fkey" FOREIGN KEY ("orden_id", "evento_id") REFERENCES "entradas"."ordenes"("id", "evento_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "entradas"."eventos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_tipo_entrada_id_evento_id_fkey" FOREIGN KEY ("tipo_entrada_id", "evento_id") REFERENCES "entradas"."tipos_entrada"("id", "evento_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_lote_id_tipo_entrada_id_fkey" FOREIGN KEY ("lote_id", "tipo_entrada_id") REFERENCES "entradas"."lotes"("id", "tipo_entrada_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_validada_por_id_fkey" FOREIGN KEY ("validada_por_id") REFERENCES "entradas"."usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."escaneos" ADD CONSTRAINT "escaneos_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "entradas"."eventos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."escaneos" ADD CONSTRAINT "escaneos_entrada_id_fkey" FOREIGN KEY ("entrada_id") REFERENCES "entradas"."entradas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "entradas"."escaneos" ADD CONSTRAINT "escaneos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "entradas"."usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ─── Reglas que la base hace cumplir sola (escritas a mano) ─────────────────

-- Lotes: nunca más vendidas + reservadas que el cupo.
ALTER TABLE "entradas"."lotes" ADD CONSTRAINT "lotes_numeros_validos" CHECK (
  "numero" >= 1 AND "cupo" >= 0 AND "precio_centavos" >= 0
  AND "vendidas" >= 0 AND "reservadas" >= 0
  AND "vendidas" + "reservadas" <= "cupo"
);

-- Eventos: tope por compra razonable y cortesías dentro de su cupo.
ALTER TABLE "entradas"."eventos" ADD CONSTRAINT "eventos_numeros_validos" CHECK (
  "max_por_compra" BETWEEN 1 AND 20
  AND "cupo_cortesias" >= 0
  AND "cortesias_emitidas" >= 0
  AND "cortesias_emitidas" <= "cupo_cortesias"
);

-- Órdenes: montos no negativos y email obligatorio desde que se paga.
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_numeros_validos" CHECK (
  "total_centavos" >= 0 AND "mail_intentos" >= 0 AND "reenvios_count" >= 0
);
ALTER TABLE "entradas"."ordenes" ADD CONSTRAINT "ordenes_email_requerido" CHECK (
  "estado" IN ('PENDIENTE', 'VENCIDA', 'CANCELADA') OR "email" IS NOT NULL
);

-- Entradas: precio no negativo y titular + DNI obligatorios desde que se paga.
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_precio_valido" CHECK ("precio_centavos" >= 0);
ALTER TABLE "entradas"."entradas" ADD CONSTRAINT "entradas_datos_requeridos" CHECK (
  "estado" IN ('PENDIENTE', 'ANULADA')
  OR ("titular" IS NOT NULL AND btrim("titular") <> '' AND "dni" IS NOT NULL AND "dni" <> '')
);

-- Pagos: lo devuelto no puede superar lo cobrado.
ALTER TABLE "entradas"."pagos" ADD CONSTRAINT "pagos_montos_validos" CHECK (
  "monto_centavos" >= 0 AND "reembolsado_centavos" BETWEEN 0 AND "monto_centavos"
);

-- ─── Permisos para el administrador de Supabase (panel y conector) ──────────
-- Las tablas son de entradas_app, así que se los da explícitamente.
-- Solo si existe el usuario "postgres" (en otras bases puede no existir).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "entradas" TO postgres;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "entradas" TO postgres;
    ALTER DEFAULT PRIVILEGES IN SCHEMA "entradas" GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO postgres;
    ALTER DEFAULT PRIVILEGES IN SCHEMA "entradas" GRANT USAGE, SELECT ON SEQUENCES TO postgres;
  END IF;
END $$;
