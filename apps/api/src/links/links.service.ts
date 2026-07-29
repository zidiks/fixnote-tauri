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
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) FixNoteLinkPreview/0.1',
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
    metadata.get('twitter:image'),
    metadata.get('twitter:image:src'),
  );
  const imageUrl = image ? resolveHttpUrl(image, pageUrl) : undefined;
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
