import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { InvitacionMia } from '../../shared/models/invitacion.model';
import { Notificacion, TipoNotificacion } from '../../shared/models/notificacion.model';
import { crearAuthFalso } from '../../testing/test-utils';
import { InvitacionService } from '../api/invitacion.service';
import { AuthService } from '../auth/auth.service';
import { NotificacionesStore } from '../notificaciones/notificaciones.store';
import { InvitacionesStore } from './invitaciones.store';

const mia = (id: number, club = 'Club Norte'): InvitacionMia => ({
  id,
  clubNombre: club,
  rol: 'MONITOR',
  invitadoPor: 'Marta Ruiz',
  caducaEn: '2026-07-15T10:00:00Z',
});

const push = (tipo: TipoNotificacion): Notificacion => ({
  id: 1,
  tipo,
  mensaje: 'x',
  reservaId: null,
  leida: false,
  creadaEn: '2026-07-10T10:00:00Z',
});

describe('InvitacionesStore', () => {
  const servicio = { mias: vi.fn() };
  let auth: ReturnType<typeof crearAuthFalso>;
  let recibidas: Subject<Notificacion>;

  function crear(conSesion = true): InvitacionesStore {
    auth = crearAuthFalso(conSesion ? undefined : null);
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: InvitacionService, useValue: servicio },
        { provide: NotificacionesStore, useValue: { recibidas$: recibidas.asObservable() } },
      ],
    });
    const store = TestBed.inject(InvitacionesStore);
    TestBed.tick(); // ejecuta los efectos que reaccionan a la sesión
    return store;
  }

  beforeEach(() => {
    vi.resetAllMocks();
    recibidas = new Subject<Notificacion>();
    servicio.mias.mockReturnValue(of([mia(1), mia(2)]));
  });

  it('sin sesión no pide nada y está vacío', () => {
    const store = crear(false);

    expect(servicio.mias).not.toHaveBeenCalled();
    expect(store.items()).toEqual([]);
    expect(store.pendientes()).toBe(0);
  });

  it('al haber sesión carga mis invitaciones y cuenta las pendientes', () => {
    const store = crear();

    expect(servicio.mias).toHaveBeenCalledTimes(1);
    expect(store.items()).toHaveLength(2);
    expect(store.pendientes()).toBe(2);
    expect(store.cargando()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('carga cuando la sesión empieza después de crear el store', () => {
    const store = crear(false);

    auth.token.set('otro-jwt');
    TestBed.tick();

    expect(store.pendientes()).toBe(2);
  });

  it('un push INVITACION_RECIBIDA vuelve a pedir la lista y sube el contador', () => {
    const store = crear();
    servicio.mias.mockReturnValue(of([mia(1), mia(2), mia(3)]));

    recibidas.next(push('INVITACION_RECIBIDA'));

    expect(servicio.mias).toHaveBeenCalledTimes(2);
    expect(store.pendientes()).toBe(3);
  });

  it('el refresco por push es silencioso: sin estado de carga', () => {
    const store = crear();
    servicio.mias.mockReturnValue(new Subject<InvitacionMia[]>());

    recibidas.next(push('INVITACION_RECIBIDA'));

    expect(store.cargando()).toBe(false);
  });

  it('otros tipos de notificación no recargan', () => {
    crear();

    recibidas.next(push('INVITACION_ACEPTADA'));
    recibidas.next(push('CARGO_NUEVO'));

    expect(servicio.mias).toHaveBeenCalledTimes(1);
  });

  it('retirar quita una invitación de la lista y baja el contador', () => {
    const store = crear();

    store.retirar(1);

    expect(store.items().map((i) => i.id)).toEqual([2]);
    expect(store.pendientes()).toBe(1);
  });

  it('al cerrar sesión se vacía', () => {
    const store = crear();

    auth.token.set(null);
    TestBed.tick();

    expect(store.items()).toEqual([]);
    expect(store.pendientes()).toBe(0);
  });

  it('la respuesta de una sesión anterior no se aplica tras cerrar sesión', () => {
    const lenta = new Subject<InvitacionMia[]>();
    servicio.mias.mockReturnValue(lenta);
    const store = crear();

    auth.token.set(null);
    TestBed.tick();
    lenta.next([mia(9)]);

    expect(store.items()).toEqual([]);
  });

  it('con el backend inaccesible no lanza: guarda el motivo y sigue vacío', () => {
    servicio.mias.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 0 })));

    const store = crear();

    expect(store.items()).toEqual([]);
    expect(store.pendientes()).toBe(0);
    expect(store.error()).toContain('No se pudo conectar');
    expect(store.cargando()).toBe(false);
  });

  it('un refresco silencioso que falla conserva lo que había y no marca error', () => {
    const store = crear();
    servicio.mias.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    recibidas.next(push('INVITACION_RECIBIDA'));

    expect(store.items()).toHaveLength(2);
    expect(store.error()).toBeNull();
  });

  it('recargar() con spinner marca la carga y, si falla, el error; luego se recupera', () => {
    const store = crear();
    servicio.mias.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

    store.recargar();
    expect(store.error()).toContain('No se pudieron cargar');

    servicio.mias.mockReturnValue(of([mia(7)]));
    store.recargar();
    expect(store.error()).toBeNull();
    expect(store.items().map((i) => i.id)).toEqual([7]);
  });

  describe('peticiones solapadas', () => {
    const fallo = (): HttpErrorResponse => new HttpErrorResponse({ status: 500 });

    it('una respuesta vieja que llega la última no pisa a la más nueva', () => {
      const vieja = new Subject<InvitacionMia[]>();
      const nueva = new Subject<InvitacionMia[]>();
      servicio.mias.mockReturnValueOnce(vieja).mockReturnValueOnce(nueva);
      const store = crear();

      store.recargar(true);
      nueva.next([mia(2)]);
      vieja.next([mia(1)]);

      expect(store.items().map((i) => i.id)).toEqual([2]);
    });

    it('un error viejo que llega después de una respuesta nueva no la marca como error', () => {
      const vieja = new Subject<InvitacionMia[]>();
      const nueva = new Subject<InvitacionMia[]>();
      servicio.mias.mockReturnValueOnce(vieja).mockReturnValueOnce(nueva);
      const store = crear();

      store.recargar(true);
      nueva.next([mia(2)]);
      vieja.error(fallo());

      expect(store.error()).toBeNull();
      expect(store.items().map((i) => i.id)).toEqual([2]);
      expect(store.cargando()).toBe(false);
    });

    it('un fallo silencioso de una petición vieja no apaga la carga visible más nueva', () => {
      const silenciosa = new Subject<InvitacionMia[]>();
      const visible = new Subject<InvitacionMia[]>();
      servicio.mias
        .mockReturnValueOnce(of([mia(1)]))
        .mockReturnValueOnce(silenciosa)
        .mockReturnValueOnce(visible);
      const store = crear();
      store.recargar(true);
      store.recargar();

      silenciosa.error(fallo());
      expect(store.cargando()).toBe(true);
      visible.next([mia(5)]);

      expect(store.cargando()).toBe(false);
      expect(store.items().map((i) => i.id)).toEqual([5]);
    });

    it('un refresco silencioso que releva a una carga visible y falla muestra el error, no un vacío', () => {
      const primera = new Subject<InvitacionMia[]>();
      servicio.mias.mockReturnValueOnce(primera).mockReturnValueOnce(throwError(fallo));
      const store = crear();
      expect(store.cargando()).toBe(true);

      store.recargar(true);

      expect(store.error()).toContain('No se pudieron cargar');
      expect(store.cargando()).toBe(false);
      primera.next([mia(1)]); // la vieja ya no cuenta
      expect(store.items()).toEqual([]);
    });

    it('un refresco silencioso que falla sin carga visible pendiente sigue sin marcar error', () => {
      const store = crear();
      servicio.mias.mockReturnValue(throwError(fallo));

      store.recargar(true);

      expect(store.error()).toBeNull();
      expect(store.items()).toHaveLength(2);
    });
  });

  it('al recuperarse la sesión tras una caída vuelve a cargar', () => {
    servicio.mias.mockReturnValueOnce(throwError(() => new HttpErrorResponse({ status: 0 })));
    const store = crear();
    auth.sesionIncierta.set(true);
    TestBed.tick();
    servicio.mias.mockReturnValue(of([mia(4)]));

    auth.sesionIncierta.set(false);
    TestBed.tick();

    expect(store.items().map((i) => i.id)).toEqual([4]);
  });
});
