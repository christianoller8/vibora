import { Rol } from '../../shared/models/usuario.model';

/** Pantalla en la que aterriza cada rol al entrar: el administrador del club, en su panel; el resto, en la agenda. */
export function rutaInicial(rol: Rol | null): string {
  return rol === 'ADMIN_CLUB' ? '/panel' : '/agenda';
}
