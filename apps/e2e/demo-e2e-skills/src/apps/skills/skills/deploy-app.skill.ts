import { Skill } from '@frontmcp/sdk';

/**
 * Deploy Skill - demonstrates skill with mixed tool availability
 */
@Skill({
  name: 'deploy-app',
  description: 'Deploy application to production environment',
  instructions: `
## Deployment Process

1. Run pre-deployment checks
2. Build the application using docker_build
3. Push to registry using docker_push
4. Deploy to Kubernetes using k8s_apply
5. Notify team of completion

### Safety Checks
- Verify all tests pass
- Check for security vulnerabilities
- Confirm rollback strategy
  `,
  tools: [
    { name: 'docker_build', purpose: 'Build Docker image', required: true },
    { name: 'docker_push', purpose: 'Push image to registry', required: true },
    { name: 'k8s_apply', purpose: 'Apply Kubernetes manifests', required: true },
    { name: 'slack_notify', purpose: 'Notify team of deployment status' },
  ],
  tags: ['deployment', 'devops', 'kubernetes'],
  priority: 10, // Higher priority for deployment workflows
})
export class DeploySkill {}
