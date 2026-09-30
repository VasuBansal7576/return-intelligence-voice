import { defineTool } from 'eve/tools';
import { z } from 'zod';
import { discountDecision } from '../lib/demo/service.ts';
export default defineTool({ description: 'Return canonical discretionary discount policy. A discount request alone does not justify escalation.', inputSchema: z.object({}), execute: discountDecision });
