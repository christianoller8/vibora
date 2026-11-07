/*
 * El backend devuelve el nombre tal cual: es opcional al registrarse y los apellidos también pueden faltar
 * en algunas respuestas. Estas funciones puras nunca lanzan y nunca pintan "null" ni "undefined".
 */

const limpio = (texto: string | null | undefined): string => (texto ?? '').trim();

/** "Nombre Apellidos" sin huecos ni "null"; si no hay nada, el sustituto ("Jugador" por defecto). */
export function nombreVisible(
  nombre?: string | null,
  apellidos?: string | null,
  sustituto = 'Jugador',
): string {
  const completo = [limpio(nombre), limpio(apellidos)].filter((parte) => parte !== '').join(' ');
  return completo === '' ? sustituto : completo;
}

/** Nombre de una persona de incidencia/bloqueo (`{ nombre }`, ya compuesto por el backend); "Sin nombre" si falta. */
export function nombrePersona(
  persona?: { nombre: string | null } | null,
  sustituto = 'Sin nombre',
): string {
  return nombreVisible(persona?.nombre, null, sustituto);
}

/** Primera letra (en mayúscula) del primer candidato con texto; "?" si ninguno sirve. Respeta emojis y acentos. */
export function inicial(...candidatos: (string | null | undefined)[]): string {
  for (const candidato of candidatos) {
    const texto = limpio(candidato);
    if (texto !== '') {
      return (Array.from(texto)[0] ?? '?').toLocaleUpperCase('es');
    }
  }
  return '?';
}
