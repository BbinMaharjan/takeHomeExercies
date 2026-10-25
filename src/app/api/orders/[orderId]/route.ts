import { NextRequest } from "next/server";
import { handleGetOrder } from "@/lib/server/cartStore";

export async function GET(req: NextRequest, ctx: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await ctx.params;
  return handleGetOrder(req, orderId);
}