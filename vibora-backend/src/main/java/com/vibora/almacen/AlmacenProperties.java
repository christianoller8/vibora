package com.vibora.almacen;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

import java.time.Duration;

/**
 * vibora.almacen.*:
 * <ul>
 * <li>{@code directorio}: carpeta base de los ficheros subidos (se crea al guardar el primero si no existe).</li>
 * <li>{@code decodificacionesSimultaneas}: imagenes que se decodifican/recodifican a la vez (cada una puede ocupar decenas
 * de MB); las demas esperan hasta {@code esperaDecodificacion} y despues reciben un 503.</li>
 * <li>{@code maxMegapixeles}: tope de resolucion, leido de la cabecera antes de decodificar.</li>
 * <li>{@code cuotaDiariaPorUsuario}: fotos que una persona puede subir en una ventana movil de 24 h.</li>
 * <li>{@code limpiezaTmpHoras}: edad minima de los temporales {@code tmp-*} huerfanos para borrarlos.</li>
 * </ul>
 */
@ConfigurationProperties(prefix = "vibora.almacen")
public record AlmacenProperties(
		@DefaultValue("./data/uploads") String directorio,
		@DefaultValue("2") int decodificacionesSimultaneas,
		@DefaultValue("10s") Duration esperaDecodificacion,
		@DefaultValue("16") int maxMegapixeles,
		@DefaultValue("40") int cuotaDiariaPorUsuario,
		@DefaultValue("1") int limpiezaTmpHoras) {
}
