import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Logo } from '../../../shared/components/logo/logo';
import { SelectorTema } from '../../../shared/components/selector-tema/selector-tema';

/** Marco de login y registro (sin menú lateral): panel de marca a un lado y el formulario en su tarjeta al otro. */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, Logo, SelectorTema],
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayout {}
