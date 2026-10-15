import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from "../../chatgpt-auth";
export const dynamic = "force-dynamic";
export async function GET() {
  const user = await getChatGPTUser();
  return Response.json(
    {
      user: user ? { id: user.userId, name: user.displayName, email: user.email } : null,
      signInUrl: chatGPTSignInPath("/app.html"),
      signOutUrl: chatGPTSignOutPath("/app.html"),
    },
    { headers: { "Cache-Control": "no-store", Vary: "Cookie" } },
  );
}
