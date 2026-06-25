import { NextResponse } from "next/server";
import { SERVICES } from "@sagemark/core";

const service = SERVICES.imagegen;

// Stub for Image Generation's primary action. Replace with the real implementation.
export async function POST(request: Request) {
  const input = await request.json().catch(() => ({}));

  return NextResponse.json({
    service: service.name,
    status: "not_implemented",
    note: `${service.title} received the request but has no logic wired yet.`,
    received: input,
  });
}
