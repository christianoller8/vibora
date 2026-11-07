import { inicial, nombrePersona, nombreVisible } from './nombres';

describe('nombreVisible', () => {
  it('une nombre y apellidos', () => {
    expect(nombreVisible('Ana', 'García López')).toBe('Ana García López');
  });

  it('sin apellidos (null, undefined, vacío o espacios) devuelve solo el nombre', () => {
    expect(nombreVisible('Ana', null)).toBe('Ana');
    expect(nombreVisible('Ana', undefined)).toBe('Ana');
    expect(nombreVisible('Ana', '')).toBe('Ana');
    expect(nombreVisible('Ana', '   ')).toBe('Ana');
  });

  it('sin nombre devuelve solo los apellidos, nunca el texto "null"', () => {
    expect(nombreVisible(null, 'García')).toBe('García');
    expect(nombreVisible(undefined, 'García')).toBe('García');
    expect(nombreVisible('  ', 'García')).toBe('García');
  });

  it('sin nada devuelve "Jugador" (o el sustituto indicado)', () => {
    expect(nombreVisible(null, null)).toBe('Jugador');
    expect(nombreVisible(undefined)).toBe('Jugador');
    expect(nombreVisible('', ' ')).toBe('Jugador');
    expect(nombreVisible(null, null, 'Persona')).toBe('Persona');
  });

  it('recorta los espacios sobrantes', () => {
    expect(nombreVisible('  Ana ', ' García ')).toBe('Ana García');
  });
});

describe('nombrePersona', () => {
  it('devuelve el nombre ya compuesto o "Sin nombre" si falta la persona o su nombre', () => {
    expect(nombrePersona({ nombre: 'Ana García' })).toBe('Ana García');
    expect(nombrePersona({ nombre: null })).toBe('Sin nombre');
    expect(nombrePersona({ nombre: '  ' })).toBe('Sin nombre');
    expect(nombrePersona(null)).toBe('Sin nombre');
    expect(nombrePersona(undefined, 'Nadie')).toBe('Nadie');
  });
});

describe('inicial', () => {
  it('devuelve la primera letra en mayúscula del primer candidato con texto', () => {
    expect(inicial('ana')).toBe('A');
    expect(inicial(null, 'García')).toBe('G');
    expect(inicial(undefined, '  ', 'luis')).toBe('L');
  });

  it('respeta los acentos', () => {
    expect(inicial('álvaro')).toBe('Á');
  });

  it('no parte un emoji (par sustituto) por la mitad', () => {
    expect(inicial('😀 Ana')).toBe('😀');
    expect(Array.from(inicial('😀')).length).toBe(1);
  });

  it('sin candidatos útiles devuelve "?"', () => {
    expect(inicial()).toBe('?');
    expect(inicial(null, undefined, '', '   ')).toBe('?');
  });
});
