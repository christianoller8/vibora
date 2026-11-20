import {
  diasDelRango,
  granularidadPorDefecto,
  rangoDePreset,
  sumarDias,
  validarRango,
} from './rango';

describe('sumarDias', () => {
  it('suma y resta días cruzando mes y año', () => {
    expect(sumarDias('2026-11-20', 1)).toBe('2026-11-21');
    expect(sumarDias('2026-12-31', 1)).toBe('2027-01-01');
    expect(sumarDias('2026-03-01', -1)).toBe('2026-02-28');
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29'); // bisiesto
  });
});

describe('diasDelRango', () => {
  it('cuenta ambos extremos', () => {
    expect(diasDelRango('2026-11-20', '2026-11-20')).toBe(1);
    expect(diasDelRango('2026-11-01', '2026-11-30')).toBe(30);
    expect(diasDelRango('2026-12-30', '2027-01-02')).toBe(4);
  });

  it('no se deja engañar por el cambio de hora (octubre de 2026 tiene un domingo de 25 h)', () => {
    expect(diasDelRango('2026-10-24', '2026-10-27')).toBe(4);
  });
});

describe('rangoDePreset', () => {
  const hoy = '2026-11-20';

  it('7, 30 y 90 días terminan hoy e incluyen hoy', () => {
    expect(rangoDePreset('7d', hoy)).toEqual({ desde: '2026-11-14', hasta: hoy });
    expect(rangoDePreset('30d', hoy)).toEqual({ desde: '2026-10-22', hasta: hoy });
    expect(rangoDePreset('90d', hoy)).toEqual({ desde: '2026-08-23', hasta: hoy });
  });

  it.each([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
  ] as const)('%s abarca exactamente %i días', (preset, dias) => {
    const r = rangoDePreset(preset, hoy);
    expect(diasDelRango(r.desde, r.hasta)).toBe(dias);
  });

  it('este mes va del día 1 a hoy', () => {
    expect(rangoDePreset('mes', hoy)).toEqual({ desde: '2026-11-01', hasta: hoy });
    expect(rangoDePreset('mes', '2026-11-01')).toEqual({
      desde: '2026-11-01',
      hasta: '2026-11-01',
    });
  });
});

describe('validarRango', () => {
  it('un rango normal es válido', () => {
    expect(validarRango('2026-11-01', '2026-11-30')).toBeNull();
    expect(validarRango('2026-11-20', '2026-11-20')).toBeNull();
  });

  it('exactamente 366 días vale; 367 no (sin petición)', () => {
    expect(validarRango('2025-11-20', '2026-11-20')).toBeNull(); // 366 días
    expect(validarRango('2025-11-19', '2026-11-20')).toBe('El rango no puede superar los 366 días');
  });

  it('desde posterior a hasta', () => {
    expect(validarRango('2026-11-21', '2026-11-20')).toBe(
      'La fecha inicial no puede ser posterior a la final',
    );
  });

  it.each([
    ['1969-12-31', '2026-11-20'],
    ['2026-01-01', '2101-01-01'],
    ['0002-11-01', '2026-11-20'], // el usuario va tecleando el año cifra a cifra
    ['20260-01-01', '2026-11-20'], // un campo de fecha admite años de más de 4 cifras
  ])('fechas fuera de 1970–2100 (%s → %s)', (desde, hasta) => {
    expect(validarRango(desde, hasta)).toBe('Las fechas deben estar entre 1970 y 2100');
  });

  it('los límites 1970-01-01 y 2100-12-31 son válidos (con un rango corto)', () => {
    expect(validarRango('1970-01-01', '1970-01-31')).toBeNull();
    expect(validarRango('2100-12-01', '2100-12-31')).toBeNull();
  });

  it('un año fuera de rango no se confunde con un rango demasiado largo', () => {
    // 1900 → 2026 son >366 días, pero lo que hay que decir es lo del año
    expect(validarRango('1900-01-01', '2026-11-20')).toBe(
      'Las fechas deben estar entre 1970 y 2100',
    );
  });

  it('falta una fecha o no es una fecha real', () => {
    expect(validarRango('', '2026-11-20')).toBe('Elige la fecha inicial y la final');
    expect(validarRango('2026-11-20', '')).toBe('Elige la fecha inicial y la final');
    expect(validarRango('2026-02-31', '2026-03-05')).toBe('Elige la fecha inicial y la final');
  });
});

describe('granularidadPorDefecto', () => {
  it.each([
    [1, 'DIA'],
    [7, 'DIA'],
    [31, 'DIA'],
    [32, 'SEMANA'],
    [90, 'SEMANA'],
    [120, 'SEMANA'],
    [121, 'MES'],
    [366, 'MES'],
  ] as const)('%i días → %s', (dias, esperada) => {
    expect(granularidadPorDefecto(dias)).toBe(esperada);
  });
});
