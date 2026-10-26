import { NextRequest } from "next/server";
import { handleGetExistingBooking } from "@/lib/server/bookingStore";

export async function GET(req: NextRequest) {
  return handleGetExistingBooking(req);
}