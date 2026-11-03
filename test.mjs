import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('read cap and query configuration',()=>{
const c=JSON.parse(fs.readFileSync(new URL('./config.json',import.meta.url),'utf8'));
assert.ok(c.monthlyLimit>0&&c.monthlyLimit<=800);
assert.ok(c.pageSize>=10&&c.pageSize<=100);
assert.ok(c.queries.length>=2);
});
