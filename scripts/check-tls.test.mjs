import test from 'node:test';
import assert from 'node:assert/strict';
import { certificateDays, verifyHost, waitForRenewal } from './check-tls.mjs';
test('keeps the measured expiration date and whole days, including expired certificates', () => {
  const now = Date.parse('2026-10-27T14:00:00Z');
  assert.equal(certificateDays({valid_to:'Nov 26 07:22:27 2026 GMT'}, now),29);
  assert.equal(certificateDays({valid_to:'Oct 27 13:59:59 2026 GMT'}, now),-1);
  assert.throws(() => certificateDays({}, now), /date-unavailable/);
});
test('refuses URLs, ports, IPs and internal hostnames', () => {
  assert.equal(verifyHost('app.example.com'),'app.example.com');
  for (const invalid of ['localhost','app.local','app.internal','127.0.0.1','https://app.example.com','app.example.com:443','app.example.com/path','app.example.com\n'])
    assert.throws(() => verifyHost(invalid), /public-host-required/);
});
test('startup errors and a still-expiring certificate are retried until renewal is observed', async () => {
  let clock=0, calls=0;
  const result = await waitForRenewal('app.example.com', {now:()=>clock,wait:async ms=>{clock+=ms;},probe:async()=>{
    calls++; if(calls===1) throw new Error('starting');
    return {daysRemaining:calls===2?29:89,expiresAt:'future'};
  }});
  assert.equal(result.daysRemaining,89); assert.equal(calls,3); assert.equal(clock,20000);
});
test('the old certificate cannot pass and waiting remains bounded', async () => {
  let clock=0;
  await assert.rejects(waitForRenewal('app.example.com',{now:()=>clock,wait:async ms=>{clock+=ms;},probe:async()=>({daysRemaining:30})}), /not-confirmed/);
  assert.equal(clock,300000);
});
