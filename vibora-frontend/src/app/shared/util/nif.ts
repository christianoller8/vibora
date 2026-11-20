import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Validación del NIF/CIF/NIE español (formato y dígito de control). Es un PORT de `ValidadorNif` del backend
 * (com.vibora.club): las mismas reglas, para avisar antes de enviar. El backend sigue siendo quien manda.
 */

const LETRAS_DNI = 'TRWAGMYFPDXBNJZSQVHLCKE';
const LETRAS_CIF = 'JABCDEFGHI';
const DNI = /^(\d{8})([A-Z])$/;
const NIE = /^([XYZ])(\d{7})([A-Z])$/;
const CIF = /^([ABCDEFGHJKLMNPQRSUVW])(\d{7})([0-9A-J])$/;
/** Entidades cuyo control es SIEMPRE una letra / SIEMPRE una cifra; el resto admite cualquiera de las dos. */
const CONTROL_EN_LETRA = 'KPQRSNW';
const CONTROL_EN_CIFRA = 'ABEH';

/**
 * Sin espacios, guiones ni puntos y en mayúsculas ("12.345.678-z" → "12345678Z"). Solo se quitan los espacios ASCII
 * (como el `\s` de Java en el backend): un espacio duro (NBSP) se conserva y hace inválido el número.
 */
export function normalizarNif(texto: string | null | undefined): string {
  return (texto ?? '').replace(/[ \t\n\x0B\f\r.-]/g, '').toUpperCase();
}

export function esNifValido(texto: string | null | undefined): boolean {
  const nif = normalizarNif(texto);
  if (nif === '') {
    return false;
  }
  const dni = DNI.exec(nif);
  if (dni) {
    return letraDni(Number(dni[1])) === dni[2];
  }
  const nie = NIE.exec(nif);
  if (nie) {
    const prefijo = 'XYZ'.indexOf(nie[1]);
    return letraDni(Number(`${prefijo}${nie[2]}`)) === nie[3];
  }
  const cif = CIF.exec(nif);
  return cif !== null && controlCifCorrecto(cif[1], cif[2], cif[3]);
}

/** Valida el formato si hay algo escrito; un campo vacío no falla (para eso está `Validators.required`). */
export function validadorNif(control: AbstractControl): ValidationErrors | null {
  const valor: unknown = control.value;
  if (typeof valor !== 'string' || valor.trim() === '') {
    return null;
  }
  return esNifValido(valor) ? null : { nif: true };
}

function letraDni(numero: number): string {
  return LETRAS_DNI.charAt(numero % 23);
}

function controlCifCorrecto(entidad: string, cifras: string, control: string): boolean {
  let suma = 0;
  for (let i = 0; i < cifras.length; i++) {
    const cifra = Number(cifras.charAt(i));
    if (i % 2 === 0) {
      // posiciones impares (1, 3, 5, 7): se doblan y se suman sus cifras
      const doble = cifra * 2;
      suma += Math.floor(doble / 10) + (doble % 10);
    } else {
      suma += cifra;
    }
  }
  const digito = (10 - (suma % 10)) % 10;
  const esLetra = control >= 'A' && control <= 'J';
  if (esLetra) {
    return !CONTROL_EN_CIFRA.includes(entidad) && LETRAS_CIF.charAt(digito) === control;
  }
  return !CONTROL_EN_LETRA.includes(entidad) && digito === Number(control);
}
