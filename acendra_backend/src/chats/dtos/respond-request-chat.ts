import { IsIn } from 'class-validator';

export class RespondChatRequestDto {
  @IsIn(['ACCEPTED', 'REJECTED'])
  status: 'ACCEPTED' | 'REJECTED';
}