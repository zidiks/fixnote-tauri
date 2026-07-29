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
