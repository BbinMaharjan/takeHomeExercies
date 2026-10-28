import { NextRequest } from "next/server";
import { handleGetProvidersList } from "@/lib/server/bookingStore";

export async function GET(req: NextRequest) {
  return handleGetProvidersList(req);
}