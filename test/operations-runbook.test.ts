import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('operations runbook', () => {
  const runbook = readFileSync(join(process.cwd(), 'docs', 'operations.md'), 'utf8')

  it('documents backup, restore, migration rollback, disaster recovery, and release operations', () => {
    for (const heading of [
      '## Backups',
      '### Database Backup Strategy',
      '### Storage Backup',
      '### Environment Backup',
      '## Restore Procedure',
      '## Migration Rollback',
      '## Disaster Recovery',
      '## Operational Safety',
      '## Release Checklist',
      '## Rollback',
    ]) {
      expect(runbook).toContain(heading)
    }
  })

  it('keeps recovery tied to admin controls instead of ad hoc database edits', () => {
    expect(runbook).toContain('/super-admin/controls')
    expect(runbook).toContain('/super-admin/sentinel')
    expect(runbook).toContain('/admin/orders')
    expect(runbook).toContain('Use admin and')
    expect(runbook).toContain('use SQL only for documented restore or migration')
  })
})
