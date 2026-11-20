import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable, Subject, catchError, map, of, switchMap } from 'rxjs';
import { MetricasService } from '../../../core/api/metricas.service';
import { AuthService } from '../../../core/auth/auth.service';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { hoyEnMadrid } from '../../../core/util/fecha';
import {
  DatosPanel,
  GRANULARIDAD,
  Granularidad,
  RangoMetricas,
} from '../../../shared/models/metricas.model';
import { formatearImporte } from '../../../shared/util/factura';
import { MapaFranjas } from '../mapa-franjas/mapa-franjas';
import { especCancelaciones, especIngresos, especOcupacion, etiquetaPeriodo } from '../mapeo';
import {
  FECHA_MAXIMA,
  FECHA_MINIMA,
  PRESETS,
  Preset,
  PresetFijo,
  diasDelRango,
  granularidadPorDefecto,
  rangoDePreset,
  validarRango,
} from '../rango';
import { TarjetaGrafico } from '../tarjeta-grafico/tarjeta-grafico';
import { TarjetasKpi } from '../tarjetas-kpi/tarjetas-kpi';

interface Solicitud {
  clubId: number;
  rango: RangoMetricas;
  granularidad: Granularidad;
}

type Resultado = { ok: DatosPanel } | { fallo: unknown } | { cancelado: true };

type TipoError = 'permiso' | 'rango' | 'generico';
interface ErrorPanel {
  tipo: TipoError;
  mensaje: string;
}

/**
 * Panel de métricas del administrador del club (su pantalla de inicio): rango (presets o fechas en hora de Madrid),
 * granularidad de las series, cifras, gráficos y mapa de franjas. Los cinco informes se piden en paralelo cada vez
 * que cambia algo, y `switchMap` descarta la respuesta de una petición anterior que llegue tarde.
 */
@Component({
  selector: 'app-panel',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    TarjetasKpi,
    TarjetaGrafico,
    MapaFranjas,
  ],
  templateUrl: './panel.html',
  styleUrl: './panel.scss',
})
export class Panel {
  private readonly auth = inject(AuthService);
  private readonly metricas = inject(MetricasService);

  protected readonly clubId = this.auth.clubId;
  protected readonly clubNombre = this.auth.clubNombre;

  protected readonly presets: readonly { valor: Preset; etiqueta: string }[] = [
    { valor: PRESETS.SIETE, etiqueta: '7 días' },
    { valor: PRESETS.TREINTA, etiqueta: '30 días' },
    { valor: PRESETS.NOVENTA, etiqueta: '90 días' },
    { valor: PRESETS.MES, etiqueta: 'Este mes' },
    { valor: PRESETS.PERSONALIZADO, etiqueta: 'Personalizado' },
  ];
  protected readonly granularidades: readonly { valor: Granularidad; etiqueta: string }[] = [
    { valor: GRANULARIDAD.DIA, etiqueta: 'Día' },
    { valor: GRANULARIDAD.SEMANA, etiqueta: 'Semana' },
    { valor: GRANULARIDAD.MES, etiqueta: 'Mes' },
  ];

  /**
   * El rango inicial se calcula al construir; los presets leen el "hoy" de Madrid al elegirse, así que una pestaña
   * abierta pasada la medianoche no se queda en el día anterior.
   */
  private readonly inicial = rangoDePreset(PRESETS.TREINTA, hoyEnMadrid());
  protected readonly preset = signal<Preset>(PRESETS.TREINTA);
  protected readonly desde = signal(this.inicial.desde);
  protected readonly hasta = signal(this.inicial.hasta);
  /** Granularidad elegida a mano; null = la que corresponde a la longitud del rango. */
  private readonly granularidadManual = signal<Granularidad | null>(null);

  protected readonly fechaMinima = FECHA_MINIMA;
  protected readonly fechaMaxima = FECHA_MAXIMA;

  /** Mensaje si el rango escrito no se puede pedir (entonces no se hace ninguna petición). */
  protected readonly avisoRango = computed(() => validarRango(this.desde(), this.hasta()));
  protected readonly granularidad = computed<Granularidad>(
    () =>
      this.granularidadManual() ??
      (this.avisoRango() === null
        ? granularidadPorDefecto(diasDelRango(this.desde(), this.hasta()))
        : GRANULARIDAD.DIA),
  );

  private readonly solicitud = computed<Solicitud | null>(() => {
    const clubId = this.clubId();
    if (clubId === null || this.avisoRango() !== null) {
      return null;
    }
    return {
      clubId,
      rango: { desde: this.desde(), hasta: this.hasta() },
      granularidad: this.granularidad(),
    };
  });

  protected readonly datos = signal<DatosPanel | null>(null);
  protected readonly cargando = signal(false);
  protected readonly error = signal<ErrorPanel | null>(null);

  protected readonly sinActividad = computed(() => {
    const d = this.datos();
    return (
      d !== null &&
      d.resumen.reservasConfirmadas + d.resumen.reservasCanceladas === 0 &&
      d.resumen.ingresos === 0 &&
      d.resumen.facturado.numeroFacturas === 0
    );
  });
  protected readonly graficoIngresos = computed(() => {
    const d = this.datos();
    return d === null ? null : especIngresos(d.ingresos);
  });
  protected readonly graficoOcupacion = computed(() => {
    const d = this.datos();
    return d === null ? null : especOcupacion(d.ocupacion);
  });
  protected readonly graficoCancelaciones = computed(() => {
    const d = this.datos();
    return d === null ? null : especCancelaciones(d.cancelaciones);
  });

  protected readonly formatearImporte = formatearImporte;
  protected readonly fecha = (iso: string): string => etiquetaPeriodo(iso, GRANULARIDAD.DIA, true);

  /** Cada consulta que hay que hacer (null = ya no hay ninguna válida). `switchMap` descarta la anterior. */
  private readonly cargar$ = new Subject<Solicitud | null>();

  constructor() {
    this.cargar$
      .pipe(
        switchMap((solicitud) => this.consultar(solicitud)),
        takeUntilDestroyed(),
      )
      .subscribe((resultado) => {
        this.cargando.set(false);
        if ('ok' in resultado) {
          this.datos.set(resultado.ok);
          this.error.set(null);
        } else if ('fallo' in resultado) {
          this.datos.set(null); // un error no se mezcla con datos de otro rango
          this.error.set(clasificar(resultado.fallo));
        }
      });

    effect(() => {
      const solicitud = this.solicitud();
      untracked(() => {
        // el error o la carga anteriores ya no corresponden al rango escrito; los datos viejos se conservan
        this.cargando.set(solicitud !== null);
        this.error.set(null);
        this.cargar$.next(solicitud);
      });
    });

    recargarAlRecuperarSesion(
      () => this.error()?.tipo === 'generico',
      () => this.reintentar(),
    );
  }

  protected reintentar(): void {
    const solicitud = this.solicitud();
    if (solicitud !== null) {
      this.cargando.set(true);
      this.error.set(null);
      this.cargar$.next(solicitud);
    }
  }

  protected elegirPreset(valor: Preset): void {
    this.preset.set(valor);
    if (valor === PRESETS.PERSONALIZADO) {
      return; // los campos arrancan con el rango que ya está pedido
    }
    const rango = rangoDePreset(valor as PresetFijo, hoyEnMadrid());
    this.granularidadManual.set(null);
    this.desde.set(rango.desde);
    this.hasta.set(rango.hasta);
  }

  protected cambiarFecha(cual: 'desde' | 'hasta', valor: string): void {
    this.preset.set(PRESETS.PERSONALIZADO);
    this.granularidadManual.set(null);
    (cual === 'desde' ? this.desde : this.hasta).set(valor);
  }

  protected elegirGranularidad(valor: Granularidad): void {
    this.granularidadManual.set(valor);
  }

  private consultar(solicitud: Solicitud | null): Observable<Resultado> {
    if (solicitud === null) {
      return of<Resultado>({ cancelado: true });
    }
    return this.metricas.todo(solicitud.clubId, solicitud.rango, solicitud.granularidad).pipe(
      map((ok): Resultado => ({ ok })),
      catchError((fallo: unknown) => of<Resultado>({ fallo })),
    );
  }
}

function clasificar(fallo: unknown): ErrorPanel {
  const estado = fallo instanceof HttpErrorResponse ? fallo.status : null;
  if (estado === 403) {
    return {
      tipo: 'permiso',
      mensaje: 'No eres administrador de este club, así que no puedes ver sus métricas.',
    };
  }
  if (estado === 400) {
    return {
      tipo: 'rango',
      mensaje: mensajeDeError(fallo, 'El rango elegido no es válido. Prueba con otras fechas.'),
    };
  }
  return {
    tipo: 'generico',
    mensaje: mensajeDeError(fallo, 'No se pudieron cargar las métricas.'),
  };
}
