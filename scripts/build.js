#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const unpackedDir = path.join(distDir, 'unpacked');
const archiveName = 'external-host-gatekeeper.zip';

async function main() {
  if (process.argv.includes('--clean')) {
    await removeDirectory(distDir);
    return;
  }

  await removeDirectory(distDir);
  await fs.promises.mkdir(unpackedDir, { recursive: true });
  await copyProjectArtifacts();
  await createArchive();
}

async function copyProjectArtifacts() {
  const itemsToCopy = ['manifest.json', 'popup', 'src', 'assets', 'options'];
  for (const item of itemsToCopy) {
    // eslint-disable-next-line no-await-in-loop
    await copyItem(path.join(rootDir, item), path.join(unpackedDir, item));
  }
}

async function copyItem(src, dest) {
  try {
    const stats = await fs.promises.stat(src);
    if (stats.isDirectory()) {
      await fs.promises.mkdir(dest, { recursive: true });
      const entries = await fs.promises.readdir(src);
      for (const entry of entries) {
        // eslint-disable-next-line no-await-in-loop
        await copyItem(path.join(src, entry), path.join(dest, entry));
      }
    } else if (stats.isFile()) {
      await fs.promises.copyFile(src, dest);
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      return;
    }
    throw error;
  }
}

async function createArchive() {
  const outputPath = path.join(distDir, archiveName);
  await execFileAsync('zip', ['-qr', outputPath, '.'], { cwd: unpackedDir });
  console.log(`Created ${outputPath}`);
}

async function removeDirectory(directoryPath) {
  await fs.promises.rm(directoryPath, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
