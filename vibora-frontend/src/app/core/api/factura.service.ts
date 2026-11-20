import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import {
  EmisionFactura,
  Factura,
  FiltroFacturasClub,
  ListadoFacturasClub,
  ReceptorRequest,
} from '../../shared/models/factura.model';

/** Facturas de reservas. Los importes y fechas llegan ya calculados: aquí solo se transporta. */
@Injectable({ providedIn: 'root' })
export class FacturaService {
  private readonly http = inject(HttpClient);

  /** Solo el administrador del club. Los totales son los de TODO el conjunto filtrado, no solo los de la página. */
  delClub(clubId: number, filtro: FiltroFacturasClub): Observable<ListadoFacturasClub> {
    let params = new HttpParams();
    for (const [clave, valor] of Object.entries(filtro)) {
      if (valor !== undefined && valor !== '') {
        params = params.set(clave, String(valor));
      }
    }
    return this.http.get<ListadoFacturasClub>(`/api/clubes/${clubId}/facturas`, { params });
  }

  /** Las facturas de las que soy receptor, las más recientes primero. */
  mias(page = 0, limit?: number): Observable<Factura[]> {
    let params = new HttpParams().set('page', page);
    if (limit !== undefined) {
      params = params.set('limit', limit);
    }
    return this.http.get<Factura[]>('/api/facturas', { params });
  }

  obtener(id: number): Observable<Factura> {
    return this.http.get<Factura>(`/api/facturas/${id}`);
  }

  /** Original y rectificativa (si la hay) de una reserva: el organizador y el administrador de su club. */
  deReserva(reservaId: number): Observable<Factura[]> {
    return this.http.get<Factura[]>(`/api/reservas/${reservaId}/facturas`);
  }

  /**
   * Pide la factura de una reserva (organizador o administrador del club). 201 la primera vez; 200 con la misma factura
   * si ya existía. El receptor es opcional: lo vacío no se envía, y sin nada no se manda cuerpo.
   */
  emitir(reservaId: number, receptor?: ReceptorRequest): Observable<EmisionFactura> {
    const cuerpo = receptorLimpio(receptor);
    return this.http
      .post<Factura>(`/api/reservas/${reservaId}/factura`, cuerpo, { observe: 'response' })
      .pipe(
        map((respuesta: HttpResponse<Factura>) => ({
          factura: respuesta.body as Factura,
          creada: respuesta.status === 201,
        })),
      );
  }

  /** Los bytes exigen el JWT (un enlace no lo puede enviar): se piden con HttpClient como blob. */
  pdf(id: number): Observable<Blob> {
    return this.http.get(`/api/facturas/${id}/pdf`, { responseType: 'blob' });
  }
}

/** Solo los campos con texto, recortados; null si no queda ninguno. */
function receptorLimpio(receptor: ReceptorRequest | undefined): ReceptorRequest | null {
  const limpio: ReceptorRequest = {};
  for (const clave of ['nombre', 'nif', 'direccion'] as const) {
    const valor = receptor?.[clave]?.trim();
    if (valor) {
      limpio[clave] = valor;
    }
  }
  return Object.keys(limpio).length === 0 ? null : limpio;
}
