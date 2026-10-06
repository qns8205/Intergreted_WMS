// Reproduce the application's Sharp photo resize/thumbnail pipeline in memory.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const require = createRequire('/home/configds/wms/package.json');
const sharp = require('sharp');
sharp.concurrency(1);
const source = await sharp(crypto.randomBytes(1600 * 1200 * 3), { raw: { width:1600, height:1200, channels:3 } }).jpeg({ quality:82 }).toBuffer();
while (true) {
  await sharp(source).rotate().resize({ width:1280, height:1280, fit:'inside', withoutEnlargement:true }).webp({ quality:82 }).toBuffer();
  await sharp(source).rotate().resize({ width:320, height:320, fit:'inside', withoutEnlargement:true }).webp({ quality:76 }).toBuffer();
  await delay(1000);
}
