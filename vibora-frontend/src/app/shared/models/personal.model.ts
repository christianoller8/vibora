import { Rol } from './usuario.model';

/** Roles con los que se puede invitar al personal del club (el administrador no se invita). */
export type RolPersonal = Extract<Rol, 'MONITOR' | 'MANTENIMIENTO'>;

export const ROLES_PERSONAL: readonly RolPersonal[] = ['MONITOR', 'MANTENIMIENTO'];
