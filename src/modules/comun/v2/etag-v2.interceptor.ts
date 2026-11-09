import { createHash } from 'crypto';
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Request, Response } from 'express';
import { Observable, map } from 'rxjs';

// ETag y If-None-Match de los GET de catálogo (contrato v2 §1): la misma representación da el mismo ETag, y si el
// cliente ya lo tiene la respuesta es 304 sin cuerpo.
@Injectable()
export class EtagV2Interceptor implements NestInterceptor {
  intercept(contexto: ExecutionContext, siguiente: CallHandler): Observable<unknown> {
    const req = contexto.switchToHttp().getRequest<Request>();
    const res = contexto.switchToHttp().getResponse<Response>();
    return siguiente.handle().pipe(
      map((cuerpo) => {
        if (req.method !== 'GET' || cuerpo === undefined) return cuerpo;
        const etag = `"${createHash('sha256').update(JSON.stringify(cuerpo)).digest('hex').slice(0, 32)}"`;
        res.setHeader('ETag', etag);
        const recibido = req.header('if-none-match');
        if (recibido && recibido.split(',').some((e) => e.trim().replace(/^W\//, '') === etag || e.trim() === '*')) {
          res.status(304);
          return undefined;
        }
        return cuerpo;
      }),
    );
  }
}
