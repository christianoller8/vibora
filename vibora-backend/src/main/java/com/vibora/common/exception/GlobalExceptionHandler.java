package com.vibora.common.exception;

import com.vibora.auth.PasswordMaxBytes;
import jakarta.persistence.LockTimeoutException;
import jakarta.persistence.PessimisticLockException;
import lombok.extern.slf4j.Slf4j;
import org.hibernate.exception.JDBCConnectionException;
import org.hibernate.exception.LockAcquisitionException;
import org.springframework.dao.ConcurrencyFailureException;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import java.io.UncheckedIOException;
import java.sql.SQLTransientConnectionException;
import java.time.DateTimeException;
import java.util.Map;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    // 404: el recurso pedido no existe (ej. id inexistente)
    @ExceptionHandler(RecursoNoEncontradoException.class)
    public ResponseEntity<Map<String, String>> noEncontrado(RecursoNoEncontradoException ex) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(Map.of("error", ex.getMessage()));
    }

    // 409: conflicto con el estado actual (ej. email ya registrado)
    @ExceptionHandler(ConflictoException.class)
    public ResponseEntity<Map<String, String>> conflicto(ConflictoException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", ex.getMessage()));
    }

    // 409: bloqueo optimista (@Version): otra persona modifico la misma fila entre la lectura y la escritura
    @ExceptionHandler(OptimisticLockingFailureException.class)
    public ResponseEntity<Map<String, String>> modificadaPorOtraPersona(OptimisticLockingFailureException ex) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(Map.of("error", "La incidencia fue modificada por otra persona, recarga"));
    }

    // 401: credenciales incorrectas (mensaje generico, sin revelar si el email existe)
    @ExceptionHandler(CredencialesInvalidasException.class)
    public ResponseEntity<Map<String, String>> credencialesInvalidas(CredencialesInvalidasException ex) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("error", ex.getMessage()));
    }

    // 400: los datos del @Valid del body no cumplen las anotaciones del DTO
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Map<String, String>> validacion(MethodArgumentNotValidException ex) {
        // Contraseña demasiado larga: el usuario necesita saber por que (el resto de errores se mantienen genericos)
        boolean passwordLarga = ex.getBindingResult().getFieldErrors().stream()
                .anyMatch(e -> "PasswordMaxBytes".equals(e.getCode()));
        return ResponseEntity.badRequest()
                .body(Map.of("error", passwordLarga ? PasswordMaxBytes.MENSAJE : "Datos no válidos"));
    }

    // 400: body ilegible (JSON mal formado, enum desconocido, fecha/hora con formato invalido)
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, String>> cuerpoIlegible(HttpMessageNotReadableException ex) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", "Datos no válidos"));
    }

    // 400: parametro de la URL con un valor imposible (ej. estado=NOPE, fecha=no-es-fecha)
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, String>> parametroInvalido(MethodArgumentTypeMismatchException ex) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", "Datos no válidos"));
    }

    // 400: red de seguridad para una fecha que desborda el calendario al operar con ella (los filtros ya se acotan antes
    // con LimitesFecha); DateTimeParseException es una subclase
    @ExceptionHandler(DateTimeException.class)
    public ResponseEntity<Map<String, String>> fechaInvalida(DateTimeException ex) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", "Datos no válidos"));
    }

    // 413: fichero subido demasiado grande (limite de multipart del contenedor o comprobacion del servicio)
    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, String>> subidaDemasiadoGrande(MaxUploadSizeExceededException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(Map.of("error", "La imagen supera el tamaño máximo de 5 MB"));
    }

    @ExceptionHandler(ArchivoDemasiadoGrandeException.class)
    public ResponseEntity<Map<String, String>> archivoDemasiadoGrande(ArchivoDemasiadoGrandeException ex) {
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE)
                .body(Map.of("error", ex.getMessage()));
    }

    // 500: el almacen de ficheros no pudo guardar (la transaccion se deshace: no queda fila ni fichero a medias)
    @ExceptionHandler(UncheckedIOException.class)
    public ResponseEntity<Map<String, String>> errorDeAlmacen(UncheckedIOException ex) {
        log.error("Error de E/S en el almacén de ficheros", ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(Map.of("error", "No se pudo guardar la imagen; inténtalo de nuevo"));
    }

    // 400: falta la parte "file" o la peticion no es multipart valida
    @ExceptionHandler({ MissingServletRequestPartException.class, MultipartException.class })
    public ResponseEntity<Map<String, String>> subidaInvalida(Exception ex) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", "Datos no válidos"));
    }

    // 400: regla de negocio incumplida (ej. valor duplicado)
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> argumentoInvalido(IllegalArgumentException ex) {
        return ResponseEntity.badRequest()
                .body(Map.of("error", ex.getMessage()));
    }

    // ---- Red de seguridad: lo que ningun servicio traduce. Mensajes genericos; la causa solo va al log del servidor ----

    // 409: la BD rechazo el dato por una restriccion (unicidad, FK...) que ningun servicio habia traducido antes
    @ExceptionHandler({ DataIntegrityViolationException.class, org.hibernate.exception.ConstraintViolationException.class })
    public ResponseEntity<Map<String, String>> integridad(Exception ex) {
        log.warn("Violación de integridad no traducida por el servicio", ex);
        return json(HttpStatus.CONFLICT, CONFLICTO);
    }

    // 409: interbloqueo, bloqueo no obtenido o fallo de serializacion fuera del flujo de reservas (que tiene el suyo).
    // Incluye las excepciones crudas de JPA/Hibernate de los EntityManager usados directamente. El bloqueo OPTIMISTA
    // (OptimisticLockingFailureException, subclase) conserva su propio handler y mensaje.
    @ExceptionHandler({ ConcurrencyFailureException.class, PessimisticLockException.class, LockTimeoutException.class,
            LockAcquisitionException.class })
    public ResponseEntity<Map<String, String>> concurrencia(Exception ex) {
        log.warn("Conflicto de concurrencia no traducido por el servicio", ex);
        return json(HttpStatus.CONFLICT, CONCURRENCIA);
    }

    // 503: base de datos inalcanzable o pool de conexiones agotado
    @ExceptionHandler({ CannotCreateTransactionException.class, DataAccessResourceFailureException.class,
            JDBCConnectionException.class, SQLTransientConnectionException.class })
    public ResponseEntity<Map<String, String>> baseDeDatosNoDisponible(Exception ex) {
        log.error("Base de datos no disponible", ex);
        return json(HttpStatus.SERVICE_UNAVAILABLE, NO_DISPONIBLE);
    }

    // 403 / 401: los servicios lanzan AccessDeniedException; con el catch-all de abajo hay que responderlas aqui con el
    // mismo cuerpo que escriben los handlers de seguridad (SecurityConfig)
    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<Map<String, String>> accesoDenegado(AccessDeniedException ex) {
        return json(HttpStatus.FORBIDDEN, "Acceso denegado");
    }

    @ExceptionHandler(AuthenticationException.class)
    public ResponseEntity<Map<String, String>> noAutenticado(AuthenticationException ex) {
        return json(HttpStatus.UNAUTHORIZED, "No autenticado");
    }

    // El cliente cerro la conexion mientras se respondia: no hay a quien contestar
    @ExceptionHandler(AsyncRequestNotUsableException.class)
    public void clienteDesconectado(AsyncRequestNotUsableException ex) {
        log.debug("El cliente cerró la conexión antes de terminar la respuesta", ex);
    }

    // Ultima red: errores de Spring MVC (ruta o metodo desconocido, tipo de contenido, parametro que falta...) con su
    // codigo de siempre pero cuerpo JSON {"error": ...}, y cualquier otra excepcion como 500 sin exponer su mensaje
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> inesperada(Exception ex) {
        if (ex instanceof ErrorResponse respuesta) {
            return errorDeSpring(respuesta, ex);
        }
        log.error("Error interno no controlado", ex);
        return json(HttpStatus.INTERNAL_SERVER_ERROR, INTERNO);
    }

    private ResponseEntity<Map<String, String>> errorDeSpring(ErrorResponse respuesta, Exception ex) {
        HttpStatusCode estado = respuesta.getStatusCode();
        if (estado.is5xxServerError()) {
            log.error("Error interno de Spring MVC", ex);
            return ResponseEntity.status(estado).headers(respuesta.getHeaders()).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("error", INTERNO));
        }
        String mensaje = switch (estado.value()) {
            case 404 -> "Recurso no encontrado";
            case 405 -> "Método no permitido";
            case 406 -> "Formato de respuesta no aceptable";
            case 415 -> "Tipo de contenido no soportado";
            case 400 -> "Datos no válidos";
            default -> "Petición no válida";
        };
        return ResponseEntity.status(estado).headers(respuesta.getHeaders()).contentType(MediaType.APPLICATION_JSON)
                .body(Map.of("error", mensaje));
    }

    private static ResponseEntity<Map<String, String>> json(HttpStatus estado, String mensaje) {
        return ResponseEntity.status(estado).contentType(MediaType.APPLICATION_JSON).body(Map.of("error", mensaje));
    }

    private static final String CONFLICTO = "Conflicto con los datos existentes";
    private static final String CONCURRENCIA = "La operación no se pudo completar por concurrencia, inténtalo de nuevo";
    private static final String NO_DISPONIBLE = "Servicio no disponible temporalmente";
    private static final String INTERNO = "Error interno";
}
