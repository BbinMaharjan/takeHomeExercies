import { NextRequest } from "next/server";
import { handleGetProvider } from "@/lib/server/bookingStore";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const providerId = Number(id);
  if (!Number.isFinite(providerId)) {
    return Response.json({ error: "Invalid provider id" }, { status: 400 });
  }
  return handleGetProvider(req, providerId);
}