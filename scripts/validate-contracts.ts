import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import Ajv2020Module from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';

const directory = resolve('contracts/json-schema/v1');
const Ajv2020 = Ajv2020Module.default;
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormatsModule.default(ajv);
const schemaNames = (await readdir(directory)).filter((file) => file.endsWith('.json'));
const schemas = await Promise.all(schemaNames.map(async (name) =>
  JSON.parse(await readFile(resolve(directory, name), 'utf8')) as object,
));

for (const schema of schemas) ajv.addSchema(schema);
for (const schema of schemas) ajv.compile(schema);

for (const specification of ['contracts/openapi/v1/openapi.yaml', 'contracts/asyncapi/v1/asyncapi.yaml']) {
  const contents = await readFile(resolve(specification), 'utf8');
  if (!contents.includes('version: 1.0.0') || !contents.includes('schema')) {
    throw new Error(`${specification} is missing required version/schema declarations`);
  }
}

console.log(`Validated ${schemas.length} JSON Schemas and API/event specifications.`);
