-- V9: sesiones de refresco (tokens de refresco rotatorios) y version de sesion por usuario.
--
-- usuario.version_sesion: cada JWT lleva su valor en el claim "ver" y se rechaza si ya no coincide con el de la BD; subirlo
-- invalida al instante todos los accesos emitidos (cerrar sesion en todas partes). Los usuarios existentes quedan en 0, y un
-- JWT sin claim "ver" cuenta como version 0: los tokens emitidos antes del despliegue siguen valiendo hasta que caduquen.
--
-- sesion_refresco: una fila por token de refresco. Nunca se guarda el token, solo su SHA-256 en hexadecimal. "familia" agrupa
-- los tokens encadenados por rotaciones desde un mismo login: si se reutiliza uno ya rotado, se revoca toda la familia.
--   expira_en          vida deslizante de ESTE token (min(ahora + refresco-dias, familia_expira_en))
--   familia_expira_en  tope absoluto de la familia, fijado en el login (maximo-dias)
--   usado_en           NULL hasta que se rota; revocado_en: NULL salvo revocacion (cierre de sesion o reutilizacion)
--
-- Tabla y columna nuevas: no hace falta comprobacion previa de datos. Sin GRANT propio: la tabla llega con los privilegios
-- por defecto de ops/db-roles.sql (DML para vibora_app, SELECT para vibora_ro). Flyway ejecuta cada migracion en una transaccion.
ALTER TABLE usuario ADD COLUMN version_sesion integer NOT NULL DEFAULT 0;

CREATE TABLE sesion_refresco (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usuario_id        bigint      NOT NULL REFERENCES usuario (id) ON DELETE CASCADE,
    familia           uuid        NOT NULL,
    hash_token        varchar(64) NOT NULL,
    creado_en         timestamptz NOT NULL,
    expira_en         timestamptz NOT NULL,
    familia_expira_en timestamptz NOT NULL,
    usado_en          timestamptz,
    revocado_en       timestamptz,
    CONSTRAINT sesion_refresco_hash_uk UNIQUE (hash_token),
    CONSTRAINT sesion_refresco_hash_ck CHECK (hash_token ~ '^[0-9a-f]{64}$')
);

-- revocar todas las sesiones de una persona / FK
CREATE INDEX sesion_refresco_usuario_idx ON sesion_refresco (usuario_id);
-- revocar una familia entera (reutilizacion o cierre de sesion)
CREATE INDEX sesion_refresco_familia_idx ON sesion_refresco (familia);
-- la purga diaria borra por antiguedad en todos los usuarios: por el tope de la familia (familia_expira_en, no por la
-- caducidad propia: un token rotado debe seguir ahi mientras la familia pueda refrescarse, para detectar su reutilizacion) o
-- por revocacion (revocado_en solo para las filas revocadas, que son pocas); cada rama del OR usa su propio indice y, sin
-- ellos, cada lote recorreria toda la tabla
CREATE INDEX sesion_refresco_familia_expira_en_idx ON sesion_refresco (familia_expira_en);
CREATE INDEX sesion_refresco_revocado_en_idx ON sesion_refresco (revocado_en) WHERE revocado_en IS NOT NULL;
