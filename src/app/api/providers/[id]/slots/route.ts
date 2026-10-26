import { NextRequest } from "next/server";
import { handleGetSlots } from "@/lib/server/bookingStore";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const providerId = Number(id);
  if (!Number.isFinite(providerId)) {
    return Response.json({ error: "Invalid provider id" }, { status: 400 });
  }
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date") ?? "";
  const specialistId = searchParams.get("specialistId") ?? "";
  if (!date || !specialistId) {
    return Response.json({ error: "date and specialistId are required" }, { status: 400 });
  }
  return handleGetSlots(req, providerId, date, specialistId);
}