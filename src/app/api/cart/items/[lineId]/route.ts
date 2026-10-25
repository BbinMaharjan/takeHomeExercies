import { NextRequest } from "next/server";
import { handlePatchQuantity, handlePatchWellness, handleDeleteLine } from "@/lib/server/cartStore";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  if (body && typeof body.wellnessPricingId !== "undefined" && typeof body.quantity === "undefined") {
    return handlePatchWellness(req, lineId, body);
  }
  return handlePatchQuantity(req, lineId, body);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ lineId: string }> }) {
  const { lineId } = await ctx.params;
  return handleDeleteLine(req, lineId);
}