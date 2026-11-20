import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CLAVE_TEMA } from '../../../core/tema/tema.service';
import { SelectorTema } from './selector-tema';

describe('SelectorTema', () => {
  let fixture: ComponentFixture<SelectorTema>;

  const boton = (): HTMLButtonElement =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button[data-accion="cambiar-tema"]',
    )!;
  const icono = (): string =>
    (fixture.nativeElement as HTMLElement).querySelector('mat-icon')?.textContent?.trim() ?? '';

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({ imports: [SelectorTema] }).compileComponents();
    fixture = TestBed.createComponent(SelectorTema);
    await fixture.whenStable();
  }

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });
  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('en oscuro ofrece cambiar a claro, con etiqueta accesible y tooltip', async () => {
    await crear();
    expect(boton().getAttribute('aria-label')).toBe('Cambiar a tema claro');
    expect(boton().getAttribute('title')).toBe('Cambiar a tema claro');
    expect(boton().type).toBe('button');
    expect(icono()).toBe('light_mode');
  });

  it('al pulsarlo cambia el tema y la etiqueta pasa a ofrecer el oscuro', async () => {
    await crear();
    boton().click();
    await fixture.whenStable();

    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem(CLAVE_TEMA)).toBe('light');
    expect(boton().getAttribute('aria-label')).toBe('Cambiar a tema oscuro');
    expect(icono()).toBe('dark_mode');

    boton().click();
    await fixture.whenStable();
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(boton().getAttribute('aria-label')).toBe('Cambiar a tema claro');
  });

  it('si la elección guardada es el tema claro, arranca ofreciendo el oscuro', async () => {
    localStorage.setItem(CLAVE_TEMA, 'light');
    await crear();
    expect(boton().getAttribute('aria-label')).toBe('Cambiar a tema oscuro');
  });
});
