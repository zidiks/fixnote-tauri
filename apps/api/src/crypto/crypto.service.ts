import { Injectable } from "@nestjs/common";
import {
  EnvelopeCrypto,
  createKeyringFromEnv,
  documentAad,
  folderAad,
  resourceAad,
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

  documentAad(documentName: string): string {
    return documentAad(documentName);
  }
}
