import test from 'node:test';
import assert from 'node:assert/strict';
import {mailPolicy,verifiedCode} from '../lib/mail.mjs';
const since='2026-10-19T09:00:00Z',clock=Date.parse(since)+60000;
const policy=mailPolicy({company:'Fictional Research',url:'https://job-boards.greenhouse.io/fictional/jobs/1'},'fixture@example.test',since);
const message={id:'fixture',sender:'no-reply@greenhouse.io',date:'2026-10-19T09:00:30Z',subject:'Security code for Fictional Research',body:'Fictional Research\nYour security code: A2B3C4D5'};
test('email codes require a recent matching employer and a trusted sender',()=>{assert.equal(verifiedCode([message],policy,clock).code,'A2B3C4D5');for(const change of [{sender:'attacker@greenhouse.io.evil.test'},{date:'2026-10-18T09:00:30Z'},{subject:'Another employer',body:'Another employer\nsecurity code: A2B3C4D5'},{date:'invalid'}])assert.equal(verifiedCode([{...message,...change}],policy,clock),null);assert.equal(verifiedCode([message,message],policy,clock),null);assert.throws(()=>mailPolicy({company:'Fictional Research',url:'https://attacker.test'},'fixture@example.test',since));});
