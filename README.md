# Microservicio de Disponibilidad (`disponibilidad-cozy`)

Microservicio de gestión de cupos diarios, cotizaciones, retenciones temporales, planes tarifarios y sincronización de inventario con Booking.

## Características
- **Gestión de Cupos:** Disponibilidad diaria, bloqueos, retenciones con vencimiento automático.
- **Cotizaciones y Planes:** Reglas tarifarias, precios base y restricciones.
- **gRPC a Booking:** Sincronización saliente de stock hacia Booking mediante `inventory.proto`.
- **Contrato de Puerto:** Expone `disponibilidad-puerto` (`contracts/disponibilidad-puerto-openapi.yaml`) vía REST interno para catálogo y reservas.
- **Base de datos:** Conexión exclusiva con rol `cozy_disponibilidad` sobre el esquema `disponibilidad` de `cozy_v2`.
- **Salud:** `GET /health` en el puerto 3003.

## Instalación y compilación
```bash
npm ci
npm run build
```
