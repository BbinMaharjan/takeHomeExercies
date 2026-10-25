import { getGuestCartRaw } from "@/lib/server/cartStore";

export async function GET() {
  return Response.json({ items: getGuestCartRaw() });
}