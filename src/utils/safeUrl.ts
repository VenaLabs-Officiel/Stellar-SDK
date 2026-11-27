/**
 * URL checks for course content.
 *
 * Course content is written in a back-office and rendered on third-party
 * sites: a link or a video URL must never be able to run script there.
 */

/**
 * Return the URL when it is an absolute http(s) URL, null otherwise
 * (javascript:, data:, relative or malformed URLs).
 */
export function getSafeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return null;
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  return url.protocol === 'http:' || url.protocol === 'https:' ? trimmed : null;
}

/** A link target that is safe to put in an `href` */
export interface SafeLink {
  href: string;
  /** True for http(s) links, which open in a new tab; false for mailto: and tel: */
  external: boolean;
}

/**
 * Return the link target when it is an absolute http(s) URL, a `mailto:` or a
 * `tel:` link, null otherwise (javascript:, data:, vbscript:, relative or
 * malformed URLs, any other scheme).
 */
export function getSafeLink(value: unknown): SafeLink | null {
  const httpUrl = getSafeHttpUrl(value);
  if (httpUrl) {
    return { href: httpUrl, external: true };
  }
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // An address or a number is required: "mailto:" alone is not a link
  if ((url.protocol === 'mailto:' || url.protocol === 'tel:') && url.pathname !== '') {
    return { href: trimmed, external: false };
  }
  return null;
}

const YOUTUBE_HOSTS = ['youtube.com', 'youtube-nocookie.com'];
const YOUTUBE_ID_PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
const VIMEO_HOSTS = ['vimeo.com', 'player.vimeo.com'];
const VIMEO_ID_PATTERN = /^\d+$/;

/**
 * Build the embed URL of a YouTube or Vimeo video.
 *
 * Only these two providers are embedded. The embed URL is rebuilt from the
 * video id alone, so nothing else from the original URL reaches the iframe.
 *
 * @returns the embed URL, or null when the URL is not a recognised video
 */
export function getVideoEmbedUrl(value: unknown): string | null {
  const safeUrl = getSafeHttpUrl(value);
  if (!safeUrl) {
    return null;
  }

  const url = new URL(safeUrl);
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const segments = url.pathname.split('/').filter(Boolean);

  let youtubeId: string | null | undefined;
  if (host === 'youtu.be') {
    youtubeId = segments[0];
  } else if (YOUTUBE_HOSTS.includes(host)) {
    const [prefix, id] = segments;
    youtubeId =
      url.searchParams.get('v') ??
      (prefix && YOUTUBE_ID_PATH_PREFIXES.includes(prefix) ? id : null);
  }
  if (youtubeId && YOUTUBE_ID_PATTERN.test(youtubeId)) {
    return `https://www.youtube.com/embed/${youtubeId}`;
  }

  if (VIMEO_HOSTS.includes(host)) {
    const vimeoId = [...segments].reverse().find((segment) => VIMEO_ID_PATTERN.test(segment));
    if (vimeoId) {
      return `https://player.vimeo.com/video/${vimeoId}`;
    }
  }

  return null;
}
