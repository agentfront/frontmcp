import { App } from '@frontmcp/sdk';

import { ChatBridgeChannel } from './channels/chat-bridge.channel';
import { DeployAlertChannel } from './channels/deploy-alert.channel';
import { ErrorAlertChannel } from './channels/error-alert.channel';
import { FileWatcherChannel } from './channels/file-watcher.channel';
import { ManualStatusChannel } from './channels/manual-status.channel';
import { MessagingServiceChannel } from './channels/messaging-service.channel';
import { ReplayAlertChannel } from './channels/replay-alert.channel';
import { deployFinished, DeployStarted } from './events/deploy.events';
import EmitAppEventTool from './tools/emit-app-event.tool';
import ListReplyLogTool from './tools/list-reply-log.tool';
import PublishDeployEventTool from './tools/publish-deploy-event.tool';
import { ClearReplayBufferTool, GetReplayBufferTool } from './tools/replay-tools.tool';
import SendChannelNotificationTool from './tools/send-channel-notification.tool';
import {
  ClearSessionNotificationsTool,
  GetSessionNotificationsTool,
  ManageChannelSubscriptionTool,
  PushTargetedNotificationTool,
  RegisterTestSessionTool,
  UnregisterTestSessionTool,
} from './tools/session-tools.tool';
import SimulateIncomingTool, { ListSentMessagesTool } from './tools/simulate-incoming.tool';

@App({
  name: 'Channels',
  description: 'Channel system E2E testing app',
  channels: [
    DeployAlertChannel,
    ErrorAlertChannel,
    ChatBridgeChannel,
    ManualStatusChannel,
    MessagingServiceChannel,
    ReplayAlertChannel,
    FileWatcherChannel,
  ],
  events: [DeployStarted, deployFinished],
  tools: [
    EmitAppEventTool,
    PublishDeployEventTool,
    SendChannelNotificationTool,
    ListReplyLogTool,
    SimulateIncomingTool,
    ListSentMessagesTool,
    GetReplayBufferTool,
    ClearReplayBufferTool,
    RegisterTestSessionTool,
    UnregisterTestSessionTool,
    GetSessionNotificationsTool,
    ClearSessionNotificationsTool,
    ManageChannelSubscriptionTool,
    PushTargetedNotificationTool,
  ],
})
export class ChannelsApp {}
