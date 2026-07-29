ALTER TABLE "folders"
  ADD COLUMN "color" TEXT NOT NULL DEFAULT 'default';

ALTER TABLE "folders"
  ADD CONSTRAINT "folders_color_check"
  CHECK ("color" IN ('default', 'sage', 'sky', 'yellow', 'rose'));
