
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { StudentProfile } from './student-profile.entity.js';
import { Skill } from './skill.entity.js';

export enum SkillProficiency {
  BEGINNER = 'BEGINNER',
  INTERMEDIATE = 'INTERMEDIATE',
  ADVANCED = 'ADVANCED',
  EXPERT = 'EXPERT',
}

@Entity('student_skills')
@Index(['studentProfileId', 'skillId'], { unique: true })
export class StudentSkill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  studentProfileId: string;

  @ManyToOne(() => StudentProfile, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'studentProfileId' })
  studentProfile: StudentProfile;

  @Column({ type: 'uuid' })
  skillId: string;

  @ManyToOne(() => Skill, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'skillId' })
  skill: Skill;

  @Column({
    type: 'enum',
    enum: SkillProficiency,
    default: SkillProficiency.BEGINNER,
  })
  proficiency: SkillProficiency;

  @Column({ type: 'decimal', precision: 4, scale: 1, nullable: true })
  yearsOfExperience: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
