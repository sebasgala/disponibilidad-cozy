import { Injectable, Optional } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { DataSource, Repository } from 'typeorm';
import { LoginDto, LoginResponseDto, RegistroDto, UsuarioResponseDto } from '../dto/auth/auth.dto';
import { EstadoUsuario, RolUsuario, Usuario } from '../entities/usuario.entity';
import {
  ConflictoException,
  NoAutenticadoException,
  ProhibidoException,
} from '../../comun/problems/problem-details.exceptions';
import { CargaJwt, SesionJwt } from './seguridad.tipos';
import { CONEXION } from '../../../database/conexiones';

export const COSTE_BCRYPT = 12;
// Vida del token de acceso: 10 minutos (fase 8.1). Se renueva con POST /auth/renovar, que sí lee la cuenta.
export const SEGUNDOS_DE_VIGENCIA = 10 * 60;
const ES_UUID = /^[0-9a-f-]{36}$/i;

@Injectable()
export class AuthService {
  // Hash de relleno: si el correo no existe, igual se compara contra algo para que responder tarde lo mismo
  // y no se pueda averiguar qué correos tienen cuenta midiendo el tiempo.
  private hashDeRelleno?: Promise<string>;

  constructor(
    @Optional()
    @InjectRepository(Usuario, CONEXION.usuarios)
    private readonly usuariosRepository: Repository<Usuario> | undefined,
    private readonly jwtService: JwtService,
    @Optional()
    @InjectDataSource(CONEXION.usuarios)
    private readonly dataSource?: DataSource,
  ) {}

  private get repo(): Repository<Usuario> {
    if (this.usuariosRepository) return this.usuariosRepository;
    if (this.dataSource) return this.dataSource.getRepository(Usuario);
    throw new Error('El repositorio de usuarios solo está disponible en el módulo usuarios.');
  }

  // ───────────────────────── Registro y login ─────────────────────────

  // cliente => activo. administrador => pendiente hasta que el superadmin lo apruebe. Nunca superadmin.
  async registrar(dto: RegistroDto): Promise<UsuarioResponseDto> {
    const email = this.normalizarCorreo(dto.email);
    const rol = dto.rol ?? RolUsuario.CLIENTE;
    if (await this.repo.existsBy({ email })) {
      throw new ConflictoException('VALIDATION_FAILED', 'Ya existe una cuenta con ese correo', [
        { name: 'email', reason: 'ya está registrado' },
      ]);
    }
    const usuario = await this.repo.save(
      this.repo.create({
        email,
        passwordHash: await bcrypt.hash(dto.password, COSTE_BCRYPT),
        nombre: dto.nombre.trim(),
        apellido: dto.apellido.trim(),
        rol,
        estado: rol === RolUsuario.ADMINISTRADOR ? EstadoUsuario.PENDIENTE : EstadoUsuario.ACTIVO,
      }),
    );
    return this.aRespuesta(usuario);
  }

  async login(dto: LoginDto): Promise<LoginResponseDto> {
    const usuario = await this.repo.findOneBy({ email: this.normalizarCorreo(dto.email) });
    const hash = usuario?.passwordHash ?? (await this.relleno());
    const correcta = await bcrypt.compare(dto.password, hash);
    // Mismo mensaje para "no existe" y "contraseña incorrecta".
    if (!usuario || !correcta) throw new NoAutenticadoException('Correo o contraseña incorrectos');

    // El estado solo se revela a quien conoce la contraseña.
    this.exigirCuentaActiva(usuario);
    return this.sesionNueva(usuario);
  }

  // Token nuevo con el rol y el estado de la cuenta (login y renovación)
  private async sesionNueva(usuario: Usuario): Promise<LoginResponseDto> {
    const access_token = await this.jwtService.signAsync({ sub: usuario.id, rol: usuario.rol, estado: usuario.estado } satisfies CargaJwt);
    return { access_token, token_type: 'Bearer', expires_in: SEGUNDOS_DE_VIGENCIA, usuario: this.aRespuesta(usuario) };
  }

  // ───────────────────────── Token ─────────────────────────

  // Sesión de la cabecera Authorization, para JwtAuthGuard y la autenticación v2. Verifica la firma y el vencimiento
  // y NO lee la cuenta (fase 8.1): rol y estado son los del momento en que se emitió el token. Cualquier fallo es 401.
  // `ahora` fija el instante con que se mide el vencimiento (solo lo informa el reloj de pruebas; ver reloj-prueba.ts).
  async sesionDelToken(cabecera: string | undefined, ahora?: Date): Promise<SesionJwt> {
    const token = this.extraerToken(cabecera);
    if (!token) throw new NoAutenticadoException();
    let carga: CargaJwt;
    try {
      carga = await this.jwtService.verifyAsync<CargaJwt>(token, ahora ? { clockTimestamp: Math.floor(ahora.getTime() / 1000) } : undefined);
    } catch {
      throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    }
    // Un token anterior a la fase 8.1 (solo `sub`) o con datos que no existen no sirve
    const rolesValidos: string[] = Object.values(RolUsuario);
    const estadosValidos: string[] = Object.values(EstadoUsuario);
    if (typeof carga?.sub !== 'string' || !ES_UUID.test(carga.sub) || !rolesValidos.includes(carga.rol) || !estadosValidos.includes(carga.estado)) {
      throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    }
    this.exigirCuentaActiva(carga);
    return { id: carga.sub, rol: carga.rol, estado: carga.estado };
  }

  // Para las rutas del contrato, que no exigen login: si llega un token válido de una cuenta activa se usa
  // para asociar la compra; si no hay token, o no sirve, la petición sigue como compra sin cuenta.
  async usuarioOpcional(cabecera: string | undefined): Promise<SesionJwt | null> {
    if (!this.extraerToken(cabecera)) return null;
    try {
      return await this.sesionDelToken(cabecera);
    } catch {
      return null;
    }
  }

  // POST /auth/renovar: la ruta que sí lee la cuenta. Quien llega ya pasó JwtAuthGuard (token vigente). Si la cuenta
  // fue suspendida desde que se emitió ese token, aquí se entera (403 ACCOUNT_SUSPENDED); si no, recibe un token nuevo
  // con el rol y el estado de ahora.
  async renovar(id: string): Promise<LoginResponseDto> {
    const usuario = await this.buscarPorId(id);
    if (!usuario) throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    this.exigirCuentaActiva(usuario);
    return this.sesionNueva(usuario);
  }

  // GET /auth/me y /cuenta/perfil: los datos de la cuenta, leídos de la base (el token no los trae todos)
  async cuentaDe(id: string): Promise<UsuarioResponseDto> {
    const usuario = await this.buscarPorId(id);
    if (!usuario) throw new NoAutenticadoException('El token no es válido o venció: inicia sesión de nuevo');
    return this.aRespuesta(usuario);
  }

  // ───────────────────────── Apoyo ─────────────────────────

  aRespuesta(u: Usuario): UsuarioResponseDto {
    return {
      id: u.id,
      email: u.email,
      nombre: u.nombre,
      apellido: u.apellido,
      rol: u.rol,
      estado: u.estado,
      createdAt: new Date(u.createdAt).toISOString(),
    };
  }

  private exigirCuentaActiva(cuenta: { estado: EstadoUsuario }): void {
    if (cuenta.estado === EstadoUsuario.PENDIENTE) {
      throw new ProhibidoException('Tu cuenta de administrador está pendiente de aprobación por el superadmin', 'ACCOUNT_PENDING');
    }
    if (cuenta.estado === EstadoUsuario.SUSPENDIDO) {
      throw new ProhibidoException('Tu cuenta está suspendida', 'ACCOUNT_SUSPENDED');
    }
  }

  private buscarPorId(id: string): Promise<Usuario | null> {
    // Un sub que no sea UUID (token manipulado con la firma correcta, imposible hoy) no debe llegar a PostgreSQL.
    return ES_UUID.test(id) ? this.repo.findOneBy({ id }) : Promise.resolve(null);
  }

  private extraerToken(cabecera: string | undefined): string | null {
    const partes = (cabecera ?? '').trim().split(/\s+/);
    return partes.length === 2 && /^bearer$/i.test(partes[0]) ? partes[1] : null;
  }

  private normalizarCorreo(correo: string): string {
    return correo.trim().toLowerCase();
  }

  private relleno(): Promise<string> {
    this.hashDeRelleno ??= bcrypt.hash('relleno-sin-usuario', COSTE_BCRYPT);
    return this.hashDeRelleno;
  }
}
