import { importXlsx } from "../lib/xlsxImport.js";

const filePath = process.argv[2];
if (!filePath) {
  console.error("Usage: node server/scripts/import-xlsx.js <path-to-xlsx>");
  process.exit(1);
}

const summary = await importXlsx(filePath);
console.log(JSON.stringify(summary, null, 2));
