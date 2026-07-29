CREATE SCHEMA IF NOT EXISTS "extensions";
CREATE SCHEMA IF NOT EXISTS "private";

REVOKE ALL ON SCHEMA "private" FROM PUBLIC;

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "vector" WITH SCHEMA "extensions";

CREATE TYPE "ResourceKind" AS ENUM ('NOTE', 'BOARD');
CREATE TYPE "CollaboratorRole" AS ENUM ('EDITOR', 'VIEWER');
CREATE TYPE "AiThreadScope" AS ENUM ('GLOBAL', 'RESOURCE');
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "IngestionKind" AS ENUM ('URL', 'YOUTUBE', 'VOICE');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'READY', 'FAILED');

CREATE TABLE "profiles" (
  "id" UUID PRIMARY KEY,
  "email" TEXT UNIQUE,
  "displayName" TEXT,
  "homeWrappedDek" BYTEA,
  "homeKeyVersion" INTEGER,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "folders" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "parentId" UUID REFERENCES "folders"("id") ON DELETE SET NULL,
  "nameCiphertext" BYTEA NOT NULL,
  "wrappedDek" BYTEA NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "folders_keyVersion_check" CHECK ("keyVersion" > 0)
);

CREATE TABLE "resources" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "folderId" UUID REFERENCES "folders"("id") ON DELETE SET NULL,
  "kind" "ResourceKind" NOT NULL,
  "titleCiphertext" BYTEA NOT NULL,
  "titleHash" TEXT NOT NULL,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "positionX" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "positionY" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "width" DOUBLE PRECISION NOT NULL DEFAULT 320,
  "height" DOUBLE PRECISION NOT NULL DEFAULT 220,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "resources_schemaVersion_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "resources_width_check" CHECK ("width" > 0),
  CONSTRAINT "resources_height_check" CHECK ("height" > 0)
);

CREATE TABLE "resource_keys" (
  "resourceId" UUID PRIMARY KEY REFERENCES "resources"("id") ON DELETE CASCADE,
  "wrappedDek" BYTEA NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "resource_keys_keyVersion_check" CHECK ("keyVersion" > 0)
);

CREATE TABLE "resource_acl" (
  "resourceId" UUID NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "userId" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "role" "CollaboratorRole" NOT NULL,
  "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("resourceId", "userId")
);

CREATE TABLE "invites" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "resourceId" UUID NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "createdById" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "emailHash" TEXT NOT NULL,
  "emailCiphertext" BYTEA NOT NULL,
  "tokenHash" TEXT NOT NULL UNIQUE,
  "role" "CollaboratorRole" NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "acceptedAt" TIMESTAMPTZ,
  "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE "encrypted_yjs_states" (
  "documentName" TEXT PRIMARY KEY,
  "resourceId" UUID UNIQUE REFERENCES "resources"("id") ON DELETE CASCADE,
  "ownerId" UUID REFERENCES "profiles"("id") ON DELETE CASCADE,
  "ciphertext" BYTEA NOT NULL,
  "stateVector" BYTEA,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "encrypted_yjs_states_schemaVersion_check" CHECK ("schemaVersion" > 0),
  CONSTRAINT "encrypted_yjs_states_revision_check" CHECK ("revision" > 0)
);

CREATE TABLE "assets" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "resourceId" UUID NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "objectKey" TEXT NOT NULL UNIQUE,
  "mimeType" TEXT NOT NULL,
  "byteLength" BIGINT NOT NULL,
  "metadataCiphertext" BYTEA,
  "wrappedDek" BYTEA NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "assets_byteLength_check" CHECK ("byteLength" >= 0),
  CONSTRAINT "assets_keyVersion_check" CHECK ("keyVersion" > 0)
);

CREATE TABLE "search_chunks" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "resourceId" UUID NOT NULL REFERENCES "resources"("id") ON DELETE CASCADE,
  "nodeId" TEXT,
  "kind" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'simple',
  "contentHash" TEXT NOT NULL,
  "contentCiphertext" BYTEA NOT NULL,
  "projectionVersion" INTEGER NOT NULL DEFAULT 1,
  "searchVector" TSVECTOR,
  "embedding" "extensions"."vector"(768),
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "search_chunks_projectionVersion_check" CHECK ("projectionVersion" > 0)
);

CREATE TABLE "ai_threads" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "resourceId" UUID REFERENCES "resources"("id") ON DELETE CASCADE,
  "scope" "AiThreadScope" NOT NULL,
  "titleCiphertext" BYTEA,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_threads_scope_resource_check" CHECK (
    ("scope" = 'GLOBAL' AND "resourceId" IS NULL)
    OR ("scope" = 'RESOURCE' AND "resourceId" IS NOT NULL)
  )
);

CREATE TABLE "ai_messages" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "threadId" UUID NOT NULL REFERENCES "ai_threads"("id") ON DELETE CASCADE,
  "role" TEXT NOT NULL,
  "contentCiphertext" BYTEA NOT NULL,
  "citationsCiphertext" BYTEA,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT "ai_messages_role_check" CHECK (
    "role" IN ('system', 'user', 'assistant', 'tool')
  )
);

CREATE TABLE "ai_proposals" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "threadId" UUID NOT NULL REFERENCES "ai_threads"("id") ON DELETE CASCADE,
  "actionType" TEXT NOT NULL,
  "payloadCiphertext" BYTEA NOT NULL,
  "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
  "expiresAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "decidedAt" TIMESTAMPTZ
);

CREATE TABLE "ingestion_jobs" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId" UUID NOT NULL REFERENCES "profiles"("id") ON DELETE CASCADE,
  "resourceId" UUID REFERENCES "resources"("id") ON DELETE SET NULL,
  "kind" "IngestionKind" NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
  "inputCiphertext" BYTEA NOT NULL,
  "resultCiphertext" BYTEA,
  "errorCode" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "startedAt" TIMESTAMPTZ,
  "finishedAt" TIMESTAMPTZ,
  UNIQUE ("ownerId", "idempotencyKey"),
  CONSTRAINT "ingestion_jobs_attempts_check" CHECK ("attempts" >= 0)
);

CREATE INDEX "folders_ownerId_parentId_idx" ON "folders"("ownerId", "parentId");
CREATE INDEX "folders_parentId_idx" ON "folders"("parentId");
CREATE INDEX "folders_ownerId_deletedAt_idx" ON "folders"("ownerId", "deletedAt");
CREATE INDEX "resources_ownerId_folderId_updatedAt_idx" ON "resources"("ownerId", "folderId", "updatedAt" DESC);
CREATE INDEX "resources_folderId_idx" ON "resources"("folderId");
CREATE INDEX "resources_ownerId_deletedAt_idx" ON "resources"("ownerId", "deletedAt");
CREATE INDEX "resource_acl_userId_revokedAt_updatedAt_idx" ON "resource_acl"("userId", "revokedAt", "updatedAt" DESC);
CREATE INDEX "invites_resourceId_revokedAt_idx" ON "invites"("resourceId", "revokedAt");
CREATE INDEX "invites_createdById_idx" ON "invites"("createdById");
CREATE INDEX "invites_emailHash_expiresAt_idx" ON "invites"("emailHash", "expiresAt");
CREATE INDEX "encrypted_yjs_states_ownerId_updatedAt_idx" ON "encrypted_yjs_states"("ownerId", "updatedAt" DESC);
CREATE INDEX "assets_resourceId_deletedAt_idx" ON "assets"("resourceId", "deletedAt");
CREATE UNIQUE INDEX "search_chunks_resource_node_kind_key"
  ON "search_chunks" ("resourceId", COALESCE("nodeId", ''), "kind");
CREATE INDEX "search_chunks_resourceId_updatedAt_idx" ON "search_chunks"("resourceId", "updatedAt" DESC);
CREATE INDEX "search_chunks_fts_idx" ON "search_chunks" USING GIN ("searchVector");
CREATE INDEX "search_chunks_embedding_hnsw_idx"
  ON "search_chunks" USING HNSW ("embedding" "extensions"."vector_cosine_ops");
CREATE INDEX "ai_threads_ownerId_scope_updatedAt_idx" ON "ai_threads"("ownerId", "scope", "updatedAt" DESC);
CREATE INDEX "ai_threads_resourceId_updatedAt_idx" ON "ai_threads"("resourceId", "updatedAt" DESC);
CREATE INDEX "ai_messages_threadId_createdAt_idx" ON "ai_messages"("threadId", "createdAt");
CREATE INDEX "ai_proposals_threadId_status_createdAt_idx" ON "ai_proposals"("threadId", "status", "createdAt");
CREATE INDEX "ingestion_jobs_status_createdAt_idx" ON "ingestion_jobs"("status", "createdAt");
CREATE INDEX "ingestion_jobs_ownerId_createdAt_idx" ON "ingestion_jobs"("ownerId", "createdAt" DESC);
CREATE INDEX "ingestion_jobs_resourceId_idx" ON "ingestion_jobs"("resourceId");

-- Supabase Auth is present remotely, but the same migration also remains usable
-- against the lightweight local PostgreSQL container used for mock-auth tests.
DO $$
BEGIN
  IF TO_REGCLASS('auth.users') IS NOT NULL THEN
    ALTER TABLE "profiles"
      ADD CONSTRAINT "profiles_id_fkey"
      FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION "private"."handle_new_fixnote_user"()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO "public"."profiles" ("id", "email", "displayName")
  VALUES (
    NEW."id",
    NEW."email",
    COALESCE(
      NEW."raw_user_meta_data" ->> 'display_name',
      NEW."raw_user_meta_data" ->> 'full_name'
    )
  )
  ON CONFLICT ("id") DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION "private"."handle_new_fixnote_user"() FROM PUBLIC;

DO $$
BEGIN
  IF TO_REGCLASS('auth.users') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'fixnote_on_auth_user_created'
        AND tgrelid = 'auth.users'::regclass
    ) THEN
      CREATE TRIGGER "fixnote_on_auth_user_created"
        AFTER INSERT ON "auth"."users"
        FOR EACH ROW
        EXECUTE FUNCTION "private"."handle_new_fixnote_user"();
    END IF;

    INSERT INTO "public"."profiles" ("id", "email", "displayName")
    SELECT
      "id",
      "email",
      COALESCE(
        "raw_user_meta_data" ->> 'display_name',
        "raw_user_meta_data" ->> 'full_name'
      )
    FROM "auth"."users"
    ON CONFLICT ("id") DO NOTHING;
  END IF;
END
$$;

ALTER TABLE "profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "folders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "resource_acl" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invites" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "encrypted_yjs_states" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_threads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ai_proposals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingestion_jobs" ENABLE ROW LEVEL SECURITY;

-- The desktop never queries application tables directly. NestJS connects to
-- PostgreSQL and enforces the same ACL for REST and WebSocket connections.
DO $$
DECLARE
  role_name TEXT;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE FORMAT(
        'REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I',
        role_name
      );
      EXECUTE FORMAT(
        'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I',
        role_name
      );
      EXECUTE FORMAT(
        'REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I',
        role_name
      );
      EXECUTE FORMAT(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON TABLES FROM %I',
        CURRENT_USER,
        role_name
      );
      EXECUTE FORMAT(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I',
        CURRENT_USER,
        role_name
      );
      EXECUTE FORMAT(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
        CURRENT_USER,
        role_name
      );
    END IF;
  END LOOP;
END
$$;

ALTER DEFAULT PRIVILEGES IN SCHEMA "public"
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- New Supabase projects may include this event-trigger helper. It must not be
-- callable through the Data API because it is SECURITY DEFINER.
DO $$
DECLARE
  role_name TEXT;
BEGIN
  IF TO_REGPROCEDURE('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION "public"."rls_auto_enable"() FROM PUBLIC;

    FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
    LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
        EXECUTE FORMAT(
          'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM %I',
          role_name
        );
      END IF;
    END LOOP;
  END IF;
END
$$;
