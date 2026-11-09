import { ApiProperty } from '@nestjs/swagger';

export class PaginatedResponseDto<T> {
  @ApiProperty({ description: 'Datos devueltos de la página actual' })
  data: T[];

  @ApiProperty({ description: 'Información de metadatos de la paginación' })
  meta: {
    totalItems: number;
    itemCount: number;
    itemsPerPage: number;
    totalPages: number;
    currentPage: number;
  };

  @ApiProperty({ description: 'HATEOAS links para navegación' })
  _links: {
    first: string;
    previous?: string;
    next?: string;
    last: string;
  };
}
