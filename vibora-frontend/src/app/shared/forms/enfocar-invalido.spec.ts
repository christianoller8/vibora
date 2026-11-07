import { enfocarPrimerInvalido } from './enfocar-invalido';

describe('enfocarPrimerInvalido', () => {
  let raiz: HTMLElement;

  function montar(html: string): void {
    raiz = document.createElement('form');
    raiz.innerHTML = html;
    document.body.appendChild(raiz);
  }

  afterEach(() => raiz.remove());

  it('enfoca el primer campo inválido en orden de documento', () => {
    montar(`
      <input id="a" class="ng-valid" />
      <input id="b" class="ng-invalid" />
      <input id="c" class="ng-invalid" />`);

    expect(enfocarPrimerInvalido(raiz)).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });

  it('ignora los contenedores marcados como inválidos (mat-form-field) y enfoca el campo de dentro', () => {
    montar(
      `<div id="contenedor" tabindex="0" class="ng-invalid"><input id="dentro" class="ng-invalid" /></div>`,
    );

    enfocarPrimerInvalido(raiz);

    expect(document.activeElement?.id).toBe('dentro');
  });

  it('también enfoca select y textarea inválidos', () => {
    montar(`<textarea id="t" class="ng-invalid"></textarea><select id="s" class="ng-invalid"></select>`);

    enfocarPrimerInvalido(raiz);

    expect(document.activeElement?.id).toBe('t');
  });

  it('si todos son válidos no mueve el foco y devuelve false', () => {
    montar(`<input id="a" class="ng-valid" /><input id="b" class="ng-valid" />`);
    raiz.querySelector<HTMLInputElement>('#a')!.focus();

    expect(enfocarPrimerInvalido(raiz)).toBe(false);
    expect(document.activeElement?.id).toBe('a');
  });
});
