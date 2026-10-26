import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class SendChatRequestDto {
  @IsUUID()
  receiverId: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}