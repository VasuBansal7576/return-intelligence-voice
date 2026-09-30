import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { returnInputSchema } from "../lib/engine/resolutions.ts";

export default defineTool({
  description: "DISABLED legacy transactional entrypoint. Use the guarded custom demo server with customer and condition confirmation.",
  inputSchema: returnInputSchema,
  approval: always(),
  execute() { throw new Error("Legacy Eve transaction execution is disabled. Use the guarded custom demo server with explicit condition and customer confirmation."); },
});
