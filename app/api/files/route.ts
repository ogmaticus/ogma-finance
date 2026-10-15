import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleFiles, safeResponse } from "../../../server/budget";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return safeResponse(async () => handleFiles(request, await getChatGPTUser(), env), request);
}
export async function POST(request: Request) {
  return safeResponse(async () => handleFiles(request, await getChatGPTUser(), env), request);
}
