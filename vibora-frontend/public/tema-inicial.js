/*
 * Aplica el tema guardado en <html> ANTES del primer pintado (se carga como script bloqueante desde <head>), para que
 * quien eligio el tema claro no vea un destello oscuro. Es un archivo externo y no un script en linea porque la CSP de
 * produccion solo admite scripts de 'self' (y los hashes de los que genera Angular). La clave y los valores son los de
 * core/tema/tema.service.ts; sin eleccion valida se usa el oscuro, nunca el ajuste del sistema operativo.
 */
(function () {
  var tema = 'dark';
  try {
    var guardado = localStorage.getItem('vibora.tema');
    if (guardado === 'light' || guardado === 'dark') {
      tema = guardado;
    }
  } catch (e) {
    // almacenamiento bloqueado: se queda el oscuro
  }
  var raiz = document.documentElement;
  raiz.setAttribute('data-theme', tema);
  raiz.style.colorScheme = tema;
  // El color de la barra del navegador sigue al tema elegido (no al del sistema). Los dos valores viven en el propio
  // meta (data-oscuro / data-claro, que docker/marca.test.mjs contrasta con los tokens de _tema.scss); TemaService
  // lee los mismos, asi que no hay colores repetidos aqui.
  var meta = document.querySelector('meta[name="theme-color"]');
  var color = meta && meta.getAttribute(tema === 'light' ? 'data-claro' : 'data-oscuro');
  if (color) {
    meta.setAttribute('content', color);
  }
})();
