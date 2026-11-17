// Token Launch Radar — entry point (Node 22, standard library only).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>),
// builds the ranked board with lib/model.ts, then writes into the output dir:
//   board.json   the ranked board the gate reads
//   data.js      the dashboard's dataset (window.RADAR), written beside dashboard/
//   dashboard/   this repository's static page, copied through
//   screenshots/ this repository's screenshots, copied through
//   dossier.json buildDossier from vendor/makefun-board.ts — written only when
//                at least 3 screenshots are present (the dossier library
//                refuses an empty screenshots set; see DEVLOG, phase notes).
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
//
// The program is deterministic: the same snapshot bytes give the same output
// bytes on every run (no clocks, no randomness, no network).

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: refusing to write a board the gate would refuse: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));

let dossierNote: string;
if (shots.length >= 3) {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, {
      text_max_bytes: TEXT_MAX_BYTES,
      screenshots: { max: 4, max_bytes: 524_288 },
      dashboard: { max_files: 400, max_bytes: 4_194_304 },
    }),
  );
  dossierNote = `dossier.json written (${shots.length} screenshots)`;
} else {
  dossierNote = `dossier.json SKIPPED: screenshots/ holds ${shots.length} image(s), the dossier needs at least 3 (phase-2 deliverable, see DEVLOG)`;
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.counts.records_no_token} record no token, ` +
    `${radar.counts.screened_out} screened out as derivatives, ${board.length} rows ranked ` +
    `(watchlist ${radar.counts.watchlist}/${radar.counts.watchlist} covered)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dashFiles.length} files), screenshots/ (${shots.length} images); ${dossierNote}\n`,
);
