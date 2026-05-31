import { NextRequest, NextResponse } from 'next/server'
import { forgotPinGetQuestionsInput } from '@/lib/validators'
import { findAuthUserByPhone } from '@/lib/pin-auth'
import { rateLimitForgotPinGetQuestions } from '@/lib/rate-limit'

const FALLBACK_QUESTIONS = [
  'What was the name of your first pet?',
  "What is your mother's maiden name?",
]

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { phone } = forgotPinGetQuestionsInput.parse(body)
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'

    const rate = await rateLimitForgotPinGetQuestions(ipAddress)
    if (!rate.success) {
      return NextResponse.json({ error: 'Too many requests. Try again later.' }, { status: 429 })
    }

    const found = await findAuthUserByPhone(phone)

    // Always return the same shape — enumeration prevention
    if (!found) {
      return NextResponse.json({ questions: FALLBACK_QUESTIONS })
    }

    const u = found.user
    const q1 = typeof u.security_question_1 === 'string' ? u.security_question_1 : FALLBACK_QUESTIONS[0]
    const q2 = typeof u.security_question_2 === 'string' ? u.security_question_2 : FALLBACK_QUESTIONS[1]

    return NextResponse.json({ questions: [q1, q2] })
  } catch {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
