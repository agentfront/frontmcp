import { type Command } from 'commander';

import { c } from '../../core/colors';

export function registerInboxCommands(program: Command): void {
  program
    .command('inbox')
    .description('List and answer the questions a server keeps for you (open the inbox sign-in link it gave you)')
    .argument('<link>', 'The inbox sign-in link, or its path or code with --url')
    .option('--url <url>', "The server's URL, when <link> is a path or a code")
    .option('--answer <id>', 'Answer this question instead of listing them')
    .option('--content <json>', 'The answer to --answer, as JSON')
    .option('--decline', 'Decline the --answer question')
    .option('--cancel', 'Cancel the --answer question')
    .action(async (link: string, options: Record<string, unknown>) => {
      const { InboxError, runInbox } = await import('./inbox.js');
      try {
        await runInbox(link, options);
      } catch (error) {
        if (!(error instanceof InboxError)) throw error;
        console.error(c('red', error.message));
        process.exitCode = 1;
      }
    });
}
