// repack_asar.js — Repack rápido de app.asar sem rebuild completo do Electron.
//
// Uso: node repack_asar.js <gui_dir> <src_asar> <dst_asar>
//   gui_dir  — caminho para gui/ (contém main.js, preload.js, public/)
//   src_asar — asar existente usado como base (pode ser igual a dst_asar ou vazio)
//   dst_asar — caminho de saída para o asar repacked
//
// O script espelha o campo "files" de gui/package.json:
//   main.js, boot_preload.js, preload.js, public/**/*
//
// @electron/asar é carregado de gui/node_modules para não precisar de
// dependência extra no script.

'use strict';
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const [,, guiDir, srcAsar, dstAsar] = process.argv;

if (!guiDir || !dstAsar) {
  console.error('Uso: node repack_asar.js <gui_dir> <src_asar> <dst_asar>');
  process.exit(1);
}

const asarPkg = path.join(guiDir, 'node_modules', '@electron', 'asar');
if (!fs.existsSync(asarPkg)) {
  console.error('[repack] @electron/asar nao encontrado em ' + asarPkg);
  console.error('[repack] Execute: cd gui && npm install');
  process.exit(1);
}
const asar = require(asarPkg);

const tmpDir = path.join(os.tmpdir(), 'asar_repack_' + process.pid + '_' + Date.now());

function copyDirRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDirRecursive(s, d);
    else fs.copyFileSync(s, d);
  }
}

async function main() {
  fs.mkdirSync(tmpDir, { recursive: true });

  // Extrair asar base (preserva package.json e outros arquivos gerados pelo builder)
  const base = srcAsar && fs.existsSync(srcAsar) ? srcAsar : null;
  if (base) {
    asar.extractAll(base, tmpDir);
  }

  // Sobrescrever com fontes atuais (espelha gui/package.json "files")
  for (const name of ['main.js', 'preload.js', 'boot_preload.js']) {
    const src = path.join(guiDir, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(tmpDir, name));
    }
  }

  const publicSrc = path.join(guiDir, 'public');
  if (fs.existsSync(publicSrc)) {
    copyDirRecursive(publicSrc, path.join(tmpDir, 'public'));
  }

  // Repack
  fs.mkdirSync(path.dirname(path.resolve(dstAsar)), { recursive: true });
  await asar.createPackage(tmpDir, dstAsar);

  const sizeKB = Math.round(fs.statSync(dstAsar).size / 1024);
  console.log('[repack] OK ' + path.basename(dstAsar) + ' (' + sizeKB + ' KB)');
}

main()
  .catch(e => { console.error('[repack] ERRO: ' + e.message); process.exit(1); })
  .finally(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
