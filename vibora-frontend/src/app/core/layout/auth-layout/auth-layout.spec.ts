import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Component } from '@angular/core';
import { AuthLayout } from './auth-layout';

@Component({ template: '<form data-testid="formulario"><input name="email" /></form>' })
class FormularioFalso {}

describe('AuthLayout', () => {
  let fixture: ComponentFixture<AuthLayout>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AuthLayout],
      providers: [provideRouter([{ path: '**', component: FormularioFalso }])],
    }).compileComponents();
    fixture = TestBed.createComponent(AuthLayout);
    await fixture.whenStable();
  }

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.removeProperty('color-scheme');
  });

  it('muestra el selector de tema, fuera del menú lateral (login y registro no tienen shell)', async () => {
    await crear();

    const boton = el().querySelector('button[data-accion="cambiar-tema"]');
    expect(boton).not.toBeNull();
    expect(boton?.getAttribute('aria-label')).toBe('Cambiar a tema claro');
  });

  it('el panel de marca lleva el logo (con nombre accesible, animado) y no el texto plano antiguo', async () => {
    await crear();

    const logos = el().querySelectorAll('app-logo');
    expect(logos.length).toBe(1);
    const logo = logos[0] as HTMLElement;
    expect(logo.getAttribute('aria-label')).toBe('Víbora');
    expect(logo.classList.contains('animado')).toBe(true);
    expect(el().querySelector('p.marca')).toBeNull();
  });

  it('el titular resalta una sola palabra con el color de acento y se lee como una frase', async () => {
    await crear();

    const titular = el().querySelector('.titular') as HTMLElement;
    expect(titular.textContent?.replace(/\s+/g, ' ').trim()).toBe('Reserva. Juega. Repite.');
    const acentos = titular.querySelectorAll('.acento');
    expect(acentos.length).toBe(1);
    expect(acentos[0].textContent).toBe('Repite.');
    expect(el().querySelector('.apoyo')?.textContent?.trim().length).toBeGreaterThan(10);
  });

  it('la textura de pista es decorativa: oculta a la accesibilidad, sin foco y sin colores propios', async () => {
    await crear();

    const textura = el().querySelector('svg.textura') as SVGElement;
    expect(textura).not.toBeNull();
    expect(textura.getAttribute('aria-hidden')).toBe('true');
    expect(textura.getAttribute('focusable')).toBe('false');
    expect(
      textura.querySelector('[fill]:not([fill="none"]):not([fill="currentColor"])'),
    ).toBeNull();
    for (const trazo of Array.from(textura.querySelectorAll('[stroke]'))) {
      expect(trazo.getAttribute('stroke')).toBe('currentColor');
    }
  });

  it('el formulario de la ruta se pinta dentro de la tarjeta, junto al panel de marca', async () => {
    await crear();
    await TestBed.inject(Router).navigateByUrl('/login');
    await fixture.whenStable();

    const formulario = el().querySelector('.tarjeta [data-testid="formulario"]');
    expect(formulario).not.toBeNull();
    expect(el().querySelector('.panel .tarjeta')).toBeNull();
  });
});
