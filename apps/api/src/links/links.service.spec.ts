import assert from 'node:assert/strict';
import test from 'node:test';
import { extractLinkPreview } from './links.service.js';

test('extracts Open Graph metadata and resolves relative images', () => {
  const preview = extractLinkPreview(
    `
      <html>
        <head>
          <meta content="Fix &amp; ship" property="og:title">
          <meta name="description" content="A useful preview">
          <meta property="og:image" content="/social/card.jpg">
          <meta property="og:site_name" content="Example">
        </head>
      </html>
    `,
    new URL('https://example.com/articles/one'),
  );

  assert.deepEqual(preview, {
    title: 'Fix & ship',
    description: 'A useful preview',
    imageUrl: 'https://example.com/social/card.jpg',
    siteName: 'Example',
  });
});

test('falls back to the document title', () => {
  assert.deepEqual(
    extractLinkPreview(
      '<html><head><title>Plain title</title></head></html>',
      new URL('https://example.com'),
    ),
    { title: 'Plain title' },
  );
});

test('uses image_src when Open Graph metadata has no image', () => {
  assert.deepEqual(
    extractLinkPreview(
      `
        <html>
          <head>
            <meta property="og:title" content="Legacy page">
            <link rel="image_src" href="/previews/legacy.jpg">
          </head>
        </html>
      `,
      new URL('https://example.com/news/one'),
    ),
    {
      title: 'Legacy page',
      imageUrl: 'https://example.com/previews/legacy.jpg',
    },
  );
});

test('uses the strongest content image as the final fallback', () => {
  assert.deepEqual(
    extractLinkPreview(
      `
        <html>
          <head><title>Page without metadata</title></head>
          <body>
            <img src="/images/logo.png" width="120" height="40" alt="Logo">
            <img src="/upload/news/cover.jpg" width="960" height="540">
            <img src="/upload/news/thumb.jpg" width="240" height="120">
          </body>
        </html>
      `,
      new URL('https://example.com/news/one'),
    ),
    {
      title: 'Page without metadata',
      imageUrl: 'https://example.com/upload/news/cover.jpg',
    },
  );
});
