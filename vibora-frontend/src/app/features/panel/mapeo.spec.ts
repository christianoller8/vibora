import {
  CancelacionesMetricas,
  FranjasMetricas,
  IngresosMetricas,
  OcupacionMetricas,
  ResumenMetricas,
} from '../../shared/models/metricas.model';
import {
  NIVELES_CALOR,
  RANGOS_CALOR,
  especCancelaciones,
  especIngresos,
  especOcupacion,
  etiquetaPeriodo,
  formatearFraccion,
  formatearValor,
  franjasRentables,
  mapaFranjas,
  nivelOcupacion,
  tarjetasKpi,
} from './mapeo';

describe('formatearFraccion', () => {
  it('una fracción 0..1 sale como porcentaje con coma y un decimal como máximo', () => {
    expect(formatearFraccion(0.4567)).toBe('45,7 %');
    expect(formatearFraccion(0.5)).toBe('50 %');
    expect(formatearFraccion(1)).toBe('100 %');
    expect(formatearFraccion(0)).toBe('0 %');
  });

  it('null (no calculable) sale como raya, nunca como 0 %', () => {
    expect(formatearFraccion(null)).toBe('—');
  });
});

describe('formatearValor', () => {
  it('euros con miles agrupados, enteros y porcentajes', () => {
    expect(formatearValor(1234.5, 'euros')).toBe('1.234,50 €');
    expect(formatearValor(12345, 'entero')).toBe('12.345');
    expect(formatearValor(0.25, 'porcentaje')).toBe('25 %');
  });

  it('null sale como raya', () => {
    expect(formatearValor(null, 'euros')).toBe('—');
    expect(formatearValor(null, 'porcentaje')).toBe('—');
  });
});

describe('etiquetaPeriodo (calendario puro, sin zonas horarias)', () => {
  it('DIA: "20 nov" corto y "20 nov 2026" largo', () => {
    expect(etiquetaPeriodo('2026-11-20', 'DIA', false)).toBe('20 nov');
    expect(etiquetaPeriodo('2026-11-20', 'DIA', true)).toBe('20 nov 2026');
  });

  it('SEMANA: el periodo es el lunes que la abre', () => {
    expect(etiquetaPeriodo('2026-11-16', 'SEMANA', false)).toBe('16 nov');
    expect(etiquetaPeriodo('2026-11-16', 'SEMANA', true)).toBe('Semana del 16 nov 2026');
  });

  it('MES: "nov 26" corto y "noviembre de 2026" largo', () => {
    expect(etiquetaPeriodo('2026-11-01', 'MES', false)).toBe('nov 26');
    expect(etiquetaPeriodo('2026-11-01', 'MES', true)).toBe('noviembre de 2026');
  });

  it('el cambio de hora no desplaza el día (último domingo de octubre)', () => {
    expect(etiquetaPeriodo('2026-10-25', 'DIA', true)).toBe('25 oct 2026');
    expect(etiquetaPeriodo('2026-03-29', 'DIA', true)).toBe('29 mar 2026');
  });

  it('enero y diciembre', () => {
    expect(etiquetaPeriodo('2027-01-01', 'DIA', false)).toBe('1 ene');
    expect(etiquetaPeriodo('2026-12-31', 'DIA', false)).toBe('31 dic');
  });
});

const INGRESOS: IngresosMetricas = {
  desde: '2026-11-14',
  hasta: '2026-11-16',
  granularidad: 'DIA',
  serie: [
    { periodo: '2026-11-14', ingresos: 120, reservas: 4 },
    { periodo: '2026-11-15', ingresos: 0, reservas: 0 },
    { periodo: '2026-11-16', ingresos: 1234.5, reservas: 9 },
  ],
};

describe('especIngresos', () => {
  it('una serie de columnas con el ingreso de cada periodo y sus etiquetas', () => {
    const espec = especIngresos(INGRESOS)!;
    expect(espec.tipo).toBe('columnas');
    expect(espec.etiquetas).toEqual(['14 nov', '15 nov', '16 nov']);
    expect(espec.series).toHaveLength(1);
    expect(espec.series[0].nombre).toBe('Ingresos');
    expect(espec.series[0].valores).toEqual([120, 0, 1234.5]);
    expect(espec.series[0].formato).toBe('euros');
  });

  it('la tabla lleva EXACTAMENTE los valores del gráfico, formateados, con la etiqueta larga', () => {
    const espec = especIngresos(INGRESOS)!;
    expect(espec.tabla.columnas).toEqual(['Periodo', 'Ingresos']);
    expect(espec.tabla.filas).toEqual([
      ['14 nov 2026', '120,00 €'],
      ['15 nov 2026', '0,00 €'],
      ['16 nov 2026', '1.234,50 €'],
    ]);
  });

  it('la tabla sigue a los datos para cualquier serie (misma posición, mismo valor)', () => {
    const espec = especIngresos(INGRESOS)!;
    espec.series[0].valores.forEach((valor, i) => {
      expect(espec.tabla.filas[i][1]).toBe(formatearValor(valor, 'euros'));
    });
  });

  it('la descripción accesible resume el total, el periodo y el mejor', () => {
    const texto = especIngresos(INGRESOS)!.descripcion;
    expect(texto).toContain('Ingresos por día');
    expect(texto).toContain('1.354,50 €'); // total
    expect(texto).toContain('3 periodos');
    expect(texto).toContain('16 nov 2026'); // el mejor
    expect(texto).toContain('1.234,50 €');
  });

  it('con semanas y meses cambia el sustantivo y las etiquetas', () => {
    const semanas = especIngresos({
      ...INGRESOS,
      granularidad: 'SEMANA',
      serie: [{ periodo: '2026-11-09', ingresos: 10, reservas: 1 }],
    })!;
    expect(semanas.descripcion).toContain('Ingresos por semana');
    expect(semanas.etiquetas).toEqual(['9 nov']);
    const meses = especIngresos({
      ...INGRESOS,
      granularidad: 'MES',
      serie: [{ periodo: '2026-11-01', ingresos: 10, reservas: 1 }],
    })!;
    expect(meses.descripcion).toContain('Ingresos por mes');
  });

  it('sin ingresos ni reservas en todo el rango es "vacío" (null), no un gráfico a cero', () => {
    expect(
      especIngresos({
        ...INGRESOS,
        serie: INGRESOS.serie.map((p) => ({ ...p, ingresos: 0, reservas: 0 })),
      }),
    ).toBeNull();
    expect(especIngresos({ ...INGRESOS, serie: [] })).toBeNull();
  });

  it('periodos con reservas gratis (0 €) no cuentan como vacío', () => {
    expect(
      especIngresos({ ...INGRESOS, serie: [{ periodo: '2026-11-14', ingresos: 0, reservas: 2 }] }),
    ).not.toBeNull();
  });
});

const OCUPACION: OcupacionMetricas = {
  desde: '2026-11-01',
  hasta: '2026-11-30',
  ocupacionGlobal: 0.5,
  ranurasOfrecidas: 200,
  ranurasOcupadas: 100,
  pistas: [
    {
      pistaId: 1,
      pistaNombre: 'Pista 1',
      ranurasOfrecidas: 100,
      ranurasOcupadas: 30,
      ocupacion: 0.3,
      ingresos: 300,
    },
    {
      pistaId: 2,
      pistaNombre: 'Pista 2',
      ranurasOfrecidas: 100,
      ranurasOcupadas: 70,
      ocupacion: 0.7,
      ingresos: 700,
    },
    {
      pistaId: 3,
      pistaNombre: 'Pista 3',
      ranurasOfrecidas: 0,
      ranurasOcupadas: 0,
      ocupacion: null,
      ingresos: 0,
    },
  ],
};

describe('especOcupacion', () => {
  it('barras horizontales ordenadas de más a menos ocupada; sin dato (null) al final', () => {
    const espec = especOcupacion(OCUPACION)!;
    expect(espec.tipo).toBe('barras');
    expect(espec.etiquetas).toEqual(['Pista 2', 'Pista 1', 'Pista 3']);
    expect(espec.series[0].valores).toEqual([0.7, 0.3, null]);
    expect(espec.series[0].formato).toBe('porcentaje');
  });

  it('la tabla lleva los mismos valores y una raya donde no hay dato', () => {
    const espec = especOcupacion(OCUPACION)!;
    expect(espec.tabla.columnas).toEqual(['Pista', 'Ocupación']);
    expect(espec.tabla.filas).toEqual([
      ['Pista 2', '70 %'],
      ['Pista 1', '30 %'],
      ['Pista 3', '—'],
    ]);
  });

  it('la descripción nombra la ocupación global, la más y la menos ocupada', () => {
    const texto = especOcupacion(OCUPACION)!.descripcion;
    expect(texto).toContain('50 %');
    expect(texto).toContain('Pista 2 (70 %)');
    expect(texto).toContain('Pista 1 (30 %)');
  });

  it('un nombre de pista que falta no pinta "null"', () => {
    const espec = especOcupacion({
      ...OCUPACION,
      pistas: [{ ...OCUPACION.pistas[0], pistaNombre: null as unknown as string }],
    })!;
    expect(espec.etiquetas).toEqual(['Pista sin nombre']);
  });

  it('sin ranuras ofrecidas es "vacío" (null)', () => {
    expect(especOcupacion({ ...OCUPACION, ranurasOfrecidas: 0, ranurasOcupadas: 0 })).toBeNull();
    expect(especOcupacion({ ...OCUPACION, pistas: [] })).toBeNull();
  });
});

const CANCELACIONES: CancelacionesMetricas = {
  desde: '2026-11-14',
  hasta: '2026-11-15',
  granularidad: 'DIA',
  serie: [
    { periodo: '2026-11-14', canceladas: 1, confirmadas: 5, tasa: 0.1667 },
    { periodo: '2026-11-15', canceladas: 0, confirmadas: 3, tasa: 0 },
  ],
  porPista: [{ pistaId: 1, pistaNombre: 'Pista 1', canceladas: 1, ingresosPerdidos: 24 }],
};

describe('especCancelaciones', () => {
  it('columnas apiladas: confirmadas y canceladas, en este orden (el color sigue a la serie)', () => {
    const espec = especCancelaciones(CANCELACIONES)!;
    expect(espec.tipo).toBe('columnas-apiladas');
    expect(espec.series.map((s) => s.nombre)).toEqual(['Confirmadas', 'Canceladas']);
    expect(espec.series.map((s) => s.clave)).toEqual(['serie1', 'serie2']);
    expect(espec.series[0].valores).toEqual([5, 3]);
    expect(espec.series[1].valores).toEqual([1, 0]);
    expect(espec.etiquetas).toEqual(['14 nov', '15 nov']);
  });

  it('la tabla lleva los mismos valores', () => {
    const espec = especCancelaciones(CANCELACIONES)!;
    expect(espec.tabla.columnas).toEqual(['Periodo', 'Confirmadas', 'Canceladas']);
    expect(espec.tabla.filas).toEqual([
      ['14 nov 2026', '5', '1'],
      ['15 nov 2026', '3', '0'],
    ]);
  });

  it('la descripción resume totales y tasa', () => {
    const texto = especCancelaciones(CANCELACIONES)!.descripcion;
    expect(texto).toContain('8 confirmadas');
    expect(texto).toContain('1 cancelada');
  });

  it('sin ninguna reserva en el rango es "vacío" (null)', () => {
    expect(
      especCancelaciones({
        ...CANCELACIONES,
        serie: CANCELACIONES.serie.map((p) => ({
          ...p,
          canceladas: 0,
          confirmadas: 0,
          tasa: null,
        })),
      }),
    ).toBeNull();
  });
});

const RESUMEN: ResumenMetricas = {
  desde: '2026-11-01',
  hasta: '2026-11-30',
  ingresos: 1234.5,
  reservasConfirmadas: 40,
  reservasCanceladas: 5,
  tasaCancelacion: 0.1111,
  ticketMedio: 30.86,
  ingresosPerdidosPorCancelacion: 120,
  ocupacionGlobal: 0.452,
  facturado: {
    base: 1000,
    cuotaIva: 210,
    total: 1210,
    numeroFacturas: 12,
    numeroRectificativas: 1,
  },
};

describe('tarjetasKpi', () => {
  const por = (clave: string) => tarjetasKpi(RESUMEN).find((t) => t.clave === clave)!;

  it('muestra solo lo que devuelve el backend', () => {
    expect(tarjetasKpi(RESUMEN).map((t) => t.clave)).toEqual([
      'ingresos',
      'confirmadas',
      'canceladas',
      'tasa',
      'ticket',
      'perdidos',
      'ocupacion',
      'facturado',
    ]);
  });

  it('formatea cada valor', () => {
    expect(por('ingresos').valor).toBe('1.234,50 €');
    expect(por('confirmadas').valor).toBe('40');
    expect(por('canceladas').valor).toBe('5');
    expect(por('tasa').valor).toBe('11,1 %');
    expect(por('ticket').valor).toBe('30,86 €');
    expect(por('perdidos').valor).toBe('120,00 €');
    expect(por('ocupacion').valor).toBe('45,2 %');
    expect(por('facturado').valor).toBe('1.210,00 €');
  });

  it('lo facturado detalla base, IVA y número de facturas', () => {
    const detalle = por('facturado').detalle!;
    expect(detalle).toContain('1.000,00 €');
    expect(detalle).toContain('210,00 €');
    expect(detalle).toContain('12 facturas');
    expect(detalle).toContain('1 rectificativa');
  });

  it('lo no calculable (null) sale como raya, no como 0', () => {
    const vacias = tarjetasKpi({
      ...RESUMEN,
      tasaCancelacion: null,
      ticketMedio: null,
      ocupacionGlobal: null,
    });
    expect(vacias.find((t) => t.clave === 'tasa')!.valor).toBe('—');
    expect(vacias.find((t) => t.clave === 'ticket')!.valor).toBe('—');
    expect(vacias.find((t) => t.clave === 'ocupacion')!.valor).toBe('—');
  });

  it('singular y plural de facturas y rectificativas', () => {
    const uno = tarjetasKpi({
      ...RESUMEN,
      facturado: { ...RESUMEN.facturado, numeroFacturas: 1, numeroRectificativas: 0 },
    }).find((t) => t.clave === 'facturado')!;
    expect(uno.detalle).toContain('1 factura');
    expect(uno.detalle).not.toContain('1 facturas');
    expect(uno.detalle).not.toContain('rectificativa');
  });
});

describe('nivelOcupacion (cubos de la escala del mapa de calor)', () => {
  it('hay cinco niveles', () => {
    expect(NIVELES_CALOR).toBe(5);
  });

  it.each([
    [0, 0],
    [0.1999, 0],
    [0.2, 1],
    [0.3999, 1],
    [0.4, 2],
    [0.5999, 2],
    [0.6, 3],
    [0.7999, 3],
    [0.8, 4],
    [1, 4],
    [1.3, 4], // más de 1 no sale de la escala
  ])('%f → nivel %i', (ocupacion, nivel) => {
    expect(nivelOcupacion(ocupacion)).toBe(nivel);
  });

  it('sin dato (null) no tiene nivel', () => {
    expect(nivelOcupacion(null)).toBeNull();
  });
});

const FRANJAS: FranjasMetricas = {
  desde: '2026-11-01',
  hasta: '2026-11-30',
  limit: 5,
  masRentables: [],
  matriz: [
    {
      diaSemana: 'MONDAY',
      hora: '18:00',
      reservas: 5,
      ingresos: 75,
      ranurasOfrecidas: 8,
      ocupacion: 0.625,
    },
    {
      diaSemana: 'SATURDAY',
      hora: '10:00',
      reservas: 1,
      ingresos: 12.5,
      ranurasOfrecidas: 8,
      ocupacion: 0.125,
    },
    {
      diaSemana: 'MONDAY',
      hora: '09:00',
      reservas: 0,
      ingresos: 0,
      ranurasOfrecidas: 4,
      ocupacion: 0,
    },
  ],
};

describe('franjasRentables', () => {
  const con = (cambios: Partial<FranjasMetricas>): FranjasMetricas => ({ ...FRANJAS, ...cambios });

  it('una fila por franja, en el orden que manda el backend, con día en español y valores formateados', () => {
    const filas = franjasRentables(
      con({
        masRentables: [FRANJAS.matriz[0], FRANJAS.matriz[1]],
      }),
    );
    expect(filas).toEqual([
      { franja: 'lunes 18:00', reservas: '5', ingresos: '75,00 €', ocupacion: '62,5 %' },
      { franja: 'sábado 10:00', reservas: '1', ingresos: '12,50 €', ocupacion: '12,5 %' },
    ]);
  });

  it('sin franjas rentables, lista vacía', () => {
    expect(franjasRentables(con({ masRentables: [] }))).toEqual([]);
  });
});

describe('RANGOS_CALOR (leyenda)', () => {
  it('hay un rango de texto por nivel', () => {
    expect(RANGOS_CALOR).toEqual(['0–20 %', '20–40 %', '40–60 %', '60–80 %', '80–100 %']);
    expect(RANGOS_CALOR).toHaveLength(NIVELES_CALOR);
  });
});

describe('mapaFranjas', () => {
  it('siete columnas de lunes a domingo y las horas con ranuras, de menor a mayor', () => {
    const mapa = mapaFranjas(FRANJAS);
    expect(mapa.dias.map((d) => d.nombre)).toEqual([
      'lunes',
      'martes',
      'miércoles',
      'jueves',
      'viernes',
      'sábado',
      'domingo',
    ]);
    expect(mapa.horas).toEqual(['09:00', '10:00', '18:00']);
    expect(mapa.celdas).toHaveLength(3);
    expect(mapa.celdas.every((fila) => fila.length === 7)).toBe(true);
  });

  it('cada celda lleva su nivel, su texto visible y un texto accesible completo', () => {
    const mapa = mapaFranjas(FRANJAS);
    const lunes18 = mapa.celdas[2][0];
    expect(lunes18.nivel).toBe(3); // 62,5 %
    expect(lunes18.texto).toBe('63 %');
    expect(lunes18.etiqueta).toBe('lunes 18:00: 62,5 % de ocupación, 5 reservas, 75,00 €');
    const sabado10 = mapa.celdas[1][5];
    expect(sabado10.nivel).toBe(0);
    expect(sabado10.etiqueta).toBe('sábado 10:00: 12,5 % de ocupación, 1 reserva, 12,50 €');
  });

  it('una franja con ranuras y cero reservas es 0 %, no "sin ranuras"', () => {
    const lunes9 = mapaFranjas(FRANJAS).celdas[0][0];
    expect(lunes9.vacia).toBe(false);
    expect(lunes9.nivel).toBe(0);
    expect(lunes9.texto).toBe('0 %');
  });

  it('un día y hora sin ranuras ofrecidas es una celda vacía con texto accesible propio', () => {
    const martes9 = mapaFranjas(FRANJAS).celdas[0][1];
    expect(martes9.vacia).toBe(true);
    expect(martes9.nivel).toBeNull();
    expect(martes9.texto).toBe('');
    expect(martes9.etiqueta).toBe('martes 09:00: sin ranuras ofrecidas');
  });

  it('sin matriz no hay horas (el panel pinta el estado vacío)', () => {
    const mapa = mapaFranjas({ ...FRANJAS, matriz: [] });
    expect(mapa.horas).toEqual([]);
    expect(mapa.celdas).toEqual([]);
  });
});
