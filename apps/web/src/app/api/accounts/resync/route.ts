import { handler, ok } from "@/server/api";
import { setSetting } from "@/server/settings";

export const POST = handler(async () => {
  // Flag all MT4/MT5 EAs to perform a full historical re-read and overwrite
  await setSetting("resync_cmd:all", "FORCE_RESYNC");
  return ok({
    success: true,
    message: "Force resync command broadcasted to all MT4/MT5 EAs.",
  });
});
