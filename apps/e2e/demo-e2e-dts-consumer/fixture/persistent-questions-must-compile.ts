import 'reflect-metadata';

import {
  App,
  FrontMcp,
  LoopbackTokenAuth,
  questionInboxLink,
  QuestionPendingError,
  Tool,
  ToolContext,
  z,
  type ElicitOptions,
  type PeopleSession,
  type PersistentQuestion,
  type PersistOptions,
} from '@frontmcp/sdk';

@Tool({ name: 'approve-deploy', inputSchema: { version: z.string() } })
export class ApproveDeployTool extends ToolContext {
  async execute(input: { version: string }) {
    const persist: PersistOptions = { key: `deploy-${input.version}`, ttlMs: 86_400_000 };
    try {
      const answer = await this.elicit('Deploy?', z.object({ approve: z.boolean() }), { ttl: 60_000, persist });
      const approve: boolean | undefined = answer.content?.approve;
      return { approve };
    } catch (error) {
      if (error instanceof QuestionPendingError) return { waitingUntil: error.expiresAt };
      throw error;
    }
  }
}

@Tool({ name: 'inbox-link', inputSchema: {} })
export class InboxLinkTool extends ToolContext {
  async execute() {
    const link: { code: string; expiresAt: number; loginPath: string } = questionInboxLink(this);
    const bound = this.get(LoopbackTokenAuth).createCode({ subject: 'principal:alice' });
    return { link: link.loginPath, other: bound.code };
  }
}

export function subjectOf(person: PeopleSession): string | undefined {
  return person.subject;
}

export function waiting(questions: PersistentQuestion[]): string[] {
  return questions.filter((question) => !question.answered).map((question) => question.id);
}

@App({ name: 'questions', tools: [ApproveDeployTool, InboxLinkTool] })
class QuestionsApp {}

@FrontMcp({
  info: { name: 'questions', version: '1.0.0' },
  apps: [QuestionsApp],
  http: { auth: { people: 'loopback-token' } },
  elicitation: { enabled: true, persistent: true },
})
export class QuestionsServer {}

@FrontMcp({
  info: { name: 'questions-tuned', version: '1.0.0' },
  apps: [QuestionsApp],
  elicitation: {
    enabled: true,
    persistent: { ttlMs: 3_600_000, storage: { type: 'sqlite', sqlite: { path: '/var/lib/app/questions.sqlite' } } },
  },
})
export class TunedQuestionsServer {}

export class InvalidPersist {
  // @ts-expect-error persist needs a key
  static readonly noKey: ElicitOptions = { persist: { ttlMs: 1000 } };
}
