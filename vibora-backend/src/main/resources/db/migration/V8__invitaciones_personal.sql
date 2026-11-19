-- V8: invitaciones del personal. El administrador de un club INVITA a un correo a ser monitor o personal de
-- mantenimiento; la persona decide (acepta o rechaza). Sustituye al alta directa sin consentimiento.
--
-- Tabla nueva: no hace falta comprobacion previa de datos. Flyway ejecuta cada migracion en una transaccion.
--
-- El email se guarda normalizado exactamente como en el registro (trim + minusculas; ver usuario_email_normalizado_ck en
-- V7). La invitacion se dirige a un CORREO, no a un usuario: puede existir antes de que la persona se registre.
-- estado: PENDIENTE (viva), ACEPTADA, RECHAZADA, CANCELADA (solo por el administrador del club) y CADUCADA.
-- resuelta_en solo existe cuando ya no esta pendiente. usuario_id es quien la acepto o rechazo.
CREATE TABLE invitacion_personal (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    club_id      bigint       NOT NULL REFERENCES club (id),
    email        varchar(255) NOT NULL,
    rol          varchar(20)  NOT NULL,
    estado       varchar(20)  NOT NULL DEFAULT 'PENDIENTE',
    invitado_por bigint       NOT NULL REFERENCES usuario (id),
    creada_en    timestamptz  NOT NULL,
    caduca_en    timestamptz  NOT NULL,
    resuelta_en  timestamptz,
    usuario_id   bigint REFERENCES usuario (id),
    CONSTRAINT invitacion_personal_email_normalizado_ck CHECK (email = lower(btrim(email))),
    CONSTRAINT invitacion_personal_rol_ck CHECK (rol IN ('MONITOR', 'MANTENIMIENTO')),
    CONSTRAINT invitacion_personal_estado_ck CHECK (estado IN ('PENDIENTE', 'ACEPTADA', 'RECHAZADA', 'CANCELADA', 'CADUCADA')),
    CONSTRAINT invitacion_personal_caducidad_ck CHECK (caduca_en > creada_en),
    -- pendiente <=> sin fecha de resolucion
    CONSTRAINT invitacion_personal_resuelta_ck CHECK ((estado = 'PENDIENTE') = (resuelta_en IS NULL))
);

-- Como mucho UNA invitacion viva por club y correo (la garantia ante invitaciones simultaneas).
CREATE UNIQUE INDEX invitacion_personal_pendiente_uk ON invitacion_personal (club_id, email) WHERE estado = 'PENDIENTE';
-- "mis invitaciones" (por correo, solo pendientes)
CREATE INDEX invitacion_personal_email_pendiente_idx ON invitacion_personal (email) WHERE estado = 'PENDIENTE';
-- listado del club (mas recientes primero, filtrable por estado) y recuentos de cuota
CREATE INDEX invitacion_personal_club_estado_idx ON invitacion_personal (club_id, estado, creada_en DESC);
-- FKs hacia usuario: borrar/consultar por persona
CREATE INDEX invitacion_personal_invitado_por_idx ON invitacion_personal (invitado_por);

-- Tipos de notificacion nuevos (se recrea el CHECK por su nombre con TODOS los valores).
ALTER TABLE notificacion DROP CONSTRAINT notificacion_tipo_ck;
ALTER TABLE notificacion ADD CONSTRAINT notificacion_tipo_ck CHECK (tipo IN ('JUGADOR_SE_APUNTO', 'JUGADOR_SALIO',
    'PARTIDO_COMPLETO', 'CARGO_NUEVO', 'PAGO_RECIBIDO', 'RESERVA_CANCELADA',
    'PERSONAL_ANADIDO', 'PERSONAL_QUITADO', 'INCIDENCIA_NUEVA', 'INCIDENCIA_ASIGNADA', 'INCIDENCIA_ESTADO',
    'INCIDENCIA_COMENTARIO', 'FACTURA_RECTIFICATIVA',
    'INVITACION_RECIBIDA', 'INVITACION_ACEPTADA', 'INVITACION_RECHAZADA'));
