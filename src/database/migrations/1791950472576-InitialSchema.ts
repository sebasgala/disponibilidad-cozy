import { MigrationInterface, QueryRunner } from "typeorm";

// Línea base: el esquema tal como lo dejaba synchronize hasta el paso 6 (7 tablas de alojamientos).

export class InitialSchema1791950472576 implements MigrationInterface {
    name = 'InitialSchema1791950472576'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // uuid_generate_v4() viene de esta extensión; antes la creaba synchronize.
        await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
        await queryRunner.query(`CREATE TABLE "ciudades" ("id" SERIAL NOT NULL, "nombre" character varying(120) NOT NULL, "pais" character varying(2) NOT NULL, CONSTRAINT "UQ_b55e77188b8f238c9f31b54ba5d" UNIQUE ("nombre", "pais"), CONSTRAINT "PK_50ef0e3b41f5e7258dfe73840a3" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "alojamientos" ("id" SERIAL NOT NULL, "nombre" character varying(255) NOT NULL, "destino" character varying(255) NOT NULL, "precioPorNoche" numeric(10,2) NOT NULL, "capacidadAdultos" integer NOT NULL, "capacidadNinos" integer NOT NULL, "habitaciones" integer NOT NULL, "tienePiscina" boolean NOT NULL, "descripcion" text, "moneda" character varying(3) NOT NULL DEFAULT 'USD', "ciudadId" integer, "fotos" jsonb, "facilidades" jsonb, "politicas" jsonb, "activo" boolean NOT NULL DEFAULT true, "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_2eef8a78804653e05eee27b6618" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "habitaciones" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "alojamientoId" integer NOT NULL, "nombre" character varying(255) NOT NULL, "tipo" character varying(100) NOT NULL, "capacidadAdultos" integer NOT NULL, "capacidadNinos" integer NOT NULL, "precioBase" numeric(10,2) NOT NULL, "mealPlan" character varying(100), "cancellationType" character varying(100), CONSTRAINT "PK_8c9da53b9b028aa9c4974228948" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."ordenes_status_enum" AS ENUM('PENDING', 'CONFIRMED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "ordenes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "locator" character varying(50) NOT NULL, "status" "public"."ordenes_status_enum" NOT NULL DEFAULT 'PENDING', "alojamientoId" integer NOT NULL, "habitacionId" uuid NOT NULL, "guests" jsonb NOT NULL, "checkin" date, "checkout" date, "customerFirstName" character varying(120) NOT NULL, "customerLastName" character varying(120) NOT NULL, "customerEmail" character varying(255) NOT NULL, "totalPrice" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "paymentReference" character varying(255) NOT NULL, "ownerId" character varying(255), "createdAt" TIMESTAMP NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_e3a1516e13b1a7c08532fc5b167" UNIQUE ("locator"), CONSTRAINT "PK_58713affeb8e3b7b30b9eeeee7a" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3c04fee9a479ae01f2c92f308e" ON "ordenes" ("ownerId") `);
        await queryRunner.query(`CREATE TABLE "ordenes_preview" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "alojamientoId" integer NOT NULL, "habitacionId" uuid NOT NULL, "guests" jsonb NOT NULL, "checkin" date, "checkout" date, "totalPrice" numeric(10,2) NOT NULL, "currency" character varying(3) NOT NULL, "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_3af85d6fe38a0a6b2864ad0f08f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" uuid NOT NULL, "endpoint" character varying(255) NOT NULL, "statusCode" integer NOT NULL, "responseBody" json, "requestHash" character varying(64) NOT NULL, "createdAt" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_0afd83cbf08c9d12089a9bffc5e" PRIMARY KEY ("key"))`);
        await queryRunner.query(`CREATE TABLE "disponibilidad_diaria" ("habitacionId" uuid NOT NULL, "fecha" date NOT NULL, "cupos" integer NOT NULL, "precio" numeric(10,2) NOT NULL, CONSTRAINT "PK_42f7d440dd850922ed4117603db" PRIMARY KEY ("habitacionId", "fecha"))`);
        await queryRunner.query(`ALTER TABLE "alojamientos" ADD CONSTRAINT "FK_ef2188b1c0fd728bab3f673302d" FOREIGN KEY ("ciudadId") REFERENCES "ciudades"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "habitaciones" ADD CONSTRAINT "FK_844662464cce9f18aaaee97b173" FOREIGN KEY ("alojamientoId") REFERENCES "alojamientos"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "FK_3dafdab87a9ee603ec7df3a5beb" FOREIGN KEY ("alojamientoId") REFERENCES "alojamientos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ordenes" ADD CONSTRAINT "FK_2dc69324387a9c17d8589028529" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ordenes_preview" ADD CONSTRAINT "FK_5513e3b057874a54c4fcff75ed6" FOREIGN KEY ("alojamientoId") REFERENCES "alojamientos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "ordenes_preview" ADD CONSTRAINT "FK_f1b5851b6500d608c3a12e071c3" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" ADD CONSTRAINT "FK_f83c9c7d2bac624d897cf615247" FOREIGN KEY ("habitacionId") REFERENCES "habitaciones"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "disponibilidad_diaria" DROP CONSTRAINT "FK_f83c9c7d2bac624d897cf615247"`);
        await queryRunner.query(`ALTER TABLE "ordenes_preview" DROP CONSTRAINT "FK_f1b5851b6500d608c3a12e071c3"`);
        await queryRunner.query(`ALTER TABLE "ordenes_preview" DROP CONSTRAINT "FK_5513e3b057874a54c4fcff75ed6"`);
        await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_2dc69324387a9c17d8589028529"`);
        await queryRunner.query(`ALTER TABLE "ordenes" DROP CONSTRAINT "FK_3dafdab87a9ee603ec7df3a5beb"`);
        await queryRunner.query(`ALTER TABLE "habitaciones" DROP CONSTRAINT "FK_844662464cce9f18aaaee97b173"`);
        await queryRunner.query(`ALTER TABLE "alojamientos" DROP CONSTRAINT "FK_ef2188b1c0fd728bab3f673302d"`);
        await queryRunner.query(`DROP TABLE "disponibilidad_diaria"`);
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP TABLE "ordenes_preview"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3c04fee9a479ae01f2c92f308e"`);
        await queryRunner.query(`DROP TABLE "ordenes"`);
        await queryRunner.query(`DROP TYPE "public"."ordenes_status_enum"`);
        await queryRunner.query(`DROP TABLE "habitaciones"`);
        await queryRunner.query(`DROP TABLE "alojamientos"`);
        await queryRunner.query(`DROP TABLE "ciudades"`);
    }

}
