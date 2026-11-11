const {join} = require('node:path');
const {readdirSync} = require('node:fs');
const {run} = require('node:test');
const {spec} = require('node:test/reporters');

const asPath = file => join(file.path || file.parentPath, file.name);
const concurrency = 1;
const dirs = ['integration'];
const flatten = arr => [].concat(...arr);
const timeout = 1000 * 60 * 5;

// Find the test files in a directory
const filesIn = dir => {
  return readdirSync(join(__dirname, dir), {withFileTypes: true}).map(asPath);
};

run({concurrency, timeout, files: flatten(dirs.map(filesIn))})
  .compose(spec)
  .pipe(process.stdout);
