import type { SkillsResponse } from '@claude-chat/protocol';
import type { FastifyInstance } from 'fastify';

import type { SkillService } from '../skills/skill-service.js';

type SkillRouteOptions = {
  skills: SkillService;
};

export function registerSkillRoutes(app: FastifyInstance, { skills }: SkillRouteOptions): void {
  app.get('/v1/skills', async (): Promise<SkillsResponse> => ({
    skills: skills.list(),
  }));
}
