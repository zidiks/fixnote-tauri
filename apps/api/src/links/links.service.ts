import {
  BadGatewayException,
  BadRequestException,
  Injectable,
} from '@nestjs/common';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface LinkPreview {
  title?: string;
  description?: string;
  imageUrl?: string;
  siteName?: string;
}

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 4;

@Injectable()
export class LinksService {
  async preview(rawUrl: string | undefined): Promise<LinkPreview> {
    const initialUrl = parseHttpUrl(rawUrl);
    const { html, finalUrl } = await fetchHtml(initialUrl);
    return extractLinkPreview(html, finalUrl);
  }
}

async function fetchHtml(
  initialUrl: URL,
): Promise<{ html: string; finalUrl: URL }> {
  let url = initialUrl;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertPublicUrl(url);
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(6_000),
        headers: {
          accept: 'text/html,application/xhtml+xml',
          'accept-language': 'en-US,en;q=0.9',
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        },
      });
    } catch {
      throw new BadGatewayException('Could not load link preview');
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location || redirect === MAX_REDIRECTS) {
        throw new BadGatewayException('Too many link redirects');
      }
      url = new URL(location, url);
      continue;
    }

    if (!response.ok) {
      throw new BadGatewayException(`Preview source returned ${response.status}`);
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
    if (!contentType.includes('text/html')) {
      throw new BadRequestException('Link does not point to an HTML page');
    }
    return { html: await readLimitedText(response), finalUrl: url };
  }
  throw new BadGatewayException('Could not resolve link preview');
}

async function readLimitedText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let total = 0;
  let html = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      break;
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

function parseHttpUrl(rawUrl: string | undefined): URL {
  if (!rawUrl) throw new BadRequestException('url is required');
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestException('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only HTTP links are supported');
  }
  return url;
}

async function assertPublicUrl(url: URL): Promise<void> {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new BadRequestException('Only HTTP links are supported');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local')
  ) {
    throw new BadRequestException('Local URLs are not supported');
  }
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new BadGatewayException('Could not resolve link host');
  }
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) {
    throw new BadRequestException('Private network URLs are not supported');
  }
}

function isPrivateIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) {
    const octets = address.split('.').map(Number);
    const a = octets[0] ?? -1;
    const b = octets[1] ?? -1;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith('::ffff:')) {
      const mappedAddress = normalized.slice('::ffff:'.length);
      if (isIP(mappedAddress) === 4) return isPrivateIp(mappedAddress);
    }
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    );
  }
  return true;
}

export function extractLinkPreview(html: string, pageUrl: URL): LinkPreview {
  const metadata = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? '');
    const key = (attributes.property ?? attributes.name)?.toLowerCase();
    const content = attributes.content?.trim();
    if (key && content && !metadata.has(key)) metadata.set(key, content);
  }

  const title = firstValue(
    metadata.get('og:title'),
    metadata.get('twitter:title'),
    titleFromHtml(html),
  );
  const description = firstValue(
    metadata.get('og:description'),
    metadata.get('twitter:description'),
    metadata.get('description'),
  );
  const image = firstValue(
    metadata.get('og:image:secure_url'),
    metadata.get('og:image'),
    metadata.get('og:image:url'),
    metadata.get('twitter:image'),
    metadata.get('twitter:image:src'),
    metadata.get('image'),
  );
  const imageUrl =
    (image ? resolveHttpUrl(image, pageUrl) : undefined) ??
    imageFromLinkTag(html, pageUrl) ??
    imageFromJsonLd(html, pageUrl) ??
    imageFromContent(html, pageUrl);
  const siteName = firstValue(
    metadata.get('og:site_name'),
    metadata.get('application-name'),
  );

  return {
    ...(title ? { title: cleanText(title, 180) } : {}),
    ...(description ? { description: cleanText(description, 420) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(siteName ? { siteName: cleanText(siteName, 80) } : {}),
  };
}

function imageFromLinkTag(html: string, pageUrl: URL): string | undefined {
  for (const match of html.matchAll(/<link\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? '');
    const rel = attributes.rel?.toLowerCase().split(/\s+/) ?? [];
    if (!rel.includes('image_src')) continue;
    const imageUrl = attributes.href
      ? resolveHttpUrl(attributes.href, pageUrl)
      : undefined;
    if (imageUrl) return imageUrl;
  }
  return undefined;
}

function imageFromJsonLd(html: string, pageUrl: URL): string | undefined {
  for (const match of html.matchAll(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
  )) {
    const attributes = parseAttributes(match[1] ?? '');
    if (attributes.type?.toLowerCase() !== 'application/ld+json') continue;
    try {
      const value: unknown = JSON.parse(match[2] ?? '');
      const candidate = findJsonLdImage(value);
      const imageUrl = candidate
        ? resolveHttpUrl(candidate, pageUrl)
        : undefined;
      if (imageUrl) return imageUrl;
    } catch {
      // Invalid third-party JSON-LD should not discard the rest of the page.
    }
  }
  return undefined;
}

function findJsonLdImage(value: unknown): string | undefined {
  if (typeof value === 'string') return undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = findJsonLdImage(entry);
      if (image) return image;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;
  for (const key of ['image', 'thumbnailUrl', 'thumbnail']) {
    const candidate = record[key];
    if (typeof candidate === 'string') return candidate;
    if (Array.isArray(candidate)) {
      const first = candidate.find(
        (entry): entry is string => typeof entry === 'string',
      );
      if (first) return first;
    }
    if (candidate && typeof candidate === 'object') {
      const url = (candidate as Record<string, unknown>).url;
      if (typeof url === 'string') return url;
    }
  }

  for (const child of Object.values(record)) {
    const image = findJsonLdImage(child);
    if (image) return image;
  }
  return undefined;
}

function imageFromContent(html: string, pageUrl: URL): string | undefined {
  let best: { url: string; score: number } | undefined;
  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    const attributes = parseAttributes(match[1] ?? '');
    const rawSource =
      attributes['data-src'] ??
      attributes['data-lazy-src'] ??
      attributes.src ??
      largestSrcsetEntry(attributes.srcset);
    if (!rawSource) continue;
    const url = resolveHttpUrl(rawSource, pageUrl);
    if (!url) continue;

    const searchable = `${url} ${attributes.class ?? ''} ${
      attributes.id ?? ''
    } ${attributes.alt ?? ''}`.toLowerCase();
    if (
      /(?:logo|icon|avatar|emoji|sprite|spacer|pixel|tracking|counter|captcha)/.test(
        searchable,
      )
    ) {
      continue;
    }

    const width = numericDimension(attributes.width);
    const height = numericDimension(attributes.height);
    if ((width !== undefined && width < 180) || (height !== undefined && height < 100)) {
      continue;
    }

    let score = 0;
    if (width && height) score += Math.min((width * height) / 500, 1_600);
    if (width && width >= 600) score += 220;
    if (height && height >= 300) score += 180;
    if (/(?:upload|media|content|article|news|post|images?)/.test(searchable)) {
      score += 320;
    }
    if (attributes.loading?.toLowerCase() === 'lazy') score += 40;

    if (!best || score > best.score) best = { url, score };
  }
  return best?.score && best.score >= 200 ? best.url : undefined;
}

function largestSrcsetEntry(value: string | undefined): string | undefined {
  return value
    ?.split(',')
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter((entry): entry is string => Boolean(entry))
    .at(-1);
}

function numericDimension(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const pattern =
    /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  for (const match of source.matchAll(pattern)) {
    const name = match[1]?.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4];
    if (name && value !== undefined) attributes[name] = decodeEntities(value);
  }
  return attributes;
}

function titleFromHtml(html: string): string | undefined {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match?.[1] ? decodeEntities(match[1]) : undefined;
}

function resolveHttpUrl(value: string, pageUrl: URL): string | undefined {
  try {
    const url = new URL(value, pageUrl);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

function firstValue(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find((value) => value?.trim())?.trim();
}

function cleanText(value: string, maxLength: number): string {
  const text = decodeEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1).trimEnd()}…`
    : text;
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(
    /&(#x[\da-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code[0] === '#') {
        const numeric =
          code[1]?.toLowerCase() === 'x'
            ? Number.parseInt(code.slice(2), 16)
            : Number.parseInt(code.slice(1), 10);
        return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
      }
      return named[code.toLowerCase()] ?? entity;
    },
  );
}
