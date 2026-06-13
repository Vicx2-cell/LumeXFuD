import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdmin } from '@/lib/supabase/server'
import { programmeById, facultyById } from '@/lib/catalog'
import { ingestDiscipline, type IngestDeps } from '@/lib/study-ingest'
import { runExtraction, studyAiEnabled } from '@/lib/study-ingest-ai'
import { saveCatalogCourses } from '@/lib/study-ingest-db'

export const runtime = 'nodejs'
export const maxDuration = 300

// GATED (AI spend): curriculum ingestion for ONE discipline (§7.6). Seed-time /
// admin job — NOT live per user. Bearer CRON_SECRET only. Behind the AI kill
// switch. Produces sourced, confidence-scored, status-tagged candidates and the
// human-review queue; it can never mark a row verified — only a human can.
export async function POST(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: { programmeId?: string }
  try {
    body = (await req.json()) as { programmeId?: string }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const programmeId = body.programmeId
  const programme = programmeId ? programmeById(programmeId) : null
  if (!programme) {
    return NextResponse.json({ error: 'Unknown programmeId' }, { status: 400 })
  }
  const faculty = facultyById(programme.facultyId)

  const db = createSupabaseAdmin()
  const deps: IngestDeps = {
    aiEnabled: studyAiEnabled,
    generate: runExtraction,
    save: (rows) => saveCatalogCourses(db, rows),
  }

  const result = await ingestDiscipline(deps, {
    id: programme.id,
    name: programme.name,
    facultyName: faculty?.name ?? programme.facultyId,
  })

  if (result.disabled) {
    return NextResponse.json({ error: 'Study AI is disabled (kill switch)' }, { status: 503 })
  }

  // Return a compact review queue: nothing here is authoritative until a human
  // confirms it in-app (flips status → absu_verified).
  return NextResponse.json({
    programmeId: result.programmeId,
    saved: result.saved,
    warnings: result.warnings,
    reviewQueue: result.reviewQueue.map((r) => ({
      level: r.level,
      semester: r.semester,
      code: r.code,
      title: r.title,
      creditUnits: r.creditUnits,
      kind: r.kind,
      status: r.status,
      confidence: r.confidence,
      sourceUrl: r.sourceUrl,
    })),
  })
}
