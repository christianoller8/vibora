/** Campos que Angular marca con `ng-invalid` (los contenedores, como mat-form-field, también la llevan: se filtra por etiqueta). */
const CAMPOS_INVALIDOS = 'input.ng-invalid, select.ng-invalid, textarea.ng-invalid';

/** Mueve el foco al primer campo inválido (orden de documento). Devuelve false si no hay ninguno. */
export function enfocarPrimerInvalido(raiz: ParentNode): boolean {
  const campo = raiz.querySelector<HTMLElement>(CAMPOS_INVALIDOS);
  campo?.focus();
  return campo !== null;
}
