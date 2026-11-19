import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MiembroPersonal } from '../../shared/models/incidencia.model';

/** Personal de un club. El alta se hace por invitación (`InvitacionService`); la baja la gestiona su administrador. */
@Injectable({ providedIn: 'root' })
export class PersonalService {
  private readonly http = inject(HttpClient);

  /** Administradores del club (primero) y su personal. */
  listar(clubId: number): Observable<MiembroPersonal[]> {
    return this.http.get<MiembroPersonal[]>(`/api/clubes/${clubId}/personal`);
  }

  /**
   * El propio personal (MONITOR/MANTENIMIENTO) deja el club: 204. 409 si es administrador o jugador. Sus incidencias
   * activas quedan sin asignar y debe volver a iniciar sesión (su token sigue diciendo MONITOR/MANTENIMIENTO).
   */
  salir(): Observable<void> {
    return this.http.post<void>('/api/personal/salir', null);
  }

  /**
   * 404 si no es personal de este club; 409 si es administrador. Sus incidencias activas quedan sin asignar y debe
   * volver a iniciar sesión.
   */
  quitar(clubId: number, usuarioId: number): Observable<void> {
    return this.http.delete<void>(`/api/clubes/${clubId}/personal/${usuarioId}`);
  }
}
