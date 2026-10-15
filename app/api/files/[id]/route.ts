import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleFile, safeResponse } from "../../../../server/budget";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return safeResponse(
    async () => handleFile(request, await getChatGPTUser(), env, (await params).id),
    request,
  );
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return safeResponse(
    async () => handleFile(request, await getChatGPTUser(), env, (await params).id),
    request,
  );
}
