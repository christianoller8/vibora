import { TipoNotificacion } from '../../shared/models/notificacion.model';

/** Pantalla a la que cae cualquier tipo que este frontend aún no conoce (p. ej. de un backend más nuevo). */
export const DESTINO_POR_DEFECTO = '/agenda';

/**
 * Pantalla a la que lleva cada tipo de notificación. Siempre devuelve una ruta: el `switch` es exhaustivo en
 * compilación (un tipo nuevo sin mapear no compila) y el `default` cubre en ejecución un tipo desconocido.
 */
export function destinoNotificacion(tipo: TipoNotificacion): string {
  switch (tipo) {
    case 'CARGO_NUEVO':
    case 'PAGO_RECIBIDO':
      return '/deudas';
    case 'JUGADOR_SE_APUNTO':
    case 'JUGADOR_SALIO':
    case 'PARTIDO_COMPLETO':
    case 'RESERVA_CANCELADA':
      return '/mis-reservas';
    // LIMITACIÓN: la notificación no trae el id de la incidencia (solo `reservaId`), así que se lleva al listado.
    // Si el backend añadiera un `incidenciaId` a la notificación, estos cuatro tipos podrían ir a `/incidencias/:id`.
    case 'INCIDENCIA_NUEVA':
    case 'INCIDENCIA_ASIGNADA':
    case 'INCIDENCIA_ESTADO':
    case 'INCIDENCIA_COMENTARIO':
      return '/incidencias';
    // Por ahora no hay pantalla de gestión de personal: la de personal tomará el relevo de este destino.
    case 'PERSONAL_ANADIDO':
    case 'PERSONAL_QUITADO':
      return '/agenda';
    // La rectificativa que se emite al cancelar una reserva facturada aparece en "Mis facturas".
    case 'FACTURA_RECTIFICATIVA':
      return '/facturas';
    case 'INVITACION_RECIBIDA':
      return '/invitaciones';
    // Lo ve el administrador del club; si quien lo abre no lo es, el guard de /club lo devuelve a la agenda.
    case 'INVITACION_ACEPTADA':
    case 'INVITACION_RECHAZADA':
      return '/club';
    default: {
      const _exhaustivo: never = tipo;
      void _exhaustivo;
      return DESTINO_POR_DEFECTO;
    }
  }
}
