import React from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { styled } from '@mui/material/styles';
import { createLazyImport, runtimeImportWithFallback, esmShUrl } from '../common/lazy-import';
import { useLazyModule } from '../common/use-lazy-module';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Detection
// ============================================

const VIDEO_PATTERNS = [
  /^https?:\/\/.+\.(?:mp4|webm|ogg|mov)(?:\?.*)?$/i,
  /^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|vimeo\.com)\//i,
  /^data:video\//,
];

const AUDIO_PATTERNS = [
  /^https?:\/\/.+\.(?:mp3|wav|ogg|aac|flac|m4a)(?:\?.*)?$/i,
  /^https?:\/\/(?:www\.)?soundcloud\.com\//i,
  /^data:audio\//,
];

export function isVideo(content: string): boolean {
  const trimmed = content.trim();
  return VIDEO_PATTERNS.some((p) => p.test(trimmed));
}

export function isAudio(content: string): boolean {
  const trimmed = content.trim();
  return AUDIO_PATTERNS.some((p) => p.test(trimmed));
}

export function isMedia(content: string): boolean {
  return isVideo(content) || isAudio(content);
}

// ============================================
// Lazy Import
// ============================================

/* eslint-disable @typescript-eslint/no-explicit-any */
interface ReactPlayerModule {
  default: React.ComponentType<any>;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

const lazyReactPlayer = createLazyImport<ReactPlayerModule>('react-player', async () => {
  const mod = await runtimeImportWithFallback(
    'react-player',
    esmShUrl('react-player@2', { external: ['react', 'react-dom'] }),
  );
  return mod as unknown as ReactPlayerModule;
});

// ============================================
// Styled Components
// ============================================

const MediaRoot = styled(Paper, {
  name: 'FrontMcpMedia',
  slot: 'Root',
})(({ theme }) => ({
  overflow: 'hidden',
  borderRadius: theme.shape.borderRadius,
}));

const VideoWrapper = styled(Box)({
  position: 'relative',
  paddingTop: '56.25%', // 16:9 aspect ratio
  '& > *': {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});

const AudioWrapper = styled(Box)(({ theme }) => ({
  padding: theme.spacing(1),
  '& > *': {
    width: '100%',
  },
}));

// ============================================
// Component
// ============================================

interface MediaViewProps {
  url: string;
  isAudioContent: boolean;
  className?: string;
}

function MediaView({ url, isAudioContent, className }: MediaViewProps): React.ReactElement {
  const reactPlayerMod = useLazyModule(lazyReactPlayer);

  if (!reactPlayerMod) {
    // Fallback: native HTML5 elements
    if (isAudioContent) {
      return React.createElement(
        MediaRoot,
        { variant: 'outlined', className },
        React.createElement(
          AudioWrapper,
          null,
          React.createElement('audio', { controls: true, src: url, style: { width: '100%' } }),
        ),
      );
    }

    return React.createElement(
      MediaRoot,
      { variant: 'outlined', className },
      React.createElement(
        VideoWrapper,
        null,
        React.createElement('video', {
          controls: true,
          src: url,
          style: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
        }),
      ),
    );
  }

  const ReactPlayer = reactPlayerMod.default;

  if (isAudioContent) {
    return React.createElement(
      MediaRoot,
      { variant: 'outlined', className },
      React.createElement(
        AudioWrapper,
        null,
        React.createElement(ReactPlayer, {
          url,
          controls: true,
          width: '100%',
          height: 50,
        }),
      ),
    );
  }

  return React.createElement(
    MediaRoot,
    { variant: 'outlined', className },
    React.createElement(
      VideoWrapper,
      null,
      React.createElement(ReactPlayer, {
        url,
        controls: true,
        width: '100%',
        height: '100%',
      }),
    ),
  );
}

// Eagerly start loading react-player
lazyReactPlayer.load().catch(() => {
  /* optional dep */
});

// ============================================
// Renderers
// ============================================

export class VideoRenderer implements ContentRenderer {
  readonly type = 'video';
  readonly priority = 20;

  canHandle(content: string): boolean {
    return isVideo(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(MediaView, {
      url: content.trim(),
      isAudioContent: false,
      className: options?.className ?? 'fmcp-media-content',
    });
  }
}

export class AudioRenderer implements ContentRenderer {
  readonly type = 'audio';
  readonly priority = 20;

  canHandle(content: string): boolean {
    return isAudio(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    return React.createElement(MediaView, {
      url: content.trim(),
      isAudioContent: true,
      className: options?.className ?? 'fmcp-media-content',
    });
  }
}

export const videoRenderer = new VideoRenderer();
export const audioRenderer = new AudioRenderer();
