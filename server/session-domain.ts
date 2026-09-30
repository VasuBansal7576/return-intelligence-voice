import * as fixture from '../agent/lib/demo/service.ts';
import * as replay from './replay-session.ts';
export function withDomainContext<T>(work:()=>T):T{return fixture.withSessionContext(()=>replay.withReplayContext(work));}
export function hydrateDomainSession(input:unknown){if(typeof input==='object'&&input!==null&&'kind' in input&&input.kind==='historical-replay')return replay.hydrateReplaySession(input);return fixture.hydrateSession(input);}
export function serializeDomainSession(id:string){return replay.isReplaySession(id)?replay.serializeReplaySession(id):fixture.serializeSession(id);}
export function domainSessionIds(){return [...fixture.currentSessionIds(),...replay.replaySessionIds()];}
export function domainSnapshot(id:string){return replay.isReplaySession(id)?replay.replaySnapshot(id):fixture.getSessionSnapshot(id);}
