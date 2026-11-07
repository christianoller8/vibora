export interface JugadorPartido {
  usuarioId: number;
  /** Opcional al registrarse: el backend lo devuelve tal cual, así que puede ser null. */
  nombre: string | null;
  /** Inicial del apellido en mayúscula ("" si no tiene). Nunca el apellido completo ni el email. */
  inicialApellido: string;
}

export interface Partido {
  reservaId: number;
  club: { id: number; nombre: string };
  pistaNombre: string;
  /** Instantes ISO-8601 (UTC). */
  inicio: string;
  fin: string;
  cuotaPorJugador: number;
  plazasLibres: number;
  jugadores: JugadorPartido[];
  yaApuntado: boolean;
  esOrganizador: boolean;
}

export interface AbiertaRequest {
  abierta: boolean;
}
