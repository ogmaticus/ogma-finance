import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleBackups, safeResponse } from "../../../server/budget";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return safeResponse(async () => handleBackups(request, await getChatGPTUser(), env), request);
}
