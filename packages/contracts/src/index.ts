import { z } from "zod";

export const resourceKindSchema = z.enum(["note", "board"]);
export type ResourceKind = z.infer<typeof resourceKindSchema>;

export const collaboratorRoleSchema = z.enum(["owner", "editor", "viewer"]);
export type CollaboratorRole = z.infer<typeof collaboratorRoleSchema>;

export const jobStatusSchema = z.enum(["queued", "processing", "ready", "failed"]);
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const ingestionKindSchema = z.enum(["url", "youtube", "voice"]);
export type IngestionKind = z.infer<typeof ingestionKindSchema>;

export const createResourceSchema = z.object({
  id: z.string().uuid().optional(),
  kind: resourceKindSchema,
  title: z.string().trim().max(240).default(""),
  folderId: z.string().uuid().nullable().optional(),
  position: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
    })
    .optional(),
  size: z
    .object({
      width: z.number().finite().min(220).max(1200),
      height: z.number().finite().min(140).max(1000),
    })
    .optional(),
});
export type CreateResourceInput = z.infer<typeof createResourceSchema>;

export const updateResourceSchema = z
  .object({
    title: z.string().trim().max(240).optional(),
    folderId: z.string().uuid().nullable().optional(),
    position: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
      })
      .optional(),
    size: z
      .object({
        width: z.number().finite().min(220).max(1200),
        height: z.number().finite().min(140).max(1000),
      })
      .optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.folderId !== undefined ||
      value.position !== undefined ||
      value.size !== undefined,
    { message: "At least one field must be provided" },
  );
export type UpdateResourceInput = z.infer<typeof updateResourceSchema>;

export const resourceSummarySchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  kind: resourceKindSchema,
  title: z.string(),
  folderId: z.string().uuid().nullable(),
  role: collaboratorRoleSchema,
  position: z.object({
    x: z.number(),
    y: z.number(),
  }),
  size: z.object({
    width: z.number(),
    height: z.number(),
  }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ResourceSummary = z.infer<typeof resourceSummarySchema>;

export const createFolderSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  parentId: z.string().uuid().nullable().optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
});
export type CreateFolderInput = z.infer<typeof createFolderSchema>;

export const updateFolderSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    parentId: z.string().uuid().nullable().optional(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }).optional(),
  })
  .refine((value) => value.name !== undefined || value.parentId !== undefined || value.position !== undefined, {
    message: 'At least one field must be provided',
  });
export type UpdateFolderInput = z.infer<typeof updateFolderSchema>;

export const folderSummarySchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid(),
  name: z.string(),
  parentId: z.string().uuid().nullable(),
  position: z.object({ x: z.number(), y: z.number() }),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type FolderSummary = z.infer<typeof folderSummarySchema>;

export const inviteCollaboratorSchema = z.object({
  email: z.string().email(),
  role: z.enum(["editor", "viewer"]),
});
export type InviteCollaboratorInput = z.infer<typeof inviteCollaboratorSchema>;

export const shareEntrySchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string().nullable(),
  role: z.enum(["editor", "viewer"]),
  status: z.enum(["active", "pending"]),
  invitationUrl: z.string().nullable(),
});
export type ShareEntry = z.infer<typeof shareEntrySchema>;

export const acceptInviteResultSchema = z.object({
  resourceId: z.string().uuid(),
  role: z.enum(["editor", "viewer"]),
});
export type AcceptInviteResult = z.infer<typeof acceptInviteResultSchema>;

export const searchResultSchema = z.object({
  resourceId: z.string().uuid(),
  nodeId: z.string().nullable(),
  kind: resourceKindSchema,
  title: z.string(),
  snippet: z.string(),
  score: z.number(),
});
export type SearchResult = z.infer<typeof searchResultSchema>;

export const aiChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  resourceId: z.string().uuid().optional(),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiChatResponseSchema = z.object({
  answer: z.string(),
  citations: searchResultSchema.array(),
});
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;

export const aiActionTypeSchema = z.enum([
  "create_resource",
  "open_resource",
  "rename_resource",
  "move_resource",
  "edit_document",
]);
export type AiActionType = z.infer<typeof aiActionTypeSchema>;

export const apiErrorSchema = z.object({
  statusCode: z.number(),
  code: z.string(),
  message: z.string(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
