import { Component, ElementRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { mensajeDeError } from '../../../core/http/error.util';
import { enfocarPrimerInvalido } from '../../../shared/forms/enfocar-invalido';
import { destinoSeguro } from '../redirect.util';

const MOTIVOS: ReadonlyMap<string, string> = new Map([
  [
    'invitacion-aceptada',
    'Has aceptado la invitación. Para activar tus nuevos permisos tienes que iniciar sesión de nuevo.',
  ],
  [
    'salida-del-club',
    'Ya saliste del club. Tienes que iniciar sesión de nuevo para continuar como jugador.',
  ],
]);

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatInputModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
})
export class Login {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly anfitrion = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });
  /**
   * Por qué se llegó al login sin haber cerrado la sesión a mano. El texto sale de una lista cerrada: lo que venga en
   * la URL solo elige una clave, nunca se pinta.
   */
  protected readonly aviso: string | null =
    MOTIVOS.get(this.route.snapshot.queryParamMap.get('motivo') ?? '') ?? null;
  protected readonly enviando = signal(false);
  protected readonly error = signal<string | null>(null);

  protected enviar(): void {
    if (this.enviando()) {
      return;
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched(); // saca a la vista todos los mensajes de validación
      enfocarPrimerInvalido(this.anfitrion.nativeElement);
      return;
    }
    this.enviando.set(true);
    this.error.set(null);

    const { email, password } = this.form.getRawValue();
    this.auth.login(email.trim(), password).subscribe({
      next: () => {
        const destino = destinoSeguro(this.route.snapshot.queryParamMap.get('redirectTo'));
        void this.router.navigateByUrl(destino);
      },
      error: (err: unknown) => {
        this.error.set(mensajeDeError(err, 'No se pudo iniciar sesión. Inténtalo de nuevo.'));
        this.enviando.set(false);
      },
    });
  }
}
