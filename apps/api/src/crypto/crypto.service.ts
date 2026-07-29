import { Injectable } from "@nestjs/common";
import {
  EnvelopeCrypto,
  aiThreadAad,
  createKeyringFromEnv,
  documentAad,
  folderAad,
  profileAad,
  resourceAad,
  searchChunkAad,
} from "@fixnote/crypto";

@Injectable()
export class CryptoService {
  private readonly keyring = createKeyringFromEnv();
  readonly envelope = new EnvelopeCrypto(this.keyring);
  readonly keyVersion = this.keyring.activeVersion;

  resourceDataKeyAad(resourceId: string, kind: string): string {
    return resourceAad(resourceId, kind, "dek");
  }

  resourceFieldAad(resourceId: string, kind: string, field: string): string {
    return resourceAad(resourceId, kind, field);
  }

  folderDataKeyAad(folderId: string): string {
    return folderAad(folderId, "dek");
  }

  folderFieldAad(folderId: string, field: string): string {
    return folderAad(folderId, field);
  }

  profileFieldAad(profileId: string, field: string): string {
    return profileAad(profileId, field);
  }

  aiThreadFieldAad(threadId: string, field: string): string {
    return aiThreadAad(threadId, field);
  }

  searchChunkAad(
    resourceId: string,
    resourceKind: string,
    chunkKind: string,
    nodeId: string | null,
  ): string {
    return searchChunkAad(
      resourceId,
      resourceKind,
      chunkKind,
      nodeId,
    );
  }

  documentAad(documentName: string): string {
    return documentAad(documentName);
  }
}
