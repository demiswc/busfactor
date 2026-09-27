import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRecipientKeys, isPublicKeyJwk, isRecipientBox, isSealedBox, openForRecipient, openSealed, sealForRecipient, sealText } from '../lib/sealed'

test('passphrase box (Argon2id): round trip, wrong passphrase, tamper', async () => {
  const box = await sealText('Safe behind the painting. Code 1234.', 'correct horse battery staple')
  assert.ok(isSealedBox(box)); assert.equal(JSON.parse(box).kdf, 'ARGON2ID'); assert.ok(!box.includes('1234'))
  assert.equal(await openSealed(box, 'correct horse battery staple'), 'Safe behind the painting. Code 1234.')
  await assert.rejects(openSealed(box, 'wrong passphrase'))
  const b = JSON.parse(box); b.ct = b.ct.slice(0, -4) + 'AAAA'
  await assert.rejects(openSealed(JSON.stringify(b), 'correct horse battery staple'))
  assert.ok(!isSealedBox('{"v":1}')); assert.ok(!isSealedBox('not json'))
  assert.ok(!isSealedBox(JSON.stringify({ ...JSON.parse(box), m: 1024 })), 'weak Argon2 parameters refused')
})

test('recipient keys: only the recipient, with their own passphrase, can open a message', async () => {
  const keys = await createRecipientKeys('pat chose this passphrase')
  assert.ok(isPublicKeyJwk(keys.publicKey)); assert.ok(!keys.publicKey.includes('"d"'), 'no private part in public key')
  const msg = JSON.stringify({ text: 'Pat, the servers are listed in the blue folder.', files: [{ name: 'a.txt', type: 'text/plain', size: 5, data: btoa('hello') }] })
  const box = await sealForRecipient(msg, keys.publicKey)
  assert.ok(isRecipientBox(box)); assert.ok(!box.includes('blue folder'))
  assert.equal(await openForRecipient(box, keys.encPrivateKey, 'pat chose this passphrase'), msg)
  await assert.rejects(openForRecipient(box, keys.encPrivateKey, 'guess'))
  const other = await createRecipientKeys('someone else')
  await assert.rejects(openForRecipient(box, other.encPrivateKey, 'someone else'), 'another key cannot open it')
})
