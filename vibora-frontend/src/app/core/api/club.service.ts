import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Club, ClubRequest } from '../../shared/models/club.model';
import { DatosFiscales, DatosFiscalesRequest } from '../../shared/models/factura.model';
import { Pista } from '../../shared/models/pista.model';

@Injectable({ providedIn: 'root' })
export class ClubService {
  private readonly http = inject(HttpClient);

  listar(): Observable<Club[]> {
    return this.http.get<Club[]>('/api/clubes');
  }

  obtener(id: number): Observable<Club> {
    return this.http.get<Club>(`/api/clubes/${id}`);
  }

  /**
   * Un jugador sin club crea el suyo y pasa a ser su administrador, pero su token sigue diciendo JUGADOR:
   * hay que volver a iniciar sesión. 409 si ya pertenece a un club.
   */
  crear(datos: ClubRequest): Observable<Club> {
    return this.http.post<Club>('/api/clubes', datos);
  }

  /** Solo el administrador de ese club. */
  actualizar(id: number, datos: ClubRequest): Observable<Club> {
    return this.http.put<Club>(`/api/clubes/${id}`, datos);
  }

  /** El administrador del club ve todas las pistas (también las dadas de baja); el resto, solo las activas. */
  pistas(clubId: number): Observable<Pista[]> {
    return this.http.get<Pista[]>(`/api/clubes/${clubId}/pistas`);
  }

  /** Solo el administrador del club. `configurado` es false hasta que se guardan razón social, NIF y dirección. */
  datosFiscales(clubId: number): Observable<DatosFiscales> {
    return this.http.get<DatosFiscales>(`/api/clubes/${clubId}/datos-fiscales`);
  }

  /** Cambiarlos no altera las facturas ya emitidas: llevan una copia de los datos del momento. */
  actualizarDatosFiscales(clubId: number, datos: DatosFiscalesRequest): Observable<DatosFiscales> {
    return this.http.put<DatosFiscales>(`/api/clubes/${clubId}/datos-fiscales`, datos);
  }
}
