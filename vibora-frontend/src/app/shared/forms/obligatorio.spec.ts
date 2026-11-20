import { FormControl } from '@angular/forms';
import { obligatorio } from './obligatorio';

describe('obligatorio', () => {
  it.each([null, undefined, '', ' ', '   ', ' \t\n '])(
    '%j es un valor vacío (error required)',
    (valor) => {
      expect(obligatorio(new FormControl(valor))).toEqual({ required: true });
    },
  );

  it.each(['a', '  Club  ', '0'])('%j es válido', (valor) => {
    expect(obligatorio(new FormControl(valor))).toBeNull();
  });
});
