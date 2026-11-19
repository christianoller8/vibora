import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import {
  EstadoInvitacion,
  InvitacionAceptada,
  InvitacionClub,
  InvitacionMia,
  InvitacionRequest,
  MensajeResponse,
} from '../../shared/models/invitacion.model';

/**
 * Invitaciones del personal. Del club (solo su administrador): crear, listar y cancelar. Propias (cualquier usuario
 * autenticado): ver las mías, aceptar y rechazar.
 */
@Injectable({ providedIn: 'root' })
export class InvitacionService {
  private readonly http = inject(HttpClient);

  /**
   * 202 con un mensaje ÚNICO: no depende de si el correo está registrado. 400 correo inválido; 429 límite de invitaciones.
   */
  crear(clubId: number, datos: InvitacionRequest): Observable<MensajeResponse> {
    return this.http.post<MensajeResponse>(`/api/clubes/${clubId}/invitaciones`, datos);
  }

  listar(clubId: number, estado?: EstadoInvitacion): Observable<InvitacionClub[]> {
    const params = estado ? new HttpParams().set('estado', estado) : undefined;
    return this.http.get<InvitacionClub[]>(`/api/clubes/${clubId}/invitaciones`, { params });
  }

  /** 404 si no existe en el club; 409 si ya no está pendiente. */
  cancelar(clubId: number, id: number): Observable<void> {
    return this.http.delete<void>(`/api/clubes/${clubId}/invitaciones/${id}`);
  }

  /** Solo las pendientes y vigentes dirigidas al usuario. */
  mias(): Observable<InvitacionMia[]> {
    return this.http.get<InvitacionMia[]>('/api/invitaciones/mias');
  }

  /** 409 si caducó o ya tiene club; 404 si no es suya o ya no existe. El token actual sigue diciendo JUGADOR. */
  aceptar(id: number): Observable<InvitacionAceptada> {
    return this.http.post<InvitacionAceptada>(`/api/invitaciones/${id}/aceptar`, null);
  }

  rechazar(id: number): Observable<void> {
    return this.http.post<void>(`/api/invitaciones/${id}/rechazar`, null);
  }
}
