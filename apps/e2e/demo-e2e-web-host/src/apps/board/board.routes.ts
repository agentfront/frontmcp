import { HttpRoute, HttpRouteContext } from '@frontmcp/sdk';

import { board, boardStore } from './board.store';
import { VisitCounter } from './visit-counter.provider';

@HttpRoute({ method: 'GET', path: '/board' })
export class BoardPage extends HttpRouteContext {
  async handle() {
    const { value } = await board.get();
    return { cards: value, visits: this.get(VisitCounter).record() };
  }
}

@HttpRoute({ method: 'POST', path: '/board/cards' })
export class AddCardRoute extends HttpRouteContext {
  async handle() {
    const title = String((this.request.body as { title?: unknown } | undefined)?.title ?? '');
    const snapshot = await board.update((cards) => [...cards, title]);
    return { revision: snapshot.revision };
  }
}

@HttpRoute({ method: 'GET', path: '/board/events', sse: { store: boardStore, topics: ['board'] } })
export class BoardEvents extends HttpRouteContext {
  async handle() {
    const { value, revision } = await board.get();
    return { cards: value, revision };
  }
}

@HttpRoute({ method: 'GET', path: '/status', auth: 'public' })
export class StatusRoute extends HttpRouteContext {
  handle() {
    return { ok: true };
  }
}
