import { NextRequest } from "next/server";
import { handleGetCart } from "@/lib/server/cartStore";

export async function GET(req: NextRequest) {
  return handleGetCart(req);
}