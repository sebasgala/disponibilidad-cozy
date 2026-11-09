import { ApiPropertyOptional } from '@nestjs/swagger';

export class BaseResponseDto {
  @ApiPropertyOptional({
    description: 'HATEOAS links (Richardson Maturity Model Level 3)',
    type: 'object',
    additionalProperties: {
      type: 'string',
      format: 'uri'
    }
  })
  _links?: Record<string, string>;
}
