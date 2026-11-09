import { readFileSync } from 'fs';
import { ServerOptions } from 'https';
import { createSecureContext, SecureVersion } from 'tls';
import * as grpc from '@grpc/grpc-js';

// Transporte (contrato §7.1): solo TLS 1.2 o superior, tanto al servir la API como al llamar a Booking por gRPC.
// En Render el TLS lo termina el proxy del proveedor (con TLS 1.2+ y redirección a HTTPS); estas opciones sirven para
// cuando el contenedor atiende HTTPS directamente (Docker propio, pruebas) y para el canal saliente hacia Booking.
export const TLS_MINIMO: SecureVersion = 'TLSv1.2';

type Entorno = Record<string, string | undefined>;

// TLS_CERT_FILE + TLS_KEY_FILE (PEM) activan HTTPS en el puerto de la API. Con una sola de las dos, error de arranque:
// mejor no arrancar que arrancar sin cifrar creyendo que sí.
export function opcionesHttps(env: Entorno = process.env): ServerOptions | undefined {
  const cert = env.TLS_CERT_FILE?.trim();
  const key = env.TLS_KEY_FILE?.trim();
  if (!cert && !key) return undefined;
  if (!cert || !key) throw new Error('TLS_CERT_FILE y TLS_KEY_FILE deben definirse juntas.');
  return { cert: readFileSync(cert), key: readFileSync(key), minVersion: TLS_MINIMO };
}

// Credenciales del canal gRPC saliente: TLS ≥ 1.2 y, opcionalmente, la CA propia de Booking (BOOKING_GRPC_CA_FILE)
export function credencialesGrpcTls(env: Entorno = process.env): grpc.ChannelCredentials {
  const ca = env.BOOKING_GRPC_CA_FILE?.trim();
  return grpc.credentials.createFromSecureContext(createSecureContext({ minVersion: TLS_MINIMO, ...(ca && { ca: readFileSync(ca) }) }));
}
