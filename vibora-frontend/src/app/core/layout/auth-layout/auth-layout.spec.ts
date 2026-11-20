import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthLayout } from './auth-layout';

describe('AuthLayout', () => {
  let fixture: ComponentFixture<AuthLayout>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  async function crear(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [AuthLayout],
      providers: [provideRouter([])],
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
});
