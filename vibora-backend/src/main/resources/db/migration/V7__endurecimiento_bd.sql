-- V7: endurecimiento de la base de datos (la BD como ultima linea de defensa) y limpieza de indices.
--
-- Cada restriccion o indice unico nuevo va precedido de una COMPROBACION PREVIA: si la base ya contiene filas que la
-- violarian, la migracion aborta con un mensaje en castellano que dice que arreglar (solo recuentos, nunca emails ni
-- datos personales) en lugar de fallar con un error oscuro a mitad de la migracion. Flyway ejecuta cada migracion en
-- una transaccion: si algo falla no queda nada aplicado.

-- ---------------------------------------------------------------------------------------------------------------------
-- a) Emails: unicos sin distinguir mayusculas ni espacios, y siempre guardados normalizados.
--    La aplicacion ya normaliza (trim + minusculas) antes de guardar y de buscar; esto cierra cualquier otra via de
--    escritura. Se conserva usuario_email_uk (V1).
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n FROM (
        SELECT 1 FROM usuario GROUP BY lower(btrim(email)) HAVING count(*) > 1
    ) g;
    IF n > 0 THEN
        RAISE EXCEPTION 'V7: hay % email(s) duplicados al ignorar mayusculas y espacios en la tabla usuario. Unifica o elimina las cuentas repetidas antes de migrar.', n;
    END IF;

    SELECT count(*) INTO n FROM usuario WHERE email <> lower(btrim(email));
    IF n > 0 THEN
        RAISE EXCEPTION 'V7: hay % usuario(s) cuyo email no esta normalizado (con mayusculas o espacios en los extremos). Actualiza esos emails a minusculas y sin espacios antes de migrar.', n;
    END IF;
END $$;

CREATE UNIQUE INDEX usuario_email_lower_uk ON usuario ((lower(btrim(email))));
ALTER TABLE usuario ADD CONSTRAINT usuario_email_normalizado_ck CHECK (email = lower(btrim(email)));

-- ---------------------------------------------------------------------------------------------------------------------
-- b) Horario del club: el servicio ya lo valida (cierre posterior a apertura); la BD lo garantiza tambien.
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n FROM club WHERE hora_cierre <= hora_apertura;
    IF n > 0 THEN
        RAISE EXCEPTION 'V7: hay % club(es) cuya hora de cierre no es posterior a la de apertura. Corrige el horario de esos clubes antes de migrar.', n;
    END IF;
END $$;

ALTER TABLE club ADD CONSTRAINT club_horario_ck CHECK (hora_cierre > hora_apertura);

-- ---------------------------------------------------------------------------------------------------------------------
-- c) Franjas de tarifa: no pueden solaparse dentro del mismo club y dia. Intervalos semiabiertos [inicio, fin): una
--    franja puede empezar justo donde acaba otra. El servicio ya lo comprueba, pero dos peticiones simultaneas (doble
--    clic) podian colarse las dos; con la restriccion EXCLUDE una de ellas falla.
--    timestamp '2000-01-01' + time es inmutable (requisito de los indices sobre expresiones).
-- ---------------------------------------------------------------------------------------------------------------------
DO $$
DECLARE
    n bigint;
BEGIN
    SELECT count(*) INTO n
    FROM tarifa_franja a
    JOIN tarifa_franja b ON a.club_id = b.club_id AND a.dia_semana = b.dia_semana AND a.id < b.id
    WHERE a.hora_inicio < b.hora_fin AND b.hora_inicio < a.hora_fin;
    IF n > 0 THEN
        RAISE EXCEPTION 'V7: hay % pareja(s) de franjas de tarifa solapadas en el mismo club y dia. Ajusta o elimina las franjas solapadas antes de migrar.', n;
    END IF;
END $$;

ALTER TABLE tarifa_franja ADD CONSTRAINT tarifa_sin_solape
    EXCLUDE USING gist (
        club_id WITH =,
        dia_semana WITH =,
        tsrange(timestamp '2000-01-01' + hora_inicio, timestamp '2000-01-01' + hora_fin) WITH &&
    );

-- ---------------------------------------------------------------------------------------------------------------------
-- d) Indices.
--    Notificaciones. Las consultas reales (NotificacionRepository) son:
--      listado:     where usuario_id = ?                  order by creada_en desc, id desc limit ?
--      sin leer:    where usuario_id = ? and leida = false order by creada_en desc, id desc limit ?
--      contador:    select count(*) where usuario_id = ? and leida = false
--      marcar todo: update ... set leida = true where usuario_id = ? and leida = false
--    El indice de V2 (usuario_id, leida, creada_en DESC) no sirve para el listado completo (no filtra por leida) ni
--    cubre el desempate por id. Se sustituye por:
--      - (usuario_id, creada_en DESC, id DESC): el listado lee ya ordenado y se detiene en el limit.
--      - parcial WHERE NOT leida sobre (usuario_id, creada_en DESC, id DESC): las no leidas son pocas y no crecen con el
--        historial; sirve al listado de no leidas (ya ordenado), al contador (index-only) y al "marcar todas".
--      - (creada_en): la purga de retencion borra por antiguedad en todos los usuarios; sin el indice cada lote
--        recorreria toda la tabla.
--    pista_club_id_idx (V1) es redundante: la restriccion unica (club_id, nombre) ya empieza por club_id.
-- ---------------------------------------------------------------------------------------------------------------------
CREATE INDEX notificacion_usuario_creada_idx ON notificacion (usuario_id, creada_en DESC, id DESC);
CREATE INDEX notificacion_usuario_no_leidas_idx ON notificacion (usuario_id, creada_en DESC, id DESC) WHERE NOT leida;
CREATE INDEX notificacion_creada_en_idx ON notificacion (creada_en);
DROP INDEX notificacion_usuario_leida_idx;
DROP INDEX pista_club_id_idx;
