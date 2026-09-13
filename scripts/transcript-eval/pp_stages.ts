// 後処理を 1 段ずつ適用して途中結果を書き出す。どの段が話者や本文を壊すかを突き止める
import fs from "node:fs";
import * as pp from "../../apps/worker/src/services/transcript-postprocess";

const [rawPath, indexPath, metaPath, outPrefix] = process.argv.slice(2);
const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
const settings = index.podcast.transcriptPostProcess;
const hallucination = { ...pp.DEFAULT_HALLUCINATION_SETTINGS, ...settings.hallucination };
const backchannel = { ...pp.DEFAULT_BACKCHANNEL_SETTINGS, ...settings.backchannel };
const filler = { ...pp.DEFAULT_FILLER_SETTINGS };

let segs = raw.segments;
const save = (name: string) => fs.writeFileSync(`${outPrefix}.${name}.json`, JSON.stringify({ segments: segs, language: "ja" }));
segs = pp.removeHallucinations(segs, hallucination.phrases).segments; save("01-halluc");
segs = pp.collapseRepetitions(segs, hallucination).segments; save("02-collapse");
segs = pp.removeFillers(segs, filler).segments; save("03-fillers");
segs = pp.normalizeBackchannels(segs, backchannel).segments; save("04-normbc");
segs = pp.dropStandaloneBackchannels(segs, backchannel).segments; save("05-dropbc");
if (!process.env.SKIP_REPAIR) { const rep = pp.repairSpeakerBoundaries(segs); segs = rep.segments; console.log("repaired", rep.repaired); } save("06-repair");
segs = pp.mergeSegments(segs, settings.merge); save("07-merge");
segs = pp.removeEmbeddedBackchannels(segs, backchannel).segments; save("08-embedded");
segs = pp.applyCorrections(segs, settings.corrections ?? []).segments; save("09-dict");
segs = pp.applyCorrections(segs, meta.transcriptCorrections ?? []).segments; save("10-episode");
segs = pp.dropStandaloneBackchannels(segs, backchannel).segments; save("11-dropbc2");
console.log("stages written");
