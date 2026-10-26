import { NextRequest } from "next/server";
import { handleCreateBooking } from "@/lib/server/bookingStore";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handleCreateBooking(req, body);
}