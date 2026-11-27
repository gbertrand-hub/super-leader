import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCantonMetaTemplatePayload} from '../src/lib/canton/whatsapp-provider-payload.ts';

const valid = {
  recipient: '+17375004840',
  visitorName: 'Test Visitor',
  siteName: 'Canton HQ',
  templateName: 'canton_feedback_request',
  token: '123e4567-e89b-42d3-a456-426614174000',
  language: 'fr',
};
test('uses the existing Cloud API number, template, and visit-specific token', () => {
  const body=buildCantonMetaTemplatePayload(valid);
  assert.equal(body.to, '17375004840');
  assert.equal(body.template.language.code, 'fr');
  assert.deepEqual(body.template.components[0].parameters.map(x => x.text), ['Test Visitor','Canton HQ']);
  assert.equal(body.template.components[1].parameters[0].text,valid.token);
});
test('English uses en_US and a distinct site label', () => {
  const body=buildCantonMetaTemplatePayload({...valid,language:'en',siteName:'Paris'});
  assert.equal(body.template.language.code,'en_US');
  assert.equal(body.template.components[0].parameters[1].text,'Paris');
});
test('bad recipient is rejected', () => {
  assert.throws(() => buildCantonMetaTemplatePayload({...valid,recipient:'737 500 4840'}));
});
test('bad token is rejected', () => {
  assert.throws(() => buildCantonMetaTemplatePayload({...valid,token:'http://malicious.test'}));
});
test('bad template is rejected', () => {
  assert.throws(() => buildCantonMetaTemplatePayload({...valid,templateName:'bad/template'}));
});
test('missing site is rejected', () => {
  assert.throws(() => buildCantonMetaTemplatePayload({...valid,siteName:''}));
});
