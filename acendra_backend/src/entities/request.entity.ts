import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { ChatRequestStatus } from './enum/chat.enum.js';


@Entity('chat_requests')
@Index(['senderId', 'receiverId'])
@Index(['receiverId', 'status'])
export class ChatRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  senderId: string;

  @Column({ type: 'uuid' })
  receiverId: string;

  @Column({
    type: 'enum',
    enum: ChatRequestStatus,
    default: ChatRequestStatus.PENDING,
  })
  status: ChatRequestStatus;

  @Column({ type: 'text', nullable: true })
  message: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}