import { FormControl } from '@angular/forms';
import { esNifValido, normalizarNif, validadorNif } from './nif';

/**
 * Debe coincidir con `ValidadorNif` del backend (com.vibora.club): mismas reglas, mismos casos. Los ejemplos válidos
 * se calcularon a mano con el algoritmo oficial, no con este código.
 */
describe('normalizarNif', () => {
  it('quita espacios, puntos y guiones y pasa a mayúsculas', () => {
    expect(normalizarNif('12.345.678-z')).toBe('12345678Z');
    expect(normalizarNif('  x-1234567 l ')).toBe('X1234567L');
  });

  it('el nulo y el vacío dan cadena vacía', () => {
    expect(normalizarNif(null)).toBe('');
    expect(normalizarNif(undefined)).toBe('');
    expect(normalizarNif('')).toBe('');
  });

  it('no quita un espacio duro (NBSP): el backend tampoco (\\s de Java es solo ASCII)', () => {
    expect(normalizarNif('12345678 Z')).toBe('12345678 Z');
  });
});

describe('esNifValido: DNI', () => {
  it.each(['12345678Z', '00000000T', '87654321X'])('%s es válido', (nif) => {
    expect(esNifValido(nif)).toBe(true);
  });

  it('acepta minúsculas, puntos, guiones y espacios', () => {
    expect(esNifValido('12.345.678-z')).toBe(true);
    expect(esNifValido(' 12345678 z ')).toBe(true);
  });

  it.each(['12345678A', '12345678', '1234567Z', '123456789Z', '12345678ZZ', 'ABCDEFGHZ'])(
    '%s es inválido',
    (nif) => {
      expect(esNifValido(nif)).toBe(false);
    },
  );

  it('la letra de control depende del resto de dividir entre 23', () => {
    // 12345678 % 23 = 14 -> "Z"; cambiar una cifra cambia la letra esperada
    expect(esNifValido('12345679Z')).toBe(false);
    expect(esNifValido('12345679S')).toBe(true);
  });
});

describe('esNifValido: NIE', () => {
  it.each(['X1234567L', 'Y1234567X', 'Z1234567R'])('%s es válido (prefijo X, Y, Z)', (nif) => {
    expect(esNifValido(nif)).toBe(true);
  });

  it.each(['X1234567A', 'W1234567L', 'X123456L', 'Y1234567L', 'X12345678L'])(
    '%s es inválido',
    (nif) => {
      expect(esNifValido(nif)).toBe(false);
    },
  );
});

describe('esNifValido: CIF', () => {
  it.each([
    'A28015865', // entidad A: el control es siempre una cifra
    'B12345674',
    'E12345674',
    'H12345674',
    'K1234567D', // K, P, Q, R, S, N, W: el control es siempre una letra
    'P1234567D',
    'Q1234567D',
    'R1234567D',
    'S1234567D',
    'N1234567D',
    'W1234567D',
    'C12345674', // C, D, F, G, J, U, V: admite cifra o letra
    'C1234567D',
    'G12345674',
    'G1234567D',
    'J00000000',
    'J0000000J',
    'C11111119',
    'C1111111I',
  ])('%s es válido', (cif) => {
    expect(esNifValido(cif)).toBe(true);
  });

  it.each([
    'A2801586E', // A exige cifra, no letra
    'B1234567D',
    'E1234567D',
    'H1234567D',
    'K12345674', // K exige letra, no cifra
    'P12345674',
    'Q12345674',
    'R12345674',
    'S12345674',
    'N12345674',
    'W12345674',
    'C12345675', // cifra de control equivocada
    'C1234567E', // letra de control equivocada
    'I12345674', // la I no es una entidad válida
    'O12345674',
    'T12345674',
    'A1234567',
    'A123456789',
    'C1234567K', // fuera de A-J
  ])('%s es inválido', (cif) => {
    expect(esNifValido(cif)).toBe(false);
  });
});

describe('esNifValido: entradas vacías', () => {
  it('el vacío, el nulo y los solo-separadores no son válidos', () => {
    expect(esNifValido('')).toBe(false);
    expect(esNifValido('   ')).toBe(false);
    expect(esNifValido(null)).toBe(false);
    expect(esNifValido(undefined)).toBe(false);
    expect(esNifValido('. - .')).toBe(false);
  });
});

describe('validadorNif', () => {
  it('un valor vacío no falla (la obligatoriedad es cosa de Validators.required)', () => {
    expect(validadorNif(new FormControl(''))).toBeNull();
    expect(validadorNif(new FormControl(null))).toBeNull();
    expect(validadorNif(new FormControl('   '))).toBeNull();
  });

  it('un NIF válido no falla', () => {
    expect(validadorNif(new FormControl('12345678Z'))).toBeNull();
  });

  it('un NIF inválido falla con el error "nif"', () => {
    expect(validadorNif(new FormControl('12345678A'))).toEqual({ nif: true });
    expect(validadorNif(new FormControl('hola'))).toEqual({ nif: true });
  });
});
