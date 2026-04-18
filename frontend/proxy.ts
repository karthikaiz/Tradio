import { NextRequest, NextResponse } from "next/server";

export default function proxy(_req: NextRequest) {
  return NextResponse.next();
}
