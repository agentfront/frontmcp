import { App } from '@frontmcp/sdk';
import { DeployAlertChannel } from './channels/deploy-alert.channel';
import { ErrorAlertChannel } from './channels/error-alert.channel';
import { ChatBridgeChannel } from './channels/chat-bridge.channel';
import { ManualStatusChannel } from './channels/manual-status.channel';
import { MessagingServiceChannel } from './channels/messaging-service.channel';
import { ReplayAlertChannel } from './channels/replay-alert.channel';
import { FileWatcherChannel } from './channels/file-watcher.channel';
import EmitAppEventTool from './tools/emit-app-event.tool';
import SendChannelNotificationTool from './tools/send-channel-notification.tool';
import ListReplyLogTool from './tools/list-reply-log.tool';
import SimulateIncomingTool, { ListSentMessagesTool } from './tools/simulate-incoming.tool';
import { GetReplayBufferTool, ClearReplayBufferTool } from './tools/replay-tools.tool';
import SimulateFileEventTool from './tools/file-watcher-tools.tool';
import {
  RegisterTestSessionTool,
  UnregisterTestSessionTool,
  GetSessionNotificationsTool,
  ClearSessionNotificationsTool,
  ManageChannelSubscriptionTool,
  PushTargetedNotificationTool,
} from './tools/session-tools.tool';

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
  tools: [
    EmitAppEventTool,
    SendChannelNotificationTool,
    ListReplyLogTool,
    SimulateIncomingTool,
    ListSentMessagesTool,
    GetReplayBufferTool,
    ClearReplayBufferTool,
    SimulateFileEventTool,
    RegisterTestSessionTool,
    UnregisterTestSessionTool,
    GetSessionNotificationsTool,
    ClearSessionNotificationsTool,
    ManageChannelSubscriptionTool,
    PushTargetedNotificationTool,
  ],
})
export class ChannelsApp {}
