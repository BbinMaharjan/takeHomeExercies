import { NextRequest } from "next/server";
import { handleCheckout } from "@/lib/server/cartStore";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handleCheckout(req, body);
}