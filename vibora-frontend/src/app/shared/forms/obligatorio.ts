import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Como `Validators.required`, pero un texto de solo espacios también cuenta como vacío (el backend lo recorta y
 * `@NotBlank` lo rechazaría con un 400). Devuelve el error `required` para reutilizar los mismos mensajes.
 */
export function obligatorio(control: AbstractControl): ValidationErrors | null {
  const valor: unknown = control.value;
  const vacio =
    valor === null || valor === undefined || (typeof valor === 'string' && valor.trim() === '');
  return vacio ? { required: true } : null;
}
