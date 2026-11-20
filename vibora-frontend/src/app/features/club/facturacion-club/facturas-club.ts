import { Component, ElementRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { EMPTY, Observable, Subject, catchError, map, of, switchMap } from 'rxjs';
import { FacturaService } from '../../../core/api/factura.service';
import { recargarAlRecuperarSesion } from '../../../core/auth/recarga-sesion';
import { mensajeDeError } from '../../../core/http/error.util';
import { formatearFechaHora, hoyEnMadrid } from '../../../core/util/fecha';
import {
  Factura,
  FiltroFacturasClub,
  ListadoFacturasClub,
  TipoFactura,
  TotalesFacturas,
} from '../../../shared/models/factura.model';
import {
  descargarPdf,
  esRectificativa,
  formatearImporte,
  formatearPorcentaje,
  numeroDeLaRectificada,
  rangoDelMes,
} from '../../../shared/util/factura';

/** Facturas por página (el backend admite hasta 100). */
const POR_PAGINA = 20;
/** Fechas que acepta el backend (`LimitesFecha`). */
const FECHA_MINIMA = '1970-01-01';
const FECHA_MAXIMA = '2100-12-31';

type FiltroTipo = '' | TipoFactura;

type Resultado = { ok: ListadoFacturasClub } | { fallo: unknown };

/**
 * Facturas del club para su administrador: filtro por fechas (el mes en curso por defecto) y tipo, totales de todo el
 * conjunto filtrado, paginación y descarga del PDF. Las rectificativas llevan importes negativos y restan en los totales.
 */
@Component({
  selector: 'app-facturas-club',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  templateUrl: './facturas-club.html',
  styleUrl: './facturas-club.scss',
})
export class FacturasClub implements OnInit {
  private readonly facturaService = inject(FacturaService);
  private readonly snack = inject(MatSnackBar);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly clubId = input.required<number>();

  protected readonly desdeCtrl = new FormControl('', { nonNullable: true });
  protected readonly hastaCtrl = new FormControl('', { nonNullable: true });
  protected readonly tipoCtrl = new FormControl<FiltroTipo>('', { nonNullable: true });

  protected readonly facturas = signal<Factura[]>([]);
  protected readonly totales = signal<TotalesFacturas | null>(null);
  protected readonly pagina = signal(0);
  protected readonly limite = signal(POR_PAGINA);
  protected readonly cargando = signal(true);
  protected readonly error = signal<string | null>(null);
  /** Aviso de un filtro que no se puede pedir (fechas al revés o fuera de rango): no se llama al servidor. */
  protected readonly avisoFiltro = signal<string | null>(null);
  /** Factura cuyo PDF se está descargando. */
  protected readonly descargando = signal<number | null>(null);

  protected readonly totalPaginas = computed(() => {
    const cantidad = this.totales()?.cantidad ?? 0;
    return Math.max(1, Math.ceil(cantidad / this.limite()));
  });

  protected readonly columnas = [
    'numero',
    'emitida',
    'receptor',
    'concepto',
    'base',
    'iva',
    'cuota',
    'total',
    'acciones',
  ];
  protected readonly fechaMinima = FECHA_MINIMA;
  protected readonly fechaMaxima = FECHA_MAXIMA;
  protected readonly formatearFechaHora = formatearFechaHora;
  protected readonly formatearImporte = formatearImporte;
  protected readonly formatearPorcentaje = formatearPorcentaje;
  protected readonly esRectificativa = esRectificativa;

  /** Emite cada consulta que hay que hacer; `switchMap` descarta la anterior si aún no ha respondido. */
  private readonly cargar$ = new Subject<FiltroFacturasClub | null>();

  constructor() {
    this.cargar$
      .pipe(
        switchMap((filtro) => this.consultar(filtro)),
        takeUntilDestroyed(),
      )
      .subscribe((resultado) => {
        if ('ok' in resultado) {
          this.facturas.set(resultado.ok.facturas);
          this.totales.set(resultado.ok.totales);
          this.limite.set(resultado.ok.limit > 0 ? resultado.ok.limit : POR_PAGINA);
          this.error.set(null);
        } else {
          this.error.set(mensajeDeError(resultado.fallo, 'No se pudieron cargar las facturas.'));
        }
        this.cargando.set(false);
      });

    for (const control of [this.desdeCtrl, this.hastaCtrl, this.tipoCtrl]) {
      control.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => this.filtroCambiado());
    }

    recargarAlRecuperarSesion(
      () => this.error() !== null,
      () => this.pedir(),
    );
  }

  /** `clubId` es un input requerido: no se puede leer en el constructor, solo a partir de ngOnInit. */
  ngOnInit(): void {
    // el mes en curso (Madrid) se resuelve aquí, al pedir por primera vez, no al construir el componente
    const mes = rangoDelMes(hoyEnMadrid());
    this.desdeCtrl.setValue(mes.desde, { emitEvent: false });
    this.hastaCtrl.setValue(mes.hasta, { emitEvent: false });
    this.pedir();
  }

  protected reintentar(): void {
    this.pedir();
  }

  protected irA(pagina: number): void {
    if (pagina < 0 || pagina >= this.totalPaginas() || pagina === this.pagina()) {
      return;
    }
    this.pagina.set(pagina);
    this.pedir();
  }

  protected numeroDeLaOriginal(factura: Factura): string | null {
    return numeroDeLaRectificada(factura, this.facturas());
  }

  /** Lleva la vista a la fila de la factura original (si está en la página mostrada). */
  protected irAOriginal(id: number | null): void {
    const fila = this.host.nativeElement.querySelector<HTMLElement>(`#factura-${id}`);
    fila?.scrollIntoView?.({ block: 'center' });
    fila?.focus();
  }

  protected descargar(factura: Factura): void {
    if (this.descargando() !== null) {
      return;
    }
    this.descargando.set(factura.id);
    this.facturaService.pdf(factura.id).subscribe({
      next: (blob) => {
        this.descargando.set(null);
        descargarPdf(blob, factura.numeroCompleto);
      },
      error: (err: unknown) => {
        this.descargando.set(null);
        this.snack.open(
          mensajeDeError(err, 'No se pudo descargar la factura. Inténtalo de nuevo.'),
          'Cerrar',
          { duration: 6000 },
        );
      },
    });
  }

  protected textoCantidad(cantidad: number): string {
    return cantidad === 1 ? '1 factura' : `${cantidad} facturas`;
  }

  private filtroCambiado(): void {
    this.pagina.set(0);
    this.pedir();
  }

  /** Valida los filtros y, si valen, lanza la consulta de la página actual. */
  private pedir(): void {
    const desde = this.desdeCtrl.value;
    const hasta = this.hastaCtrl.value;
    const aviso = avisoDeFechas(desde, hasta);
    this.avisoFiltro.set(aviso);
    if (aviso !== null) {
      // lo que viajaba ya no corresponde al filtro escrito: se cancela y no se enseña nada del periodo anterior
      this.cargar$.next(null);
      this.cargando.set(false);
      this.error.set(null);
      this.facturas.set([]);
      this.totales.set(null);
      return;
    }
    this.cargando.set(true);
    this.error.set(null);
    this.cargar$.next({
      desde: desde === '' ? undefined : desde,
      hasta: hasta === '' ? undefined : hasta,
      tipo: this.tipoCtrl.value === '' ? undefined : this.tipoCtrl.value,
      page: this.pagina(),
      limit: POR_PAGINA,
    });
  }

  private consultar(filtro: FiltroFacturasClub | null): Observable<Resultado> {
    if (filtro === null) {
      return EMPTY; // filtro inválido: `switchMap` descarta la consulta anterior y no emite nada
    }
    return this.facturaService.delClub(this.clubId(), filtro).pipe(
      map((ok): Resultado => ({ ok })),
      catchError((fallo: unknown) => of<Resultado>({ fallo })),
    );
  }
}

/** Mensaje si el rango no se puede pedir al backend; null si está bien. Las fechas son YYYY-MM-DD ("" = sin límite). */
function avisoDeFechas(desde: string, hasta: string): string | null {
  for (const fecha of [desde, hasta]) {
    // un año de más de 4 cifras (que un campo de fecha admite) tampoco es una fecha que acepte el backend
    const fueraDeRango =
      !/^\d{4}-\d{2}-\d{2}$/.test(fecha) || fecha < FECHA_MINIMA || fecha > FECHA_MAXIMA;
    if (fecha !== '' && fueraDeRango) {
      return 'Las fechas deben estar entre 1970 y 2100';
    }
  }
  if (desde !== '' && hasta !== '' && desde > hasta) {
    return 'La fecha inicial no puede ser posterior a la final';
  }
  return null;
}
