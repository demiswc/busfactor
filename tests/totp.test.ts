import { test } from 'node:test'
import assert from 'node:assert/strict'
import { base32Decode, base32Encode, totpAt, verifyTotp } from '../lib/totp'
import { isPrivateAddress } from '../lib/channels'

test('TOTP matches the RFC 6238 test vector', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  assert.equal(totpAt(secret, Math.floor(59 / 30)), '287082')          // RFC: 94287082 (8 digits) -> 287082
  assert.equal(totpAt(secret, Math.floor(1111111109 / 30)), '081804')  // RFC: 07081804
  assert.equal(base32Decode(secret).toString(), '12345678901234567890')
  const now = 1111111109 * 1000
  assert.equal(verifyTotp(secret, '081804', now), Math.floor(1111111109 / 30))
  assert.equal(verifyTotp(secret, '000000', now), null)
  assert.equal(verifyTotp(secret, 'abc', now), null)
})

test('SSRF guard recognises private addresses', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '198.18.0.1', '192.0.0.1',
    '::1', 'fd00::1', 'fe80::1', 'fec0::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '::7f00:1', '[::1]', 'not-an-ip']) assert.ok(isPrivateAddress(ip), ip)
  for (const ip of ['8.8.8.8', '77.68.115.203', '2606:4700::1111', '64:ff9b::808:808']) assert.ok(!isPrivateAddress(ip), ip)
})
