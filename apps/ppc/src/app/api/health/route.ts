import { NextResponse } from "next/server";
import { makeHealthResponse } from "@sagemark/core";

export function GET() {
  return NextResponse.json(makeHealthResponse("ppc", "0.1.0"));
}
