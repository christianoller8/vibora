import { rutaInicial } from './inicio';

describe('rutaInicial', () => {
  it('el administrador de un club aterriza en el panel', () => {
    expect(rutaInicial('ADMIN_CLUB')).toBe('/panel');
  });

  it.each(['JUGADOR', 'MONITOR', 'MANTENIMIENTO', null] as const)(
    'el resto (%s) aterriza en la agenda',
    (rol) => {
      expect(rutaInicial(rol)).toBe('/agenda');
    },
  );
});
