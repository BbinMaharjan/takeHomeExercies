import { NextRequest } from "next/server";
import { handleGetBooking, handleUpdateBooking } from "@/lib/server/bookingStore";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return handleGetBooking(req, id);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  return handleUpdateBooking(req, id, body);
}