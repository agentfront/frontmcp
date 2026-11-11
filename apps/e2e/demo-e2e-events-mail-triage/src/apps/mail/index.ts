import { App } from '@frontmcp/sdk';

import { emailImportant } from './events/email-important.event';
import MailClassifierPlugin from './plugins/mail-classifier.plugin';
import SimulateIncomingMailTool from './tools/simulate-incoming-mail.tool';

/** The mail event, its classifier and the demo tool. */
@App({
  name: 'mail',
  description: 'Tells each user about the important mail of their own mailbox',
  events: [emailImportant],
  tools: [SimulateIncomingMailTool],
  plugins: [MailClassifierPlugin],
})
export class MailApp {}
