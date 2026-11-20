import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Logo } from './logo';

@Component({
  imports: [Logo],
  template: `<app-logo [variante]="variante" [decorativo]="decorativo" [animado]="animado" />`,
})
class Anfitrion {
  variante: 'completo' | 'marca' = 'completo';
  decorativo = false;
  animado = false;
}

async function montar(
  cambios: Partial<Pick<Anfitrion, 'variante' | 'decorativo' | 'animado'>> = {},
) {
  await TestBed.configureTestingModule({ imports: [Anfitrion] }).compileComponents();
  const fixture = TestBed.createComponent(Anfitrion);
  Object.assign(fixture.componentInstance, cambios);
  await fixture.whenStable();
  const host = (fixture.nativeElement as HTMLElement).querySelector('app-logo') as HTMLElement;
  return { fixture, host };
}

describe('Logo', () => {
  it('dibuja la marca (dos colmillos y la escama) y el nombre como texto real', async () => {
    const { host } = await montar();

    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelectorAll('svg path.colmillo').length).toBe(2);
    expect(host.querySelector('svg .escama')).not.toBeNull();
    const nombre = host.querySelector('.nombre');
    expect(nombre?.textContent?.trim()).toBe('Víbora');
    // la "í" lleva el acento de color
    expect(nombre?.querySelector('.acento')?.textContent).toBe('í');
  });

  it('tiene el nombre accesible "Víbora" como imagen (no se lee letra a letra)', async () => {
    const { host } = await montar();

    expect(host.getAttribute('role')).toBe('img');
    expect(host.getAttribute('aria-label')).toBe('Víbora');
    expect(host.getAttribute('aria-hidden')).toBeNull();
  });

  it('la variante "marca" no pinta el nombre, pero conserva el nombre accesible', async () => {
    const { host } = await montar({ variante: 'marca' });

    expect(host.querySelector('svg')).not.toBeNull();
    expect(host.querySelector('.nombre')).toBeNull();
    expect(host.getAttribute('aria-label')).toBe('Víbora');
  });

  it('la variante decorativa se oculta a la accesibilidad y no se anuncia como imagen', async () => {
    const { host } = await montar({ decorativo: true });

    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('aria-label')).toBeNull();
  });

  it('solo se anima si se pide', async () => {
    const quieto = await montar();
    expect(quieto.host.classList.contains('animado')).toBe(false);

    TestBed.resetTestingModule();
    const animado = await montar({ animado: true });
    expect(animado.host.classList.contains('animado')).toBe(true);
  });

  it('la marca no lleva colores propios: usa currentColor', async () => {
    const { host } = await montar();
    const svg = host.querySelector('svg') as SVGElement;

    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
  });
});
