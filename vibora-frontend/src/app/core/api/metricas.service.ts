import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, forkJoin } from 'rxjs';
import {
  CancelacionesMetricas,
  DatosPanel,
  FranjasMetricas,
  Granularidad,
  IngresosMetricas,
  OcupacionMetricas,
  RangoMetricas,
  ResumenMetricas,
} from '../../shared/models/metricas.model';

/** Franjas "más rentables" que se piden al backend (máximo 50). */
export const FRANJAS_RENTABLES = 5;

/** Métricas del club: solo su administrador (403 al resto). El rango máximo es de 366 días. */
@Injectable({ providedIn: 'root' })
export class MetricasService {
  private readonly http = inject(HttpClient);

  resumen(clubId: number, rango: RangoMetricas): Observable<ResumenMetricas> {
    return this.http.get<ResumenMetricas>(this.url(clubId, 'resumen'), {
      params: this.params(rango),
    });
  }

  ingresos(
    clubId: number,
    rango: RangoMetricas,
    granularidad: Granularidad,
  ): Observable<IngresosMetricas> {
    return this.http.get<IngresosMetricas>(this.url(clubId, 'ingresos'), {
      params: this.params(rango).set('granularidad', granularidad),
    });
  }

  ocupacion(clubId: number, rango: RangoMetricas): Observable<OcupacionMetricas> {
    return this.http.get<OcupacionMetricas>(this.url(clubId, 'ocupacion'), {
      params: this.params(rango),
    });
  }

  franjas(clubId: number, rango: RangoMetricas, limit: number): Observable<FranjasMetricas> {
    return this.http.get<FranjasMetricas>(this.url(clubId, 'franjas'), {
      params: this.params(rango).set('limit', limit),
    });
  }

  cancelaciones(
    clubId: number,
    rango: RangoMetricas,
    granularidad: Granularidad,
  ): Observable<CancelacionesMetricas> {
    return this.http.get<CancelacionesMetricas>(this.url(clubId, 'cancelaciones'), {
      params: this.params(rango).set('granularidad', granularidad),
    });
  }

  /** Los cinco informes del panel a la vez: emite cuando han llegado todos, o falla en cuanto falla uno. */
  todo(clubId: number, rango: RangoMetricas, granularidad: Granularidad): Observable<DatosPanel> {
    return forkJoin({
      resumen: this.resumen(clubId, rango),
      ingresos: this.ingresos(clubId, rango, granularidad),
      ocupacion: this.ocupacion(clubId, rango),
      franjas: this.franjas(clubId, rango, FRANJAS_RENTABLES),
      cancelaciones: this.cancelaciones(clubId, rango, granularidad),
    });
  }

  private url(clubId: number, informe: string): string {
    return `/api/clubes/${clubId}/metricas/${informe}`;
  }

  private params(rango: RangoMetricas): HttpParams {
    return new HttpParams().set('desde', rango.desde).set('hasta', rango.hasta);
  }
}
