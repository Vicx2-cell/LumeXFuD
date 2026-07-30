import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Sponsor top-up checkout is retired. Use the customer LumeX Wallet account.' },
    { status: 410 },
  )
}
