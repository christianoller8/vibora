import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TemaService } from './core/tema/tema.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  constructor() {
    // aplica el tema guardado (o el oscuro) en <html> desde el primer momento, también en rutas sin selector de tema
    inject(TemaService);
  }
}
