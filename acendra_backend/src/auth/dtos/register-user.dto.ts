
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsStrongPassword,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    description: 'Full name of the user',
    example: 'John Doe',
    minLength: 2,
    maxLength: 100,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(2, 100)
  name: string;

  @ApiProperty({
    description: 'Email address used to register the account',
    example: 'john.doe@example.com',
    maxLength: 254,
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiPropertyOptional({
    description:
      'Optional username containing only lowercase letters, numbers, and underscores',
    example: 'john_doe123',
    minLength: 3,
    maxLength: 30,
    pattern: '^[a-z0-9_]+$',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsOptional()
  @IsString()
  @Length(3, 30)
  @Matches(/^[a-z0-9_]+$/, {
    message:
      'Username may contain only lowercase letters, numbers, and underscores',
  })
  username?: string;

  @ApiProperty({
    description:
      'Password requiring at least 12 characters, one lowercase letter, one uppercase letter, one number, and one symbol. Maximum length is 72 characters.',
    example: 'SecurePass123!',
    minLength: 12,
    maxLength: 72,
    format: 'password',
    writeOnly: true,
  })
  @IsString()
  @MaxLength(72)
  @IsStrongPassword({
    minLength: 12,
    minLowercase: 1,
    minUppercase: 1,
    minNumbers: 1,
    minSymbols: 1,
  })
  password: string;
}
