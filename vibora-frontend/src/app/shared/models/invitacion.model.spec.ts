import {
  ESTADOS_INVITACION,
  EstadoInvitacion,
  ETIQUETA_ESTADO_INVITACION,
  claseEstadoInvitacion,
  textoCaducidad,
} from './invitacion.model';

const AHORA = new Date('2026-07-10T10:00:00Z');
const enMs = (ms: number): string => new Date(AHORA.getTime() + ms).toISOString();
const HORA = 3_600_000;
const DIA = 24 * HORA;

describe('estado de una invitación', () => {
  it('tiene etiqueta en español para los cinco estados', () => {
    expect(ESTADOS_INVITACION).toEqual([
      'PENDIENTE',
      'ACEPTADA',
      'RECHAZADA',
      'CANCELADA',
      'CADUCADA',
    ]);
    expect(ETIQUETA_ESTADO_INVITACION).toEqual({
      PENDIENTE: 'Pendiente',
      ACEPTADA: 'Aceptada',
      RECHAZADA: 'Rechazada',
      CANCELADA: 'Cancelada',
      CADUCADA: 'Caducada',
    });
  });

  it('cada estado tiene una clase de estilo distinta', () => {
    const clases = ESTADOS_INVITACION.map((e: EstadoInvitacion) => claseEstadoInvitacion(e));
    expect(new Set(clases).size).toBe(5);
    expect(clases[0]).toBe('estado-pendiente');
  });
});

describe('textoCaducidad', () => {
  it('días: "caduca en 5 días" y singular', () => {
    expect(textoCaducidad(enMs(5 * DIA + HORA), AHORA)).toBe('caduca en 5 días');
    expect(textoCaducidad(enMs(DIA + HORA), AHORA)).toBe('caduca en 1 día');
  });

  it('menos de un día: horas; menos de una hora: lo dice', () => {
    expect(textoCaducidad(enMs(3 * HORA + 60_000), AHORA)).toBe('caduca en 3 horas');
    expect(textoCaducidad(enMs(HORA + 60_000), AHORA)).toBe('caduca en 1 hora');
    expect(textoCaducidad(enMs(10 * 60_000), AHORA)).toBe('caduca en menos de una hora');
  });

  it('ya pasada: "caducada"', () => {
    expect(textoCaducidad(enMs(-1), AHORA)).toBe('caducada');
  });
});
