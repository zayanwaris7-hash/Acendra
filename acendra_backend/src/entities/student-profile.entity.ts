
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { User } from './user.entity.js';


@Entity('student_profiles')
export class StudentProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  userId: string;

  @OneToOne(() => User, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({ type: 'varchar', length: 150, nullable: true })
  universityName: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  degreeProgram: string | null;

  @Column({ type: 'smallint', nullable: true })
  currentSemester: number | null;

  @Column({ type: 'smallint', nullable: true })
  graduationYear: number | null;

  @Column({ type: 'decimal', precision: 4, scale: 2, nullable: true })
  cgpa: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  city: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
