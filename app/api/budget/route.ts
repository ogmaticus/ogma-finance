import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { handleBudget, safeResponse } from "../../../server/budget";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return safeResponse(async () => handleBudget(request, await getChatGPTUser(), env), request);
}
export async function PUT(request: Request) {
  return safeResponse(async () => handleBudget(request, await getChatGPTUser(), env), request);
}

export async function DELETE(request: Request) {
  return safeResponse(async () => handleBudget(request, await getChatGPTUser(), env), request);
}
