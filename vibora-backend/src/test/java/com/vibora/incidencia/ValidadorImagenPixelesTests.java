package com.vibora.incidencia;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Tope de 16 megapixeles (antes 25): se mira en la cabecera, antes de reservar memoria para decodificar. */
class ValidadorImagenPixelesTests {

	@Test
	void unaImagenDeExactamente16Megapixeles_pasa() {
		var imagen = ValidadorImagen.procesar(Imagenes.jpeg(4000, 4000));

		assertThat(imagen.tipoContenido()).isEqualTo("image/jpeg");
	}

	@Test
	void unaImagenDeUnPixelDeMasPorEncima_seRechazaAntesDeDecodificar_diciendoLaResolucionMaxima() {
		// solo cabecera: si se intentara decodificar daria "formato no permitido", no este mensaje
		assertThatThrownBy(() -> ValidadorImagen.procesar(Imagenes.pngSoloCabecera(4001, 4000)))
				.isInstanceOf(IllegalArgumentException.class)
				.hasMessage("La imagen es demasiado grande (máximo 16 megapíxeles); reduce su resolución");
	}

	@Test
	void elWebpTambienRespetaElTope() {
		assertThatThrownBy(() -> ValidadorImagen.procesar(Imagenes.webpExtendido(5000, 4000)))
				.isInstanceOf(IllegalArgumentException.class).hasMessageContaining("máximo 16 megapíxeles");
	}
}
