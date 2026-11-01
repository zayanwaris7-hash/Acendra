
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
} from 'class-validator';

export class GetIncomingRequestsDto {
  @ApiPropertyOptional({
    description: 'Number of requests to retrieve',
    default: 20,
    minimum: 1,
    maximum: 50,
  })
  @IsOptional()
  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  @Max(50)
  limit = 20;

  @ApiPropertyOptional({
    description: 'Cursor returned from the previous response',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  cursor?: string;
}
