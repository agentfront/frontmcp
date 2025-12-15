import { Prompt, PromptContext, GetPromptResult } from '@frontmcp/sdk';
import { deploymentTracker } from '../data/deployment-tracker';

@Prompt({
  name: 'deployment-check',
  description: 'Check serverless deployment status and configuration',
  arguments: [{ name: 'verbose', description: 'Include detailed environment info (true/false)', required: false }],
})
export default class DeploymentCheckPrompt extends PromptContext {
  async execute(args: Record<string, string>): Promise<GetPromptResult> {
    const tracker = deploymentTracker;
    const verbose = args['verbose'] === 'true';
    const stats = tracker.getStats();
    const isServerless = process.env['FRONTMCP_SERVERLESS'] === '1';

    const platform = this.detectPlatform();
    const healthStatus = this.getHealthStatus(stats);

    let content = `# Deployment Check

## Status
- **Health**: ${healthStatus}
- **Mode**: ${isServerless ? 'Serverless' : 'Standard Server'}
- **Platform**: ${platform}
- **Runtime**: Node.js ${process.version}

## Statistics
- **Total Invocations**: ${stats.totalInvocations}
- **Cold Starts**: ${stats.coldStarts}
- **Warm Starts**: ${stats.warmStarts}
- **Average Duration**: ${stats.averageDuration}ms
- **Uptime**: ${this.formatUptime(stats.uptime)}`;

    if (verbose) {
      const mem = process.memoryUsage();
      content += `

## Environment Details
- **PID**: ${process.pid}
- **Architecture**: ${process.arch}
- **Platform**: ${process.platform}

## Memory Usage
- **RSS**: ${Math.round(mem.rss / (1024 * 1024))}MB
- **Heap Total**: ${Math.round(mem.heapTotal / (1024 * 1024))}MB
- **Heap Used**: ${Math.round(mem.heapUsed / (1024 * 1024))}MB

## Recent Invocations
${tracker
  .getRecentInvocations(5)
  .map((inv) => `- ${inv.id}: ${inv.isColdStart ? '❄️ Cold' : '🔥 Warm'} (${inv.duration}ms)`)
  .join('\n')}`;
    }

    return {
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: content,
          },
        },
      ],
      description: `Deployment check: ${healthStatus}`,
    };
  }

  private detectPlatform(): string {
    if (process.env['VERCEL']) return 'Vercel';
    if (process.env['AWS_LAMBDA_FUNCTION_NAME']) return 'AWS Lambda';
    if (process.env['CF_PAGES']) return 'Cloudflare Pages';
    if (process.env['NETLIFY']) return 'Netlify';
    if (process.env['NODE_ENV'] === 'test') return 'Test Environment';
    return 'Local Development';
  }

  private getHealthStatus(stats: { totalInvocations: number; averageDuration: number }): string {
    if (stats.averageDuration > 1000) return '⚠️ Slow';
    if (stats.totalInvocations === 0) return '🆕 New';
    return '✅ Healthy';
  }

  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }
}
