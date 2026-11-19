import { RolPersonal } from './personal.model';

export type EstadoInvitacion = 'PENDIENTE' | 'ACEPTADA' | 'RECHAZADA' | 'CANCELADA' | 'CADUCADA';

export const ESTADOS_INVITACION: readonly EstadoInvitacion[] = [
  'PENDIENTE',
  'ACEPTADA',
  'RECHAZADA',
  'CANCELADA',
  'CADUCADA',
];

export const ETIQUETA_ESTADO_INVITACION: Record<EstadoInvitacion, string> = {
  PENDIENTE: 'Pendiente',
  ACEPTADA: 'Aceptada',
  RECHAZADA: 'Rechazada',
  CANCELADA: 'Cancelada',
  CADUCADA: 'Caducada',
};

/** Clase CSS de la chip de estado (un color propio por estado; el texto sigue siendo la señal principal). */
export function claseEstadoInvitacion(estado: EstadoInvitacion): string {
  return `estado-${estado.toLowerCase()}`;
}

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;

/** "caduca en 5 días", "caduca en 3 horas", "caduca en menos de una hora" o "caducada". */
export function textoCaducidad(caducaEnIso: string, ahora: Date = new Date()): string {
  const falta = new Date(caducaEnIso).getTime() - ahora.getTime();
  if (falta <= 0) {
    return 'caducada';
  }
  if (falta >= DIA_MS) {
    const dias = Math.floor(falta / DIA_MS);
    return `caduca en ${dias} ${dias === 1 ? 'día' : 'días'}`;
  }
  if (falta >= HORA_MS) {
    const horas = Math.floor(falta / HORA_MS);
    return `caduca en ${horas} ${horas === 1 ? 'hora' : 'horas'}`;
  }
  return 'caduca en menos de una hora';
}

export interface InvitacionRequest {
  email: string;
  rol: RolPersonal;
}
export interface MensajeResponse {
  mensaje: string;
}
export interface InvitacionClub {
  id: number;
  email: string;
  rol: RolPersonal;
  estado: EstadoInvitacion;
  creadaEn: string;
  caducaEn: string;
  resueltaEn: string | null;
}
export interface InvitacionMia {
  id: number;
  clubNombre: string;
  rol: RolPersonal;
  invitadoPor: string | null;
  caducaEn: string;
}
export interface InvitacionAceptada {
  requiereNuevoLogin: boolean;
  clubNombre: string;
  rol: RolPersonal;
}
