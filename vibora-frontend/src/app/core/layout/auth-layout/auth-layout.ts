import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SelectorTema } from '../../../shared/components/selector-tema/selector-tema';

/** Marco limpio (sin menú lateral) para login y registro. */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, SelectorTema],
  templateUrl: './auth-layout.html',
  styleUrl: './auth-layout.scss',
})
export class AuthLayout {}
