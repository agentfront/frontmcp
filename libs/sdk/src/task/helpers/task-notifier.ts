/**
 * Task status notifier — bridges TaskRecord state transitions to
 * `notifications/tasks/status` delivery via the SDK notification service.
 *
 * Per spec §Task Notifications, the notification MUST carry the full Task
 * wire shape, and SHOULD NOT include `io.modelcontextprotocol/related-task`
 * in `_meta` (the `taskId` field on the params is the source of truth).
 *
 * @module task/helpers/task-notifier
 */

import type { FrontMcpLogger } from '../../common';
import type { NotificationService } from '../../notification/notification.service';
import { toWireShape, type TaskRecord } from '../task.types';

export class TaskNotifier {
  constructor(
    private readonly notifications: NotificationService,
    private readonly logger?: FrontMcpLogger,
  ) {}

  sendStatus(record: TaskRecord): void {
    const params = {
      ...toWireShape(record),
    };
    try {
      this.notifications.sendNotificationToSession(
        record.sessionId,
        'notifications/tasks/status',
        params as Record<string, unknown>,
      );
    } catch (err) {
      // Notifications are best-effort per spec; log and continue.
      this.logger?.warn('[TaskNotifier] sendStatus failed', {
        taskId: record.taskId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
