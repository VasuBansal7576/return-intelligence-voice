import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
const reportSchema = z.object({ sourceIntegrity: z.object({ sha256: z.record(z.string(),z.string()) }).optional() }).passthrough();
export async function evaluationReport() {
  let report;
  try { report=reportSchema.parse(JSON.parse(await readFile('data/evaluation-results.json','utf8'))); }
  catch { return { status:'not_run', results:[],summary:{total:0,passed:0,failed:0},sourceStale:null,message:'Run npm run test:scenarios to produce actual results.' }; }
  const expected=report.sourceIntegrity?.sha256??{};
  let current:Record<string,string>={};let verification='current_files';
  try {
    for(const path of Object.keys(expected)) {
      if(!/^(agent\/lib\/(demo|engine|knowledge)\/|evals\/|scripts\/)[a-zA-Z0-9_./-]+\.(ts|mjs|json)$/.test(path)||path.includes('..')) throw new Error('Invalid source path');
      current[path]=createHash('sha256').update(await readFile(path)).digest('hex');
    }
  } catch {
    try {current=z.object({sha256:z.record(z.string(),z.string())}).parse(JSON.parse(await readFile('data/build-manifest.json','utf8'))).sha256;verification='build_manifest';}
    catch {return {...report,sourceStale:null,sourceVerification:'unavailable'};}
  }
  const staleFiles=Object.keys(expected).filter(path=>expected[path]!==current[path]);
  return {...report,sourceStale:staleFiles.length>0,sourceVerification:verification,staleFiles};
}
