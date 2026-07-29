import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CryptoIntegrityError,
  EnvelopeCrypto,
  aiThreadAad,
  documentAad,
  profileAad,
  resourceAad,
  type Keyring,
} from "./index.js";

function keyring(activeVersion = 1): Keyring {
  return {
    activeVersion,
    keys: new Map([
      [1, Buffer.alloc(32, 1)],
      [2, Buffer.alloc(32, 2)],
    ]),
  };
}

test("encrypts and decrypts resource text", () => {
  const crypto = new EnvelopeCrypto(keyring());
  const dataKey = crypto.generateDataKey();
  const aad = resourceAad("a", "note", "title");
  const encrypted = crypto.encryptText("секретная заметка", dataKey, aad);
  assert.notEqual(encrypted.toString("utf8"), "секретная заметка");
  assert.equal(crypto.decryptText(encrypted, dataKey, aad), "секретная заметка");
});

test("rejects ciphertext under a different resource AAD", () => {
  const crypto = new EnvelopeCrypto(keyring());
  const dataKey = crypto.generateDataKey();
  const encrypted = crypto.encryptText("content", dataKey, resourceAad("a", "note", "body"));
  assert.throws(
    () => crypto.decryptText(encrypted, dataKey, resourceAad("b", "note", "body")),
    CryptoIntegrityError,
  );
});

test("rewraps a data key without re-encrypting document content", () => {
  const initial = new EnvelopeCrypto(keyring(1));
  const dataKey = initial.generateDataKey();
  const aad = documentAad("resource:abc");
  const wrappedV1 = initial.wrapDataKey(dataKey, aad);
  assert.equal(wrappedV1.readUInt16BE(0), 1);

  const rotated = new EnvelopeCrypto(keyring(2));
  const wrappedV2 = rotated.rewrapDataKey(wrappedV1, aad);
  assert.equal(wrappedV2.readUInt16BE(0), 2);
  assert.deepEqual(rotated.unwrapDataKey(wrappedV2, aad), dataKey);
});

test("isolates profile home keys and AI thread content with distinct AAD", () => {
  const crypto = new EnvelopeCrypto(keyring());
  const homeKey = crypto.generateDataKey();
  const wrapped = crypto.wrapDataKey(homeKey, profileAad("profile-a", "home:dek"));
  const restored = crypto.unwrapDataKey(
    wrapped,
    profileAad("profile-a", "home:dek"),
  );
  const encrypted = crypto.encryptText(
    "private chat",
    restored,
    aiThreadAad("thread-a", "message:message-a:content"),
  );

  assert.equal(
    crypto.decryptText(
      encrypted,
      restored,
      aiThreadAad("thread-a", "message:message-a:content"),
    ),
    "private chat",
  );
  assert.throws(
    () =>
      crypto.decryptText(
        encrypted,
        restored,
        aiThreadAad("thread-b", "message:message-a:content"),
      ),
    CryptoIntegrityError,
  );
});
