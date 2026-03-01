/**
 * Media Renderer Tests
 */

import { VideoRenderer, AudioRenderer, isVideo, isAudio, isMedia } from '../media';

describe('Media Renderers', () => {
  describe('isVideo()', () => {
    it('should detect MP4 URLs', () => {
      expect(isVideo('https://example.com/video.mp4')).toBe(true);
    });

    it('should detect WebM URLs', () => {
      expect(isVideo('https://example.com/video.webm')).toBe(true);
    });

    it('should detect OGG video URLs', () => {
      expect(isVideo('https://example.com/video.ogg')).toBe(true);
    });

    it('should detect MOV URLs', () => {
      expect(isVideo('https://example.com/video.mov')).toBe(true);
    });

    it('should detect YouTube URLs', () => {
      expect(isVideo('https://www.youtube.com/watch?v=abc123')).toBe(true);
      expect(isVideo('https://youtu.be/abc123')).toBe(true);
    });

    it('should detect Vimeo URLs', () => {
      expect(isVideo('https://vimeo.com/123456')).toBe(true);
    });

    it('should detect video data URIs', () => {
      expect(isVideo('data:video/mp4;base64,...')).toBe(true);
    });

    it('should not detect non-video', () => {
      expect(isVideo('hello')).toBe(false);
      expect(isVideo('https://example.com/page')).toBe(false);
    });
  });

  describe('isAudio()', () => {
    it('should detect MP3 URLs', () => {
      expect(isAudio('https://example.com/song.mp3')).toBe(true);
    });

    it('should detect WAV URLs', () => {
      expect(isAudio('https://example.com/audio.wav')).toBe(true);
    });

    it('should detect OGG audio URLs', () => {
      expect(isAudio('https://example.com/audio.ogg')).toBe(true);
    });

    it('should detect AAC URLs', () => {
      expect(isAudio('https://example.com/audio.aac')).toBe(true);
    });

    it('should detect FLAC URLs', () => {
      expect(isAudio('https://example.com/audio.flac')).toBe(true);
    });

    it('should detect M4A URLs', () => {
      expect(isAudio('https://example.com/audio.m4a')).toBe(true);
    });

    it('should detect SoundCloud URLs', () => {
      expect(isAudio('https://www.soundcloud.com/artist/track')).toBe(true);
    });

    it('should detect audio data URIs', () => {
      expect(isAudio('data:audio/mp3;base64,...')).toBe(true);
    });

    it('should not detect non-audio', () => {
      expect(isAudio('hello')).toBe(false);
      expect(isAudio('https://example.com/page')).toBe(false);
    });
  });

  describe('isMedia()', () => {
    it('should detect video as media', () => {
      expect(isMedia('https://example.com/video.mp4')).toBe(true);
    });

    it('should detect audio as media', () => {
      expect(isMedia('https://example.com/song.mp3')).toBe(true);
    });

    it('should not detect non-media', () => {
      expect(isMedia('hello')).toBe(false);
    });
  });

  describe('VideoRenderer', () => {
    const renderer = new VideoRenderer();

    it('should have type "video"', () => {
      expect(renderer.type).toBe('video');
    });

    it('should have priority 20', () => {
      expect(renderer.priority).toBe(20);
    });

    it('should handle video URLs', () => {
      expect(renderer.canHandle('https://example.com/video.mp4')).toBe(true);
    });

    it('should not handle non-video', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });

    it('should render video element', () => {
      const element = renderer.render('https://example.com/video.mp4');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('https://example.com/video.mp4');
      expect(element.props.className).toBe('fmcp-media-content');
    });
  });

  describe('AudioRenderer', () => {
    const renderer = new AudioRenderer();

    it('should have type "audio"', () => {
      expect(renderer.type).toBe('audio');
    });

    it('should have priority 20', () => {
      expect(renderer.priority).toBe(20);
    });

    it('should handle audio URLs', () => {
      expect(renderer.canHandle('https://example.com/song.mp3')).toBe(true);
    });

    it('should not handle non-audio', () => {
      expect(renderer.canHandle('hello')).toBe(false);
    });

    it('should render audio element', () => {
      const element = renderer.render('https://example.com/song.mp3');
      expect(element).toBeTruthy();
    });

    it('should use default className', () => {
      const element = renderer.render('https://example.com/song.mp3');
      expect(element.props.className).toBe('fmcp-media-content');
    });
  });
});
