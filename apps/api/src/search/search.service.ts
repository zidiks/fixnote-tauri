import { Inject, Injectable } from '@nestjs/common';
import type { SearchResult } from '@fixnote/contracts';
import {
  Prisma,
  ResourceKind,
  prisma,
} from '@fixnote/database';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { CryptoService } from '../crypto/crypto.service.js';
import { ProfilesService } from '../profiles/profiles.service.js';

interface SearchRow {
  resourceId: string;
  nodeId: string | null;
  kind: ResourceKind;
  titleCiphertext: Uint8Array;
  contentCiphertext: Uint8Array;
  wrappedDek: Uint8Array;
  score: number;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(CryptoService) private readonly crypto: CryptoService,
    @Inject(ProfilesService) private readonly profiles: ProfilesService,
  ) {}

  async search(
    user: AuthenticatedUser,
    rawQuery: string,
    resourceId?: string,
  ): Promise<SearchResult[]> {
    const query = rawQuery.trim().slice(0, 500);
    if (!query) return [];
    const profile = await this.profiles.ensure(user);
    const embedding = await this.embed(`query: ${query}`);
    const resourceFilter = resourceId
      ? Prisma.sql`AND r."id" = ${resourceId}::uuid`
      : Prisma.empty;

    const rows = embedding
      ? await this.hybridRows(
          profile.id,
          query,
          `[${embedding.join(',')}]`,
          resourceFilter,
        )
      : await this.lexicalRows(profile.id, query, resourceFilter);

    return rows.map((row) => this.decryptRow(row));
  }

  private hybridRows(
    profileId: string,
    query: string,
    vector: string,
    resourceFilter: Prisma.Sql,
  ) {
    return prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        r."id" AS "resourceId",
        sc."nodeId" AS "nodeId",
        r."kind" AS "kind",
        r."titleCiphertext" AS "titleCiphertext",
        sc."contentCiphertext" AS "contentCiphertext",
        rk."wrappedDek" AS "wrappedDek",
        (
          0.45 * ts_rank_cd(
            sc."searchVector",
            plainto_tsquery('simple', ${query})
          ) +
          0.55 * COALESCE(
            1 - (
              sc."embedding" <=> ${vector}::"extensions"."vector"
            ),
            0
          )
        )::double precision AS "score"
      FROM "search_chunks" sc
      JOIN "resources" r ON r."id" = sc."resourceId"
      JOIN "resource_keys" rk ON rk."resourceId" = r."id"
      WHERE r."deletedAt" IS NULL
        AND (
          r."ownerId" = ${profileId}::uuid OR EXISTS (
            SELECT 1
            FROM "resource_acl" acl
            WHERE acl."resourceId" = r."id"
              AND acl."userId" = ${profileId}::uuid
              AND acl."revokedAt" IS NULL
          )
        )
        ${resourceFilter}
      ORDER BY "score" DESC
      LIMIT 20
    `);
  }

  private lexicalRows(
    profileId: string,
    query: string,
    resourceFilter: Prisma.Sql,
  ) {
    return prisma.$queryRaw<SearchRow[]>(Prisma.sql`
      SELECT
        r."id" AS "resourceId",
        sc."nodeId" AS "nodeId",
        r."kind" AS "kind",
        r."titleCiphertext" AS "titleCiphertext",
        sc."contentCiphertext" AS "contentCiphertext",
        rk."wrappedDek" AS "wrappedDek",
        ts_rank_cd(
          sc."searchVector",
          plainto_tsquery('simple', ${query})
        )::double precision AS "score"
      FROM "search_chunks" sc
      JOIN "resources" r ON r."id" = sc."resourceId"
      JOIN "resource_keys" rk ON rk."resourceId" = r."id"
      WHERE r."deletedAt" IS NULL
        AND sc."searchVector" @@ plainto_tsquery('simple', ${query})
        AND (
          r."ownerId" = ${profileId}::uuid OR EXISTS (
            SELECT 1
            FROM "resource_acl" acl
            WHERE acl."resourceId" = r."id"
              AND acl."userId" = ${profileId}::uuid
              AND acl."revokedAt" IS NULL
          )
        )
        ${resourceFilter}
      ORDER BY "score" DESC
      LIMIT 20
    `);
  }

  private decryptRow(row: SearchRow): SearchResult {
    const kind = row.kind === ResourceKind.NOTE ? 'note' : 'board';
    const dataKey = this.crypto.envelope.unwrapDataKey(
      row.wrappedDek,
      this.crypto.resourceDataKeyAad(row.resourceId, kind),
    );
    const title = this.crypto.envelope.decryptText(
      row.titleCiphertext,
      dataKey,
      this.crypto.resourceFieldAad(row.resourceId, kind, 'title'),
    );
    const content = this.crypto.envelope.decryptText(
      row.contentCiphertext,
      dataKey,
      this.crypto.resourceFieldAad(
        row.resourceId,
        kind,
        'search:document',
      ),
    );

    return {
      resourceId: row.resourceId,
      nodeId: row.nodeId,
      kind,
      title,
      snippet:
        content.length > 240 ? `${content.slice(0, 237).trim()}…` : content,
      score: Number(row.score),
    };
  }

  private async embed(input: string): Promise<number[] | null> {
    if (!process.env.EMBEDDINGS_API_URL) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(
        `${process.env.EMBEDDINGS_API_URL.replace(/\/$/, '')}/embed`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ inputs: [input], truncate: true }),
          signal: controller.signal,
        },
      );
      if (!response.ok) return null;
      const payload = (await response.json()) as unknown;
      if (
        Array.isArray(payload) &&
        Array.isArray(payload[0]) &&
        payload[0].every((value) => typeof value === 'number')
      ) {
        return payload[0] as number[];
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }
}
