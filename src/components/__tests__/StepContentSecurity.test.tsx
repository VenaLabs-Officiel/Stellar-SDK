import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StepContent } from '../ui/StepContent';
import type { VenalabsCourseStep } from '../../types';

function textStepWithLink(href: unknown): VenalabsCourseStep {
  return {
    id: 'step-1',
    title: { en: 'Read' },
    type: 'TEXT',
    order: 0,
    textContent: {
      content: {
        en: [
          {
            id: 'block-1',
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Before ' },
              { type: 'link', href, content: [{ type: 'text', text: 'the link' }] },
            ],
          },
        ],
      },
    },
  };
}

function videoStep(videoUrl: string): VenalabsCourseStep {
  return {
    id: 'step-1',
    title: { en: 'Watch' },
    type: 'VIDEO',
    order: 0,
    videoContent: { videoUrl },
  };
}

const renderStep = (step: VenalabsCourseStep) =>
  render(<StepContent step={step} onComplete={vi.fn()} isCompleted={false} />);

describe('Course content: links', () => {
  it.each([
    ['javascript:alert(document.cookie)'],
    ['JaVaScRiPt:alert(1)'],
    ['  javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html,<script>alert(1)</script>'],
    ['vbscript:msgbox(1)'],
    ['file:///etc/passwd'],
    ['//evil.example/path'],
    ['/relative/path'],
    ['not a url'],
    [''],
    [undefined],
    [42],
  ])('does not render %j as a link', (href) => {
    renderStep(textStepWithLink(href));

    // The text is kept, without any anchor around it
    expect(screen.getByText('the link')).toBeInTheDocument();
    expect(document.querySelector('a')).not.toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/script:/i);
  });

  it.each([['https://stellar.org/learn'], ['http://example.com/page?x=1#top']])(
    'renders %s as an external link that cannot reach the opener',
    (href) => {
      renderStep(textStepWithLink(href));

      const link = screen.getByRole('link', { name: 'the link' });
      expect(link).toHaveAttribute('href', href);
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  );
});

describe('Course content: mailto and tel links', () => {
  it.each([
    ['mailto:support@example.com'],
    ['mailto:a@example.com?subject=Hello'],
    ['tel:+33123456789'],
  ])('renders %s as a link that stays in the current tab', (href) => {
    renderStep(textStepWithLink(href));

    const link = screen.getByRole('link', { name: 'the link' });
    expect(link).toHaveAttribute('href', href);
    expect(link).not.toHaveAttribute('target');
  });

  it.each([
    ['MAILTO:support@example.com', 'MAILTO:support@example.com'],
    ['  tel:+33123456789 ', 'tel:+33123456789'],
  ])('accepts %j whatever its case or surrounding spaces', (href, expected) => {
    renderStep(textStepWithLink(href));

    expect(screen.getByRole('link', { name: 'the link' })).toHaveAttribute('href', expected);
  });

  it.each([
    ['sms:+33123456789'],
    ['ftp://example.com/file'],
    ['blob:https://example.com/id'],
    ['mailto'],
    ['tel'],
  ])('still renders %j as plain text', (href) => {
    renderStep(textStepWithLink(href));

    expect(screen.getByText('the link')).toBeInTheDocument();
    expect(document.querySelector('a')).not.toBeInTheDocument();
  });
});

describe('Course content: video embeds', () => {
  const iframeSrc = () => document.querySelector('iframe')?.getAttribute('src');

  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    ['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ'],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    ['https://vimeo.com/123456789', 'https://player.vimeo.com/video/123456789'],
    ['https://player.vimeo.com/video/123456789', 'https://player.vimeo.com/video/123456789'],
    ['https://vimeo.com/channels/staffpicks/123456789', 'https://player.vimeo.com/video/123456789'],
  ])('embeds %s', (videoUrl, expected) => {
    renderStep(videoStep(videoUrl));

    expect(iframeSrc()).toBe(expected);
  });

  it.each([
    [
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=42',
    ],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'https://www.youtube.com/embed/dQw4w9WgXcQ?start=10'],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1h2m3s',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=3723',
    ],
    [
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=90',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=90',
    ],
    // Anything that is not a plain duration is dropped, the video still plays
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t="><script>',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=-5',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&autoplay=1&t=5',
      'https://www.youtube.com/embed/dQw4w9WgXcQ?start=5',
    ],
  ])('keeps the start time of %s and nothing else', (videoUrl, expected) => {
    renderStep(videoStep(videoUrl));

    expect(iframeSrc()).toBe(expected);
  });

  it.each([
    [
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
    ],
    [
      'https://youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=30',
    ],
  ])('keeps the privacy-enhanced player of %s', (videoUrl, expected) => {
    renderStep(videoStep(videoUrl));

    expect(iframeSrc()).toBe(expected);
  });

  it.each([
    [
      'https://player.vimeo.com/video/123456789?h=abc123def4',
      'https://player.vimeo.com/video/123456789?h=abc123def4',
    ],
    [
      'https://vimeo.com/123456789/abc123def4',
      'https://player.vimeo.com/video/123456789?h=abc123def4',
    ],
    [
      'https://vimeo.com/123456789?h=abc123def4&autoplay=1',
      'https://player.vimeo.com/video/123456789?h=abc123def4',
    ],
    // A hash that is not alphanumeric is dropped
    [
      'https://player.vimeo.com/video/123456789?h="><script>',
      'https://player.vimeo.com/video/123456789',
    ],
  ])('keeps the hash of the unlisted Vimeo video %s', (videoUrl, expected) => {
    renderStep(videoStep(videoUrl));

    expect(iframeSrc()).toBe(expected);
  });

  it.each([
    ['https://evil.example/video.html'],
    ['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['https://evil.example/?next=youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://evil.example/vimeo.com/123456789'],
    ['javascript:alert(1)//youtube.com'],
    ['data:text/html,<script>alert(1)</script>'],
    ['https://www.youtube.com/watch?v=<script>'],
    ['https://www.youtube.com/watch'],
    // Playlists without a video id cannot be embedded from the id alone
    ['https://www.youtube.com/playlist?list=PL1234567890'],
    ['https://www.youtube.com/watch?list=PL1234567890'],
    ['https://www.youtube.com/embed/videoseries?list=PL1234567890'],
    ['https://youtube-nocookie.com.evil.example/embed/dQw4w9WgXcQ'],
    ['https://music.youtube.com.evil.example/watch?v=dQw4w9WgXcQ'],
    ['https://evil.example/?youtube.com/watch?v=dQw4w9WgXcQ'],
    ['https://youtube.com@evil.example/watch?v=dQw4w9WgXcQ'],
    ['https://player.vimeo.com.evil.example/video/123456789?h=abc123def4'],
    ['https://notvimeo.com/123456789'],
    ['https://vimeo.com/not-a-video'],
    [''],
  ])('does not embed %j', (videoUrl) => {
    renderStep(videoStep(videoUrl));

    expect(document.querySelector('iframe')).not.toBeInTheDocument();
    expect(screen.getByText('This video cannot be displayed.')).toBeInTheDocument();
    // The step can still be completed
    expect(screen.getByRole('button', { name: 'Mark as complete' })).toBeInTheDocument();
  });

  it.each([['youtube.com/watch?v=dQw4w9WgXcQ'], ['youtube.com'], ['http://[invalid']])(
    'does not crash on the malformed URL %j',
    (videoUrl) => {
      expect(() => renderStep(videoStep(videoUrl))).not.toThrow();
      expect(document.querySelector('iframe')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Mark as complete' })).toBeInTheDocument();
    }
  );
});
