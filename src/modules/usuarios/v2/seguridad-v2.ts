import { SetMetadata } from '@nestjs/common';
import type { RolV2 } from './autenticacion-v2';

// Qué credenciales acepta cada operación protegida del contrato v2 (§7 y `security` de cada operación).
// La clave es el operationId del contrato; test/unit `seguridad-v2.spec.ts` compara esta tabla con el YAML.
//   scope        scope de OAuth2ClientCredentials que exige un token de máquina (sin él => 403 INSUFFICIENT_SCOPE)
//   bearer       si acepta el JWT de un usuario (BearerAuth), y con qué roles (x-required-roles)
//   apiKey       si acepta la X-API-Key deprecada (ApiKeyAuth)
export interface RequisitosV2 {
  scope?: string;
  bearer: boolean;
  rolesBearer?: RolV2[];
  apiKey: boolean;
}

const lectura = 'alojamientos:read';
const reserva = { scope: 'alojamientos:book', bearer: true, apiKey: true };
const consulta = { scope: lectura, bearer: true, apiKey: true };
const cancelacion = { scope: 'alojamientos:cancel', bearer: true, apiKey: true };
const checkin = { scope: 'alojamientos:checkin', bearer: true, apiKey: false };
// Solo máquina a máquina: el `security` del contrato no lista BearerAuth (x-required-roles SERVICE/ADMIN describe quién es el llamador)
const inventario = { scope: 'alojamientos:inventory', bearer: false, apiKey: true };

export const REQUISITOS_V2: Record<string, RequisitosV2> = {
  getPromotionContract: consulta,
  putPromotionContract: { scope: 'alojamientos:admin', bearer: true, rolesBearer: ['ADMIN'], apiKey: false },
  listOutboxEvents: inventario,
  createOrder: reserva,
  listOrders: { scope: lectura, bearer: true, rolesBearer: ['ADMIN'], apiKey: true },
  getOrder: consulta,
  cancelOrder: cancelacion,
  checkInOrder: checkin,
  setEarlyCheckin: { scope: 'alojamientos:admin', bearer: true, rolesBearer: ['ADMIN'], apiKey: false },
  checkOutOrder: checkin,
  listMyReservations: { bearer: true, rolesBearer: ['CLIENTE', 'ADMIN'], apiKey: false },
  getInventorySnapshot: inventario,
  createResena: { bearer: true, rolesBearer: ['CLIENTE'], apiKey: false },
  createOrder_alojamientos_reservas: reserva,
  createOrder_alojamientos_id_reservations: reserva,
  getOrder_alojamientos_reservas_id: consulta,
  getOrder_alojamientos_reservations_reservationId: consulta,
  cancelOrder_alojamientos_reservas_id_cancel: cancelacion,
  cancelOrder_alojamientos_reservations_reservationId_cancel: cancelacion,
  checkInOrder_alojamientos_reservas_id_checkin: checkin,
  checkInOrder_alojamientos_reservations_reservationId_checkin: checkin,
  checkOutOrder_alojamientos_reservas_id_checkout: checkin,
  checkOutOrder_alojamientos_reservations_reservationId_checkout: checkin,
  createResena_alojamientos_id_reviews: { bearer: true, rolesBearer: ['CLIENTE'], apiKey: false },
};

export const OPERACION_V2 = 'operacionV2';
// Marca el handler con el operationId del contrato; AutenticacionV2Guard aplica de ahí los requisitos.
export const OperacionV2 = (operationId: string) => SetMetadata(OPERACION_V2, operationId);
