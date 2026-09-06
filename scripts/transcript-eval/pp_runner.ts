// Worker の後処理をローカルで同じ引数で呼ぶ。候補の生データを「公開相当」にして採点するため
import fs from "node:fs";
import { postProcess, toPostProcessOptions } from "../../apps/worker/src/services/transcript-postprocess";

const [rawPath, indexPath, metaPath, outPath, mode] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const settings = index.podcast.transcriptPostProcess;
// mode=global なら、この回かぎりの規則（校正 LLM が登録したもの）は当てない
const useMeta = mode === "global" ? { ...meta, transcriptCorrections: [] } : meta;
const out = postProcess(raw, toPostProcessOptions(settings, useMeta));
fs.writeFileSync(outPath, JSON.stringify(out));
console.log(`postProcess: ${raw.segments.length} -> ${out.segments.length} segments (${mode ?? "full"})`);
