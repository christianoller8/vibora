import { TestBed } from '@angular/core/testing';
import { App } from './app';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  describe('tema en <html>', () => {
    const limpiar = (): void => {
      localStorage.removeItem('vibora.tema');
      document.documentElement.removeAttribute('data-theme');
      document.documentElement.style.removeProperty('color-scheme');
    };
    beforeEach(limpiar);
    afterEach(limpiar);

    it('sin elección guardada aplica el oscuro al crearse', () => {
      TestBed.createComponent(App);
      expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    });

    it('respeta el tema claro guardado al crearse', () => {
      localStorage.setItem('vibora.tema', 'light');
      TestBed.createComponent(App);
      expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    });
  });

  it('should render the router outlet', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
  });
});
