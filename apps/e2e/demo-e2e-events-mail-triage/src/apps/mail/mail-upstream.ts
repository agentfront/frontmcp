/** A message as the mail provider reports it. */
export interface Mail {
  id: string;
  from: string;
  subject: string;
}

type MailListener = (mail: Mail) => void;

/**
 * A stand-in for a mail provider's push API (Gmail watch, Microsoft Graph subscriptions): per mailbox, a list of
 * listeners told about each new message. A real server would call the provider here.
 */
class MailUpstream {
  private readonly listeners = new Map<string, Set<MailListener>>();

  /** Start telling `listener` about the new mail of one mailbox; answers the function that stops it. */
  watch(mailbox: string, listener: MailListener): () => void {
    const listeners = this.listeners.get(mailbox) ?? new Set<MailListener>();
    listeners.add(listener);
    this.listeners.set(mailbox, listeners);
    return () => listeners.delete(listener);
  }

  /** How many watchers a mailbox has: the demo tool shows it. */
  watcherCount(mailbox: string): number {
    return this.listeners.get(mailbox)?.size ?? 0;
  }

  /** A message arrives in a mailbox: every watcher of that mailbox is told. */
  receive(mailbox: string, mail: Mail): void {
    for (const listener of this.listeners.get(mailbox) ?? []) listener(mail);
  }
}

export const mailUpstream = new MailUpstream();
