import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject, of, throwError } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificacionesStore } from '../../../core/notificaciones/notificaciones.store';
import { Notificacion, TipoNotificacion } from '../../../shared/models/notificacion.model';
import { Reserva } from '../../../shared/models/reserva.model';
import { crearAuthFalso, crearNotificacion } from '../../../testing/test-utils';
import { PartidoService } from '../../partidos/partido.service';
import { ReservaService } from '../reserva.service';
import { MisReservas } from './mis-reservas';

const HORA = 3_600_000;

function reserva(id: number, estado: Reserva['estado'], inicioEnMs: number): Reserva {
  const inicio = new Date(Date.now() + inicioEnMs);
  return {
    id,
    pistaId: 10,
    pistaNombre: `Pista ${id}`,
    clubId: 1,
    clubNombre: `Club ${id}`,
    inicio: inicio.toISOString(),
    fin: new Date(inicio.getTime() + 1.5 * HORA).toISOString(),
    estado,
    precioTotal: 12,
    abierta: false,
    jugadores: 1,
    cuotaPorJugador: 3,
  };
}

describe('MisReservas', () => {
  let fixture: ComponentFixture<MisReservas>;
  const reservas = { mias: vi.fn(), cancelar: vi.fn() };
  const partidos = { setAbierta: vi.fn() };
  const dialogo = { open: vi.fn() };
  const snack = { open: vi.fn() };

  const FUTURA = reserva(1, 'CONFIRMADA', 48 * HORA);
  const PASADA = reserva(2, 'CONFIRMADA', -48 * HORA);
  const CANCELADA = reserva(3, 'CANCELADA', 72 * HORA);
  let recibidas: Subject<Notificacion>;

  let auth: ReturnType<typeof crearAuthFalso>;

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [MisReservas],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: NotificacionesStore, useValue: { recibidas$: recibidas.asObservable() } },
        { provide: ReservaService, useValue: reservas },
        { provide: PartidoService, useValue: partidos },
        { provide: MatDialog, useValue: dialogo },
        { provide: MatSnackBar, useValue: snack },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(MisReservas);
    await fixture.whenStable();
  }

  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const filas = (): HTMLElement[] => Array.from(el().querySelectorAll<HTMLElement>('.reserva'));
  const botonCancelar = (fila: HTMLElement): HTMLButtonElement | null =>
    fila.querySelector('button[data-accion="cancelar"]');

  beforeEach(() => {
    vi.resetAllMocks();
    auth = crearAuthFalso();
    recibidas = new Subject<Notificacion>();
    reservas.mias.mockReturnValue(of([FUTURA, PASADA, CANCELADA]));
    dialogo.open.mockReturnValue({ afterClosed: () => of(true) });
  });

  describe('error de carga (por ejemplo tras una caída del backend)', () => {
    const caida = () => throwError(() => new HttpErrorResponse({ status: 503 }));
    const reintentar = (): HTMLButtonElement | null =>
      el().querySelector<HTMLButtonElement>('button[data-accion="reintentar"]');

    it('muestra el error con un botón Reintentar que vuelve a cargar', async () => {
      reservas.mias.mockReturnValueOnce(caida());
      await crear();
      expect(el().querySelector('.error')).not.toBeNull();
      expect(reintentar()).not.toBeNull();

      reintentar()!.click();
      await fixture.whenStable();

      expect(reservas.mias).toHaveBeenCalledTimes(2);
      expect(el().querySelector('.error')).toBeNull();
      expect(reintentar()).toBeNull();
      expect(filas()).toHaveLength(3);
    });

    it('recarga sola cuando la sesión deja de ser incierta estando en error', async () => {
      auth.sesionIncierta.set(true);
      reservas.mias.mockReturnValueOnce(caida());
      await crear();
      expect(el().querySelector('.error')).not.toBeNull();

      auth.sesionIncierta.set(false);
      await fixture.whenStable();

      expect(reservas.mias).toHaveBeenCalledTimes(2);
      expect(filas()).toHaveLength(3);
    });

    it('no recarga al recuperarse la sesión si la página no está en error', async () => {
      await crear();

      auth.sesionIncierta.set(true);
      await fixture.whenStable();
      auth.sesionIncierta.set(false);
      await fixture.whenStable();

      expect(reservas.mias).toHaveBeenCalledTimes(1);
    });

    it('al destruirse deja de escuchar la sesión', async () => {
      auth.sesionIncierta.set(true);
      reservas.mias.mockReturnValueOnce(caida());
      await crear();

      fixture.destroy();
      auth.sesionIncierta.set(false);
      await fixture.whenStable();

      expect(reservas.mias).toHaveBeenCalledTimes(1);
    });
  });

  it('lista las reservas en el orden que devuelve el backend', async () => {
    await crear();

    expect(filas()).toHaveLength(3);
    expect(filas()[0].textContent).toContain('Pista 1');
    expect(filas()[1].textContent).toContain('Pista 2');
  });

  it('muestra el nombre del club junto a la pista', async () => {
    await crear();

    expect(filas()[0].querySelector('.pista')!.textContent).toContain('Club 1 · Pista 1');
    expect(filas()[1].querySelector('.pista')!.textContent).toContain('Club 2 · Pista 2');
  });

  it('incluye el club en el diálogo de confirmación', async () => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(false) });
    await crear();

    botonCancelar(filas()[0])!.click();
    await fixture.whenStable();

    const datos = dialogo.open.mock.calls[0][1].data;
    expect(datos.lineas).toContainEqual({ etiqueta: 'Club', valor: 'Club 1' });
  });

  it('muestra el estado, el precio en euros y el horario de cada reserva', async () => {
    await crear();

    expect(filas()[0].textContent).toContain('Confirmada');
    expect(filas()[2].textContent).toContain('Cancelada');
    expect(filas()[0].textContent).toMatch(/12,00\s€/);
    expect(filas()[0].textContent).toMatch(/\d{2}:\d{2} – \d{2}:\d{2}/);
  });

  it('solo ofrece cancelar las reservas CONFIRMADAS que aún no han empezado', async () => {
    await crear();

    expect(botonCancelar(filas()[0])).not.toBeNull(); // futura confirmada
    expect(botonCancelar(filas()[1])).toBeNull(); // pasada
    expect(botonCancelar(filas()[2])).toBeNull(); // ya cancelada
  });

  it('muestra un estado vacío cuando no hay reservas', async () => {
    reservas.mias.mockReturnValue(of([]));
    await crear();

    expect(el().textContent).toContain('Todavía no tienes reservas');
  });

  it('muestra el error si falla la carga', async () => {
    reservas.mias.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 500, error: 'boom' })),
    );
    await crear();

    expect(el().querySelector('[role="alert"]')).not.toBeNull();
  });

  it('cancela tras confirmar, avisa y recarga la lista', async () => {
    reservas.cancelar.mockReturnValue(of({ ...FUTURA, estado: 'CANCELADA' }));
    await crear();
    reservas.mias.mockClear();

    botonCancelar(filas()[0])!.click();
    await fixture.whenStable();

    expect(dialogo.open).toHaveBeenCalledTimes(1);
    expect(reservas.cancelar).toHaveBeenCalledWith(1);
    expect(snack.open.mock.calls[0][0]).toContain('Reserva cancelada');
    expect(reservas.mias).toHaveBeenCalledTimes(1);
  });

  it('no cancela si se descarta el diálogo', async () => {
    dialogo.open.mockReturnValue({ afterClosed: () => of(false) });
    await crear();

    botonCancelar(filas()[0])!.click();
    await fixture.whenStable();

    expect(reservas.cancelar).not.toHaveBeenCalled();
  });

  it('muestra el mensaje del backend si el 409 está fuera del plazo de cancelación', async () => {
    reservas.cancelar.mockReturnValue(
      throwError(
        () =>
          new HttpErrorResponse({
            status: 409,
            error: { error: 'Fuera del plazo de cancelación' },
          }),
      ),
    );
    await crear();

    botonCancelar(filas()[0])!.click();
    await fixture.whenStable();

    expect(snack.open.mock.calls[0][0]).toContain('Fuera del plazo de cancelación');
  });

  describe('plazo de cancelación del propietario (cancelableHasta)', () => {
    const AHORA = Date.parse('2026-07-15T10:00:00Z'); // 12:00 en Madrid
    const iso = (ms: number): string => new Date(ms).toISOString();

    function conPlazo(cancelableHasta: string | null | undefined): Reserva {
      const base = reserva(1, 'CONFIRMADA', 0);
      return {
        ...base,
        inicio: iso(AHORA + 24 * HORA),
        fin: iso(AHORA + 25.5 * HORA),
        ...(cancelableHasta === undefined ? {} : { cancelableHasta }),
      };
    }

    async function crearConReloj(r: Reserva): Promise<void> {
      vi.useFakeTimers({ now: AHORA, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
      reservas.mias.mockReturnValue(of([r]));
      await crear();
    }
    const boton = (): HTMLButtonElement => botonCancelar(filas()[0])!;
    const aviso = (): string => el().querySelector('.aviso-plazo')?.textContent?.trim() ?? '';

    afterEach(() => {
      vi.useRealTimers();
    });

    it('antes del plazo el botón está activo y no hay aviso', async () => {
      await crearConReloj(conPlazo(iso(AHORA + 2 * HORA)));

      expect(boton().disabled).toBe(false);
      expect(aviso()).toBe('');
    });

    it('justo en el instante límite todavía se puede cancelar ("hasta" es inclusivo)', async () => {
      await crearConReloj(conPlazo(iso(AHORA)));

      expect(boton().disabled).toBe(false);
    });

    it('pasado el plazo desactiva "Cancelar" y explica hasta cuándo (hora de Madrid)', async () => {
      await crearConReloj(conPlazo('2026-07-15T09:30:00Z')); // 11:30 en Madrid

      expect(boton().disabled).toBe(true);
      expect(aviso()).toBe('Solo se puede cancelar hasta el 15 de julio de 2026, 11:30');
      expect(boton().getAttribute('aria-describedby')).toBe(
        el().querySelector('.aviso-plazo')!.id,
      );
    });

    it.each([null, undefined])('sin plazo conocido (%s) se mantiene el comportamiento de siempre', async (plazo) => {
      await crearConReloj(conPlazo(plazo));

      expect(boton().disabled).toBe(false);
      expect(aviso()).toBe('');
    });

    it('el diálogo de cancelación muestra el plazo; si no se conoce, no añade la línea', async () => {
      dialogo.open.mockReturnValue({ afterClosed: () => of(false) });
      await crearConReloj(conPlazo('2026-07-15T12:00:00Z')); // 14:00 en Madrid
      boton().click();
      await fixture.whenStable();
      expect(dialogo.open.mock.calls[0][1].data.lineas).toContainEqual({
        etiqueta: 'Cancelable hasta',
        valor: '15 de julio de 2026, 14:00',
      });

      dialogo.open.mockClear();
      TestBed.resetTestingModule();
      await crearConReloj(conPlazo(null));
      boton().click();
      await fixture.whenStable();
      const etiquetas = dialogo.open.mock.calls[0][1].data.lineas.map(
        (l: { etiqueta: string }) => l.etiqueta,
      );
      expect(etiquetas).not.toContain('Cancelable hasta');
    });

    it('con el plazo vencido, cancelar() no abre el diálogo aunque se invoque', async () => {
      await crearConReloj(conPlazo('2026-07-15T09:30:00Z'));

      fixture.componentInstance['cancelar'](fixture.componentInstance['reservas']()[0]);

      expect(dialogo.open).not.toHaveBeenCalled();
    });

    it('se desactiva solo cuando el reloj cruza el instante límite con la página abierta', async () => {
      await crearConReloj(conPlazo(iso(AHORA + 2 * HORA)));
      expect(boton().disabled).toBe(false);

      await vi.advanceTimersByTimeAsync(2 * HORA - 1);
      await fixture.whenStable();
      expect(boton().disabled).toBe(false); // aún en el último milisegundo

      await vi.advanceTimersByTimeAsync(2);
      await fixture.whenStable();
      expect(boton().disabled).toBe(true);
      expect(aviso()).toContain('Solo se puede cancelar hasta el 15 de julio de 2026, 14:00');
    });

    it('al destruir la página no queda ningún temporizador pendiente', async () => {
      await crearConReloj(conPlazo(iso(AHORA + 2 * HORA)));
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      fixture.destroy();

      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe('notificaciones en tiempo real', () => {
    const push = (tipo: TipoNotificacion): void =>
      recibidas.next(crearNotificacion(Math.floor(Math.random() * 1e6), { tipo }));

    /** Crea la página con reloj real (whenStable lo necesita) y luego congela el tiempo para el debounce. */
    async function arrancar(): Promise<void> {
      await crear();
      vi.useFakeTimers();
      reservas.mias.mockClear();
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it.each<TipoNotificacion>([
      'JUGADOR_SE_APUNTO',
      'JUGADOR_SALIO',
      'PARTIDO_COMPLETO',
      'RESERVA_CANCELADA',
    ])('recarga las reservas al llegar %s', async (tipo) => {
      await arrancar();

      push(tipo);
      vi.advanceTimersByTime(300);

      expect(reservas.mias).toHaveBeenCalledTimes(1);
    });

    it.each<TipoNotificacion>(['CARGO_NUEVO', 'PAGO_RECIBIDO'])(
      'ignora %s: no cambia ninguna reserva',
      async (tipo) => {
        await arrancar();

        push(tipo);
        vi.advanceTimersByTime(1000);

        expect(reservas.mias).not.toHaveBeenCalled();
      },
    );

    it('agrupa ráfagas: diez push seguidos hacen una sola petición', async () => {
      await arrancar();

      for (let i = 0; i < 10; i++) {
        push('JUGADOR_SE_APUNTO');
        vi.advanceTimersByTime(50);
      }
      expect(reservas.mias).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);

      expect(reservas.mias).toHaveBeenCalledTimes(1);
    });

    it('la recarga es silenciosa: sin spinner y con la lista anterior a la vista', async () => {
      await arrancar();
      const pendiente = new Subject<Reserva[]>();
      reservas.mias.mockReturnValue(pendiente);

      push('JUGADOR_SE_APUNTO');
      vi.advanceTimersByTime(300);
      fixture.detectChanges();

      expect(el().querySelector('mat-spinner')).toBeNull();
      expect(filas()).toHaveLength(3);

      pendiente.next([{ ...FUTURA, jugadores: 3 }]);
      pendiente.complete();
      fixture.detectChanges();
      expect(filas()).toHaveLength(1);
      expect(filas()[0].textContent).toContain('Jugadores: 3/4');
    });

    it('si la recarga silenciosa falla muestra el error', async () => {
      await arrancar();
      reservas.mias.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 500 })));

      push('RESERVA_CANCELADA');
      vi.advanceTimersByTime(300);
      fixture.detectChanges();

      expect(el().querySelector('[role="alert"]')).not.toBeNull();
    });

    it('al destruir la página deja de escuchar: no recarga aunque llegue un push', async () => {
      await arrancar();

      push('JUGADOR_SE_APUNTO'); // pendiente de debounce
      fixture.destroy();
      vi.advanceTimersByTime(300);
      push('JUGADOR_SALIO');
      vi.advanceTimersByTime(300);

      expect(reservas.mias).not.toHaveBeenCalled();
      expect(recibidas.observed).toBe(false);
    });
  });

  describe('partido abierto', () => {
    const interruptor = (fila: HTMLElement): HTMLButtonElement | null =>
      fila.querySelector('mat-slide-toggle button[role="switch"]');

    it('solo ofrece el interruptor en las reservas CONFIRMADAS futuras', async () => {
      await crear();

      expect(interruptor(filas()[0])).not.toBeNull(); // futura confirmada
      expect(interruptor(filas()[1])).toBeNull(); // pasada
      expect(interruptor(filas()[2])).toBeNull(); // cancelada
      expect(filas()[0].textContent).toContain('Partido abierto');
    });

    it('refleja si la reserva ya está abierta', async () => {
      reservas.mias.mockReturnValue(of([{ ...FUTURA, abierta: true }]));
      await crear();

      expect(interruptor(filas()[0])!.getAttribute('aria-checked')).toBe('true');
    });

    it('muestra los jugadores apuntados y la cuota por jugador de las confirmadas', async () => {
      reservas.mias.mockReturnValue(
        of([{ ...FUTURA, jugadores: 3, cuotaPorJugador: 11.25 }, CANCELADA]),
      );
      await crear();

      expect(filas()[0].textContent).toContain('Jugadores: 3/4');
      expect(filas()[0].textContent).toMatch(/Tu cuota por jugador: 11,25\s€/);
      expect(filas()[1].textContent).not.toContain('Jugadores:');
    });

    it('al pulsarlo llama a setAbierta y se actualiza al instante (optimista)', async () => {
      const pendiente = new Subject<Reserva>();
      partidos.setAbierta.mockReturnValue(pendiente);
      await crear();

      interruptor(filas()[0])!.click();
      await fixture.whenStable();

      expect(partidos.setAbierta).toHaveBeenCalledWith(1, true);
      expect(interruptor(filas()[0])!.getAttribute('aria-checked')).toBe('true');
    });

    it('al responder el servidor se queda con su versión', async () => {
      partidos.setAbierta.mockReturnValue(of({ ...FUTURA, abierta: true, jugadores: 2 }));
      await crear();

      interruptor(filas()[0])!.click();
      await fixture.whenStable();

      expect(interruptor(filas()[0])!.getAttribute('aria-checked')).toBe('true');
      expect(filas()[0].textContent).toContain('Jugadores: 2/4');
    });

    it('si falla, deshace el cambio y muestra el mensaje del backend', async () => {
      partidos.setAbierta.mockReturnValue(
        throwError(
          () =>
            new HttpErrorResponse({
              status: 409,
              error: { error: 'No se puede cerrar un partido con otros jugadores' },
            }),
        ),
      );
      reservas.mias.mockReturnValue(of([{ ...FUTURA, abierta: true }]));
      await crear();

      interruptor(filas()[0])!.click(); // intenta cerrarlo
      await fixture.whenStable();

      expect(interruptor(filas()[0])!.getAttribute('aria-checked')).toBe('true');
      expect(snack.open.mock.calls[0][0]).toBe('No se puede cerrar un partido con otros jugadores');
    });
  });
});
