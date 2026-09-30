"""Extract existing transaction behavior once; refuse an already-migrated tree."""
from pathlib import Path
root=Path(__file__).resolve().parents[1]
r=(root/'agent/tools/create_return.ts').read_text();e=(root/'agent/tools/create_exchange.ts').read_text()
if 'defineTool' not in r or 'async execute(' not in r: raise SystemExit('Already migrated; no changes')
def schema(src): return src.split('  inputSchema: ',1)[1].split('\n  approval:',1)[0].removesuffix(',')
def body(src, marker): return src.split(marker,1)[1].rsplit('\n  },\n});',1)[0].replace('ctx.session.id','sessionId')
imports='''import { z } from "zod";
import { findOrder } from "../knowledge/customers.ts";
import { getProduct, normalizeId } from "../knowledge/catalog.ts";
import { checkEligibility } from "./eligibility.ts";
import { diagnosisLabelSchema } from "./diagnosis.ts";
import { appendResolution, findResolution } from "./records.ts";
import { POLICY } from "../knowledge/policy.ts";
'''
code=imports+'\nexport const returnInputSchema = '+schema(r)+';\n\nexport const exchangeInputSchema = '+schema(e)+';\n'
code+='\nexport async function createReturn(input: z.infer<typeof returnInputSchema>, sessionId: string) {\n  const { orderId, productId, itemId, reasonLabel, reasonNotes } = input;'+body(r,'async execute({ orderId, productId, itemId, reasonLabel, reasonNotes }, ctx) {')+'\n}\n'
code+='\nexport async function createExchange(input: z.infer<typeof exchangeInputSchema>, sessionId: string) {'+body(e,'async execute(input, ctx) {')+'\n}\n'
(root/'agent/lib/engine/resolutions.ts').write_text(code)
for path,src,function,schemaName in [('create_return.ts',r,'createReturn','returnInputSchema'),('create_exchange.ts',e,'createExchange','exchangeInputSchema')]:
 description=src.split('  description:\n',1)[1].split('\n  inputSchema:',1)[0]
 text='''import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
'''+f'import {{ {function}, {schemaName} }} from "../lib/engine/resolutions.ts";\n\nexport default defineTool({{\n  description:\n'+description+f'\n  inputSchema: {schemaName},\n  approval: always(),\n  execute(input, ctx) {{ return {function}(input, ctx.session.id); }},\n}});\n'
 (root/'agent/tools'/path).write_text(text)
print('Resolution engine extracted. Eve tools retain always() approval.')
