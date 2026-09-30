import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,relative} from 'node:path';
import {z} from 'zod';
import {getReplay} from './replay.ts';
import {assertPrivateLocalOnly} from './history.ts';
import {providerHistorySchema,sanitizedHistoryForProvider} from './provider-history.ts';
const receiptSchema=z.object({receiptId:z.string().uuid(),source:providerHistorySchema}).strict();
const directory=()=>resolve('.private/provider-replay-input');
export function prepareVoiceReceipt(replayId:string){assertPrivateLocalOnly();const replay=getReplay(replayId);const source=sanitizedHistoryForProvider({customerRef:'projection-only',source:replay.sourceProvenance,items:[replay.sourceItem]});const receipt={receiptId:randomUUID(),source};mkdirSync(directory(),{recursive:true,mode:0o700});writeFileSync(resolve(directory(),receipt.receiptId+'.json'),JSON.stringify(receipt),{flag:'wx',mode:0o600});return {receiptId:receipt.receiptId,kind:'historical-replay',sanitized:true,merchantIntegration:false};}
export function readSanitizedReceipt(id:string){if(process.env.VERCEL||process.env.RIV_PUBLIC_VOICE_APPROVED==='true')throw new Error('Historical voice receipts are restricted to the local demo.');const receiptId=z.string().uuid().parse(id);const root=realpathSync(directory());const file=realpathSync(resolve(root,receiptId+'.json'));if(relative(root,file)!==receiptId+'.json')throw new Error('Receipt must be the exact local prepared file.');const receipt=receiptSchema.parse(JSON.parse(readFileSync(file,'utf8')));if(receipt.receiptId!==receiptId)throw new Error('Receipt mismatch.');return receipt.source;}
