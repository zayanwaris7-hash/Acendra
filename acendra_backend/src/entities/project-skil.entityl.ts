

import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Project } from './projects.entity.js';
import { Skill } from './skill.entity.js';

@Entity('project_skills')
@Index(['projectId', 'skillId'], { unique: true })
export class ProjectSkill {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  projectId: string;

  @ManyToOne(() => Project, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column({ type: 'uuid' })
  skillId: string;

  @ManyToOne(() => Skill, {
    onDelete: 'RESTRICT',
  })
  @JoinColumn({ name: 'skillId' })
  skill: Skill;

  @CreateDateColumn()
  createdAt: Date;
}
