const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const resolve=process.env.DD_NODE_MODULES?require('node:module').createRequire(path.join(process.env.DD_NODE_MODULES,'pack-resolver.cjs')):require;
const Ajv=resolve('ajv/dist/2020'),addFormats=resolve('ajv-formats'),ajv=new Ajv({allErrors:true});addFormats(ajv);
const schema=JSON.parse(fs.readFileSync(path.join(__dirname,'../schemas/pack-catalog.schema.json'))),validate=ajv.compile(schema),db=require('../pack-catalog.js');
assert(validate(db),JSON.stringify(validate.errors));
for(const mutate of [d=>d.privateSession='synthetic-secret',d=>d.profiles[0].permissions=['write'],d=>d.evidence[0].url='javascript:alert(1)',d=>delete d.evidence[0].checkedAt,d=>d.evidence[0].sourceDate='2025-02-31',d=>d.profiles[0].capabilities.coding=0,d=>d.profiles[0].claimIds=[]]){const bad=structuredClone(db);mutate(bad);assert(!validate(bad),'Invalid public record accepted');}
for(const name of ['run','pairedOutcome','reviewedRevision']){const v=ajv.compile({$ref:schema.$id+'#/$defs/'+name});assert(!v({}));}
console.log('PASS strict catalog schemas, required provenance, invalid dates, unknown-not-zero, private field rejection');
