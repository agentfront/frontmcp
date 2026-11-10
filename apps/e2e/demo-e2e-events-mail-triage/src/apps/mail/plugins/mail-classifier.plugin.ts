import { EventPublishHook, Plugin, type FlowCtxOf } from '@frontmcp/sdk';

/** What makes a message important: a word of its subject, or who sent it. */
const IMPORTANT_SUBJECT = /\b(urgent|outage|invoice|contract)\b/i;
const IMPORTANT_SENDERS = /@(board|legal)\.example\.com$/i;

/** Whether a message is important enough to tell its owner about. */
export function isImportant(mail: { from: string; subject: string }): boolean {
  return IMPORTANT_SUBJECT.test(mail.subject) || IMPORTANT_SENDERS.test(mail.from);
}

/**
 * Classifies each `email.important` before anything is done with it: an unimportant message ends the publish, so it
 * is neither delivered, buffered for polls, nor streamed.
 */
@Plugin({ name: 'mail-classifier', description: 'Drops the unimportant mail before it is published' })
export default class MailClassifierPlugin {
  /** End the publish of a message the classifier finds unimportant, with no delivery. */
  @EventPublishHook.Will('bufferOccurrence')
  dropUnimportantMail(ctx: FlowCtxOf<'events:publish'>) {
    const { occurrence } = ctx.rawInput;
    if (occurrence.name !== 'email.important') return;
    const mail = occurrence.data as { from: string; subject: string };
    if (!isImportant(mail)) ctx.respond({ eventId: occurrence.eventId, matched: 0 });
  }
}
