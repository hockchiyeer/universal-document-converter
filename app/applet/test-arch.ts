import { createRequire } from "module";
const customRequire = typeof require !== 'undefined' ? require : createRequire(import.meta.url);
const archiver = customRequire("archiver");
console.log(typeof archiver, Object.keys(archiver));
