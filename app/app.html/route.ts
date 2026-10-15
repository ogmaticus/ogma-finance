import { appShellResponse } from "../../server/app-shell";
export const dynamic = "force-dynamic";
export async function GET() {
  return appShellResponse();
}
