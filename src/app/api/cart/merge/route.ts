import { NextRequest } from "next/server";
import { handleMerge } from "@/lib/server/cartStore";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handleMerge(req, body);
}