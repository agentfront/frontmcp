import React, { useRef, useState } from 'react';

import { event, useDomEventSource, useEventSubscription, usePublishEvent, z } from '@frontmcp/react';

/** A note added on the page: published in the page, delivered to the page's own subscriber. */
export const noteAdded = event({
  name: 'note.added',
  description: 'Fires when a note is added on the page',
  payloadSchema: { text: z.string() },
});

/** Publishes `note.added` from a hook and from a DOM event, and lists what its subscription receives. */
export function EventsSection(): React.ReactElement {
  const [notes, setNotes] = useState<string[]>([]);
  const button = useRef<HTMLButtonElement>(null);
  const publish = usePublishEvent();
  const { status, mode } = useEventSubscription('note.added', {}, (occurrence) =>
    setNotes((current) => [...current, String(occurrence.data['text'])]),
  );

  useDomEventSource(button, 'click', () => ({ name: 'note.added', data: { text: 'from a click' } }));

  return (
    <div>
      <p data-testid="events-status">
        {status}
        {mode ? ` (${mode})` : ''}
      </p>
      <button ref={button} data-testid="events-dom-button">
        Add from a click
      </button>
      <button data-testid="events-publish-button" onClick={() => void publish(noteAdded, { text: 'from the hook' })}>
        Add from the hook
      </button>
      <ul data-testid="events-notes">
        {notes.map((note, index) => (
          <li key={index}>{note}</li>
        ))}
      </ul>
    </div>
  );
}
