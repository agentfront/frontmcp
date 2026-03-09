import React, { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';
import Alert from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import type { ContentRenderer, RenderOptions } from '../types';

// ============================================
// Detection
// ============================================

const IMAGE_DATA_URI = /^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml|avif)[;,]/;
const IMAGE_URL = /^https?:\/\/.+\.(?:png|jpe?g|gif|webp|svg|avif|ico)(?:\?.*)?$/i;
const IMAGE_SERVICE_URL =
  /^https?:\/\/(?:picsum\.photos|images\.unsplash\.com|i\.imgur\.com|placekitten\.com|via\.placeholder\.com)\//i;

export function isImage(content: string): boolean {
  const trimmed = content.trim();
  return IMAGE_DATA_URI.test(trimmed) || IMAGE_URL.test(trimmed) || IMAGE_SERVICE_URL.test(trimmed);
}

// ============================================
// Styled Components
// ============================================

const ImageRoot = styled(Box, {
  name: 'FrontMcpImage',
  slot: 'Root',
})({
  display: 'inline-block',
  position: 'relative',
  maxWidth: '100%',
});

const StyledImage = styled('img', {
  name: 'FrontMcpImage',
  slot: 'Image',
})({
  maxWidth: '100%',
  height: 'auto',
  display: 'block',
  cursor: 'pointer',
  borderRadius: 'inherit',
});

const LightboxBackdrop = styled(Box, {
  name: 'FrontMcpImage',
  slot: 'Lightbox',
})({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 16,
});

const LightboxImage = styled('img')({
  maxWidth: '90vw',
  maxHeight: '90vh',
  objectFit: 'contain',
  borderRadius: 8,
});

// ============================================
// Component
// ============================================

interface LightboxOverlayProps {
  src: string;
  alt: string;
  onClose: () => void;
}

function LightboxOverlay({ src, alt, onClose }: LightboxOverlayProps): React.ReactElement {
  return React.createElement(
    LightboxBackdrop,
    {
      onClick: onClose,
      sx: {
        position: 'fixed',
        inset: 0,
        zIndex: 1300,
        bgcolor: 'rgba(0,0,0,0.8)',
      },
    },
    React.createElement(LightboxImage, { src, alt }),
  );
}

interface ImageViewProps {
  src: string;
  alt?: string;
  caption?: string;
  className?: string;
}

function ImageView({ src, alt, caption, className }: ImageViewProps): React.ReactElement {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const handleLoad = useCallback(() => setLoaded(true), []);
  const handleError = useCallback(() => {
    setLoaded(true);
    setError(true);
  }, []);

  if (error) {
    return React.createElement(Alert, { severity: 'error' }, `Failed to load image: ${src}`);
  }

  return React.createElement(
    ImageRoot,
    { className },
    !loaded && React.createElement(Skeleton, { variant: 'rectangular', width: 400, height: 300 }),
    React.createElement(StyledImage, {
      src,
      alt: alt ?? 'Image',
      onLoad: handleLoad,
      onError: handleError,
      onClick: () => setLightboxOpen(true),
      style: loaded ? undefined : { display: 'none' },
    }),
    caption &&
      React.createElement(
        Typography,
        { variant: 'caption', color: 'text.secondary', sx: { mt: 0.5, display: 'block', textAlign: 'center' } },
        caption,
      ),
    lightboxOpen &&
      React.createElement(LightboxOverlay, {
        src,
        alt: alt ?? 'Image',
        onClose: () => setLightboxOpen(false),
      }),
  );
}

// ============================================
// Renderer
// ============================================

export class ImageRenderer implements ContentRenderer {
  readonly type = 'image';
  readonly priority = 30;

  canHandle(content: string): boolean {
    return isImage(content);
  }

  render(content: string, options?: RenderOptions): React.ReactElement {
    const caption = options?.rendererOptions?.['caption'] as string | undefined;
    return React.createElement(ImageView, {
      src: content.trim(),
      alt: options?.toolName ?? 'Image',
      caption,
      className: options?.className ?? 'fmcp-image-content',
    });
  }
}

export const imageRenderer = new ImageRenderer();
