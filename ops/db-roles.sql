-- ops/db-roles.sql: roles de base de datos para PRODUCCION (menor privilegio). NO se ejecuta automaticamente.
--
-- Ejecutar UNA VEZ como superusuario (o propietario de la base) contra la base de datos de Víbora, p. ej.:
--     psql -U postgres -d vibora -v ON_ERROR_STOP=1 -f ops/db-roles.sql
-- y despues poner contrasenas (los roles se crean SIN contrasena para no guardar secretos en el repositorio):
--     ALTER ROLE vibora_owner PASSWORD '...';  ALTER ROLE vibora_app PASSWORD '...';  ALTER ROLE vibora_ro PASSWORD '...';
--
-- Es idempotente: se puede repetir (por ejemplo tras anadir tablas) sin efectos secundarios.
--
-- Roles:
--   vibora_owner  Dueno del esquema: lo usa Flyway para migrar (crea y modifica tablas). La aplicacion NO lo usa.
--   vibora_app    La aplicacion en ejecucion: SELECT/INSERT/UPDATE/DELETE y USAGE de secuencias. No es superusuario, no es
--                 dueno de nada, no puede hacer DDL (crear/borrar/alterar tablas ni desactivar triggers) ni TRUNCATE.
--                 En "factura" solo SELECT e INSERT (las facturas son inmutables; ademas lo impone un trigger).
--   vibora_ro     Solo lectura (informes, copias, soporte).
--
-- Base nueva: DOS PASADAS.
--   1) ANTES de la primera migracion: crea roles y extension; Flyway (como vibora_owner) creara las tablas y los
--      privilegios por defecto de abajo daran acceso a vibora_app y vibora_ro automaticamente. En esta pasada todavia no
--      existen "factura" ni "flyway_schema_history", asi que NO se pueden revocar: hasta la pasada 2 la aplicacion tendria
--      UPDATE/DELETE sobre ellas.
--   2) DESPUES de la primera migracion correcta: repetir el script (es idempotente) para aplicar los REVOKE de "factura"
--      y del historial de Flyway. Repetirlo tambien tras cualquier migracion que cree tablas inmutables.
-- Base existente: ejecutarlo una vez; transfiere la propiedad de las tablas a vibora_owner y concede los privilegios.
--
-- Spring (ver README, "Roles de base de datos (produccion)"):
--     SPRING_DATASOURCE_USERNAME=vibora_app   SPRING_DATASOURCE_PASSWORD=...   (la aplicacion)
--     SPRING_FLYWAY_USER=vibora_owner         SPRING_FLYWAY_PASSWORD=...       (las migraciones)

-- V1 hace CREATE EXTENSION IF NOT EXISTS btree_gist: crearla aqui (superusuario) para que la migracion, hecha por un
-- rol sin privilegios, no tenga que crearla.
CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vibora_owner') THEN
        CREATE ROLE vibora_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vibora_app') THEN
        CREATE ROLE vibora_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'vibora_ro') THEN
        CREATE ROLE vibora_ro LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
    END IF;

    -- Conexion a esta base y nada de tablas temporales para la aplicacion (no las usa)
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO vibora_owner, vibora_app, vibora_ro', current_database());
    EXECUTE format('REVOKE TEMPORARY ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT TEMPORARY ON DATABASE %I TO vibora_owner', current_database());
END $$;

-- Esquema public: nadie crea objetos salvo el dueno (PostgreSQL < 15 lo permitia a todos por defecto)
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO vibora_owner;
GRANT USAGE ON SCHEMA public TO vibora_app, vibora_ro;

-- Propiedad: vibora_owner es el dueno de las tablas y funciones de la aplicacion (las secuencias de identidad
-- siguen a su tabla). Solo las que no son suyas ya, y sin tocar lo que pertenece a una extension (btree_gist).
DO $$
DECLARE
    objeto record;
BEGIN
    FOR objeto IN
        SELECT format('ALTER TABLE %I.%I OWNER TO vibora_owner', n.nspname, c.relname) AS sentencia
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND pg_get_userbyid(c.relowner) <> 'vibora_owner'
    LOOP
        EXECUTE objeto.sentencia;
    END LOOP;
    FOR objeto IN
        SELECT format('ALTER FUNCTION %I.%I(%s) OWNER TO vibora_owner', n.nspname, p.proname,
                      pg_get_function_identity_arguments(p.oid)) AS sentencia
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND pg_get_userbyid(p.proowner) <> 'vibora_owner'
          AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
    LOOP
        EXECUTE objeto.sentencia;
    END LOOP;
END $$;

-- Aplicacion: DML en todas las tablas y uso de secuencias; sin TRUNCATE, TRIGGER, REFERENCES ni DDL.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM vibora_app, vibora_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO vibora_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO vibora_app;
-- Solo lectura
GRANT SELECT ON ALL TABLES IN SCHEMA public TO vibora_ro;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO vibora_ro;

-- Facturas inmutables: solo se emiten (INSERT) y se consultan. (factura_serie SI se actualiza: es el contador de numeracion.)
-- El historial de Flyway es asunto del rol de migraciones, no de la aplicacion.
-- (Comprobando que existen: en una base nueva todavia no hay tablas.)
DO $$
BEGIN
    IF to_regclass('public.factura') IS NOT NULL THEN
        REVOKE UPDATE, DELETE ON public.factura FROM vibora_app;
    END IF;
    IF to_regclass('public.flyway_schema_history') IS NOT NULL THEN
        REVOKE ALL ON public.flyway_schema_history FROM vibora_app, vibora_ro;
    END IF;
END $$;

-- Privilegios por defecto: lo que cree vibora_owner en el futuro (migraciones) llega ya concedido.
-- OJO: si una migracion futura crea otra tabla inmutable (como factura), hay que hacer en ella el REVOKE UPDATE, DELETE
-- explicito, porque aqui el valor por defecto da DML completo.
ALTER DEFAULT PRIVILEGES FOR ROLE vibora_owner IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO vibora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibora_owner IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO vibora_app;
ALTER DEFAULT PRIVILEGES FOR ROLE vibora_owner IN SCHEMA public
    GRANT SELECT ON TABLES TO vibora_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE vibora_owner IN SCHEMA public
    GRANT SELECT ON SEQUENCES TO vibora_ro;
