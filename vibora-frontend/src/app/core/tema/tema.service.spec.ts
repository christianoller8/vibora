import { TestBed } from '@angular/core/testing';
import { CLAVE_TEMA, TemaService } from './tema.service';

describe('TemaService', () => {
  const html = (): HTMLElement => document.documentElement;

  function crear(): TemaService {
    TestBed.configureTestingModule({});
    return TestBed.inject(TemaService);
  }

  beforeEach(() => {
    localStorage.clear();
    html().removeAttribute('data-theme');
    html().style.removeProperty('color-scheme');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
    html().removeAttribute('data-theme');
    html().style.removeProperty('color-scheme');
  });

  it('arranca en oscuro cuando no hay elección guardada', () => {
    expect(crear().tema()).toBe('dark');
  });

  it('arranca en oscuro aunque el sistema prefiera el tema claro', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((consulta: string) => ({
        matches: consulta.includes('light'),
        media: consulta,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    try {
      expect(crear().tema()).toBe('dark');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('respeta la elección guardada', () => {
    localStorage.setItem(CLAVE_TEMA, 'light');
    expect(crear().tema()).toBe('light');
  });

  it('ignora un valor guardado que no es un tema', () => {
    localStorage.setItem(CLAVE_TEMA, 'solarizado');
    expect(crear().tema()).toBe('dark');
  });

  it('aplica data-theme y color-scheme en <html> al arrancar', () => {
    localStorage.setItem(CLAVE_TEMA, 'light');
    crear();
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().style.colorScheme).toBe('light');
  });

  it('por defecto aplica el tema oscuro en <html>', () => {
    crear();
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(html().style.colorScheme).toBe('dark');
  });

  it('no guarda nada hasta que el usuario elige', () => {
    crear();
    expect(localStorage.getItem(CLAVE_TEMA)).toBeNull();
  });

  it('alternar cambia el tema, lo aplica y lo guarda', () => {
    const servicio = crear();

    servicio.alternar();
    expect(servicio.tema()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
    expect(html().style.colorScheme).toBe('light');
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('light');

    servicio.alternar();
    expect(servicio.tema()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('dark');
  });

  it('establecer fija un tema concreto', () => {
    const servicio = crear();
    servicio.establecer('light');
    expect(servicio.tema()).toBe('light');
    servicio.establecer('light');
    expect(servicio.tema()).toBe('light');
  });

  it('si leer el almacenamiento lanza, arranca en oscuro sin fallar', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(crear().tema()).toBe('dark');
    expect(html().getAttribute('data-theme')).toBe('dark');
  });

  it('si escribir en el almacenamiento lanza, el cambio se aplica igualmente', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    const servicio = crear();

    expect(() => servicio.alternar()).not.toThrow();
    expect(servicio.tema()).toBe('light');
    expect(html().getAttribute('data-theme')).toBe('light');
  });

  it('si acceder a localStorage lanza (propiedad bloqueada), no falla', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    const servicio = crear();
    expect(servicio.tema()).toBe('dark');
    expect(() => servicio.alternar()).not.toThrow();
    expect(servicio.tema()).toBe('light');
  });

  describe('theme-color del navegador', () => {
    let meta: HTMLMetaElement;

    beforeEach(() => {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = '#111111';
      meta.setAttribute('data-oscuro', '#111111');
      meta.setAttribute('data-claro', '#eeeeee');
      document.head.appendChild(meta);
    });

    afterEach(() => meta.remove());

    it('arranca con el color del tema oscuro por defecto', () => {
      crear();
      expect(meta.content).toBe('#111111');
    });

    it('arranca con el color del tema guardado', () => {
      localStorage.setItem(CLAVE_TEMA, 'light');
      crear();
      expect(meta.content).toBe('#eeeeee');
    });

    it('alternar y establecer cambian el color de la barra con el tema', () => {
      const servicio = crear();
      servicio.alternar();
      expect(meta.content).toBe('#eeeeee');
      servicio.establecer('dark');
      expect(meta.content).toBe('#111111');
    });

    it('si el meta no trae el color del tema, lo deja como está', () => {
      meta.removeAttribute('data-claro');
      crear().alternar();
      expect(meta.content).toBe('#111111');
    });
  });

  describe('sincronización entre pestañas', () => {
    const otraPestana = (clave: string | null, valor: string | null): void => {
      window.dispatchEvent(new StorageEvent('storage', { key: clave, newValue: valor }));
    };

    it('un cambio de tema hecho en otra pestaña se aplica aquí (DOM y señal)', () => {
      const servicio = crear();

      otraPestana(CLAVE_TEMA, 'light');

      expect(servicio.tema()).toBe('light');
      expect(html().getAttribute('data-theme')).toBe('light');
      expect(html().style.colorScheme).toBe('light');

      otraPestana(CLAVE_TEMA, 'dark');
      expect(servicio.tema()).toBe('dark');
      expect(html().getAttribute('data-theme')).toBe('dark');
    });

    it('ignora valores que no son un tema, el borrado y otras claves', () => {
      const servicio = crear();
      servicio.establecer('light');

      otraPestana(CLAVE_TEMA, 'solarizado');
      otraPestana(CLAVE_TEMA, null);
      otraPestana('otra.clave', 'dark');
      otraPestana(null, null);

      expect(servicio.tema()).toBe('light');
      expect(html().getAttribute('data-theme')).toBe('light');
    });

    it('lo recibido de otra pestaña no se vuelve a escribir (ya está guardado)', () => {
      crear();
      const escribir = vi.spyOn(Storage.prototype, 'setItem');

      otraPestana(CLAVE_TEMA, 'light');

      expect(escribir).not.toHaveBeenCalled();
    });

    it('al destruirse el servicio deja de escuchar', () => {
      const servicio = crear();
      TestBed.resetTestingModule();

      otraPestana(CLAVE_TEMA, 'light');

      expect(servicio.tema()).toBe('dark');
    });
  });
});
