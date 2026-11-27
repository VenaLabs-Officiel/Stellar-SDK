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

/** Exact host names accepted for a video, mapped to the host of the embed player */
const YOUTUBE_EMBED_HOSTS: Record<string, string> = {
  'youtube.com': 'www.youtube.com',
  'www.youtube.com': 'www.youtube.com',
  'm.youtube.com': 'www.youtube.com',
  'music.youtube.com': 'www.youtube.com',
  'youtu.be': 'www.youtube.com',
  'www.youtu.be': 'www.youtube.com',
  // Privacy-enhanced player: kept as chosen by the course author
  'youtube-nocookie.com': 'www.youtube-nocookie.com',
  'www.youtube-nocookie.com': 'www.youtube-nocookie.com',
};
const YOUTUBE_SHORT_HOSTS = ['youtu.be', 'www.youtu.be'];
const YOUTUBE_ID_PATH_PREFIXES = ['embed', 'shorts', 'live', 'v'];
const YOUTUBE_ID_PATTERN = /^[A-Za-z0-9_-]{6,20}$/;
/** Path words that match the id pattern but designate a playlist, not a video */
const YOUTUBE_NON_VIDEO_IDS = ['videoseries'];
const YOUTUBE_DURATION_PATTERN = /^(?:(\d{1,3})h)?(?:(\d{1,5})m)?(?:(\d{1,6})s)?$/;
const YOUTUBE_MAX_START_SECONDS = 24 * 60 * 60;

const VIMEO_HOSTS = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];
const VIMEO_ID_PATTERN = /^\d+$/;
/** Privacy hash of an unlisted Vimeo video */
const VIMEO_HASH_PATTERN = /^[A-Za-z0-9]{4,40}$/;

/**
 * Read a YouTube start time (`start=90`, `t=90`, `t=90s`, `t=1m30s`) as a
 * number of seconds, or null when it is absent or not a plain duration.
 */
function parseYoutubeStart(params: URLSearchParams): number | null {
  const raw = (params.get('start') ?? params.get('t') ?? '').trim().toLowerCase();
  if (raw === '') {
    return null;
  }

  let seconds: number;
  if (/^\d{1,6}$/.test(raw)) {
    seconds = Number(raw);
  } else {
    const match = YOUTUBE_DURATION_PATTERN.exec(raw);
    if (!match) {
      return null;
    }
    seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  }

  return seconds > 0 && seconds <= YOUTUBE_MAX_START_SECONDS ? seconds : null;
}

function getYoutubeEmbedUrl(url: URL, host: string, segments: string[]): string | null {
  const embedHost = YOUTUBE_EMBED_HOSTS[host];
  if (!embedHost) {
    return null;
  }

  let id: string | null | undefined;
  if (YOUTUBE_SHORT_HOSTS.includes(host)) {
    id = segments[0];
  } else {
    const [prefix, pathId] = segments;
    id =
      url.searchParams.get('v') ??
      (prefix && YOUTUBE_ID_PATH_PREFIXES.includes(prefix) ? pathId : null);
  }
  // A playlist without a video id cannot be rebuilt from an id: not embedded
  if (!id || !YOUTUBE_ID_PATTERN.test(id) || YOUTUBE_NON_VIDEO_IDS.includes(id)) {
    return null;
  }

  const start = parseYoutubeStart(url.searchParams);
  return `https://${embedHost}/embed/${id}${start === null ? '' : `?start=${start}`}`;
}

function getVimeoEmbedUrl(url: URL, host: string, segments: string[]): string | null {
  if (!VIMEO_HOSTS.includes(host)) {
    return null;
  }

  let id: string | undefined;
  let pathHash: string | undefined;
  const first = segments[0];
  if (host !== 'player.vimeo.com' && first && VIMEO_ID_PATTERN.test(first)) {
    // vimeo.com/<id> or vimeo.com/<id>/<hash> (unlisted video)
    id = first;
    pathHash = segments[1];
  } else {
    id = [...segments].reverse().find((segment) => VIMEO_ID_PATTERN.test(segment));
  }
  if (!id) {
    return null;
  }

  const hash = url.searchParams.get('h') ?? pathHash;
  const safeHash = hash && VIMEO_HASH_PATTERN.test(hash) ? hash : null;
  return `https://player.vimeo.com/video/${id}${safeHash ? `?h=${safeHash}` : ''}`;
}

/**
 * Build the embed URL of a YouTube or Vimeo video.
 *
 * Only these two providers are embedded, matched on their exact host names.
 * The embed URL is rebuilt from validated parts only: the video id, the start
 * time of a YouTube video (`start` / `t`) and the hash of an unlisted Vimeo
 * video (`h`). Nothing else from the original URL reaches the iframe.
 *
 * @returns the embed URL, or null when the URL is not a recognised video
 * (including a YouTube playlist given without a video id)
 */
export function getVideoEmbedUrl(value: unknown): string | null {
  const safeUrl = getSafeHttpUrl(value);
  if (!safeUrl) {
    return null;
  }

  const url = new URL(safeUrl);
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split('/').filter(Boolean);

  return getYoutubeEmbedUrl(url, host, segments) ?? getVimeoEmbedUrl(url, host, segments);
}
