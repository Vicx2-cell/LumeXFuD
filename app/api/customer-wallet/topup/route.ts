import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    { error: 'Direct top-up checkout is retired. Fund your LumeX Wallet by bank transfer to your Paystack account.' },
    { status: 410 },
  )
}
