import { NextResponse, type NextRequest } from "next/server";

// Password-protects the app (HTTP Basic auth). Webhooks are excluded: they
// verify their own signature/token. Unset APP_PASSWORD = no login (local dev only).
export function proxy(req: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const [user, pass] = atob(req.headers.get("authorization")?.split(" ")[1] ?? "").split(":");
  if (user === (process.env.APP_USER || "admin") && pass === password) return NextResponse.next();
  return new NextResponse("Login required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="TransferAI"' } });
}

export const config = {
  matcher: ["/((?!api/voice|api/inbound|api/fax/webhook|api/jwks|_next/static|_next/image|favicon.ico).*)"],
};
