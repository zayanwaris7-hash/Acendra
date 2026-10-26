import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('conversations')
@Index(['userOneId', 'userTwoId'], { unique: true })
export class Conversation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  userOneId: string;

  @Column({ type: 'uuid' })
  userTwoId: string;

  @Column({ type: 'timestamptz', nullable: true })
  lastMessageAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}