import { Resource, ResourceContext } from '@frontmcp/sdk';
import { z } from 'zod';
import { crmStore } from '../data/crm.store';

const outputSchema = z.object({
  users: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      company: z.string(),
      role: z.string(),
      createdAt: z.string(),
    }),
  ),
  totalCount: z.number(),
});

@Resource({
  uri: 'crm://users',
  name: 'All CRM Users',
  description: 'List of all users in the CRM system',
  mimeType: 'application/json',
})
export default class UsersResource extends ResourceContext<Record<string, never>, z.infer<typeof outputSchema>> {
  async execute(): Promise<z.infer<typeof outputSchema>> {
    const users = crmStore.listUsers();
    return { users, totalCount: users.length };
  }
}
