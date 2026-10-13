import { describe, expect, it } from 'vitest'
import { withdrawnCount, boardColumns, defaultSelectionConfig, effectiveStage, emailIndex, normalizeSelectionConfig, portStatuses, renderTemplate, sampleVars, sanitizePreviewHtml, scoreIndex, stageCounts, stageForEmail, toStoredConfig, unknownPlaceholders, validateSelectionConfig } from './selectionConfig.js'

const item = (over = {}) => ({ id: 'i', itemId: 'i', source: { kind: 'form_response', id: 'r', state: 'ok' }, entity: { title: { en: 'Nile Co', ar: '' }, subtitle: { en: 'Abdel Rahman Ali', ar: '' }, organization: { en: '', ar: '' }, bio: { en: '', ar: '' }, links: [] }, contact: { email: 'f@x.io', phone: '' }, overlay: {}, fields: { company_name: 'Nile Co', q7: 'yes' }, status: null, excluded: false, ...over })

describe('selectionConfig', () => {
  it('normalises a migrated config: default stages, passing from the accept stage, legacy e-mail override merged with the defaults', () => {
    const c = normalizeSelectionConfig({ emails: { acceptance: { subject: 'Hi {{company_name}}', body_html: 'x', cc: ['a@b.io'] } }, sheetImport: { url: 'https://sheet', enabled: false } })
    expect(c.stages.map((s) => s.key)).toEqual(['screening', 'interview', 'holding', 'accepted', 'rejected'])
    expect(c.passing).toEqual(['accepted'])
    expect(c.emails.acceptance.subject).toBe('Hi {{company_name}}')
    expect(c.emails.acceptance.subject_ar).toBe('') // an override replaces the default pair; the Arabic side starts empty
    expect(c.emails.acceptance.cc).toEqual(['a@b.io'])
    expect(c.emails.rejection.subject).toBe('Thank You for Your Application') // the migration default
    expect(c.participantRule.onAccept).toBe('none')
    expect(c.sheetImport.url).toBe('https://sheet') // unknown keys kept
    expect(toStoredConfig({ ...c, stages: [{ key: 'in', type: 'inbox' }, { key: 'go', type: 'accept' }, { key: 'yes', type: 'accept' }] }).passing).toEqual(['go', 'yes'])
  })

  it('validates stages, keys and templates', () => {
    const ok = defaultSelectionConfig()
    expect(validateSelectionConfig(ok)).toEqual({})
    expect(validateSelectionConfig({ ...ok, stages: [] }).stages).toBe('selection.settings.stagesEmpty')
    expect(validateSelectionConfig({ ...ok, stages: [{ key: 'Bad Key', type: 'accept' }] }).stages).toBe('selection.settings.keyInvalid')
    expect(validateSelectionConfig({ ...ok, stages: [{ key: 'a', type: 'accept' }, { key: 'a', type: 'reject' }] }).stages).toBe('selection.settings.keyDuplicate')
    expect(validateSelectionConfig({ ...ok, stages: [{ key: 'a', type: 'reject' }] }).stages).toBe('selection.settings.needAccept')
    expect(validateSelectionConfig({ ...ok, emails: { ...ok.emails, acceptance: { ...ok.emails.acceptance, body_html: 'Hi {{booking_link}}' } } })['emails.acceptance']).toBe('selection.emails.unknownPlaceholder')
    expect(validateSelectionConfig({ ...ok, emails: { ...ok.emails, rejection: { ...ok.emails.rejection, cc: ['nope'] } } })['emails.rejection']).toBe('selection.emails.badAddress')
    expect(unknownPlaceholders('interview', 'Hi {{first_name}} {company_name} {{booking_link}} {{foo}}')).toEqual(['foo'])
  })

  it('maps output ports to the configured stages (mirror of the DB helper) and finds the stage of an e-mail', () => {
    const c = normalizeSelectionConfig({ stages: [{ key: 'in', type: 'inbox' }, { key: 'talk', type: 'stage', email: 'interview' }, { key: 'wait', type: 'hold' }, { key: 'go', type: 'accept' }, { key: 'no', type: 'reject' }] })
    expect(portStatuses(c, 'approved')).toEqual(['go'])
    expect(portStatuses(c, 'rejected')).toEqual(['no'])
    expect(portStatuses(c, 'holding')).toEqual(['wait'])
    expect(portStatuses(c, 'interview')).toEqual(['talk'])
    expect(portStatuses(c, 'all')).toBeNull()
    expect(portStatuses(normalizeSelectionConfig({ stages: [{ key: 'go', type: 'accept' }] }), 'rejected')).toEqual(['rejected'])
    expect(stageForEmail(c, 'interview').key).toBe('talk')
    expect(stageForEmail(c, 'acceptance')).toBeNull()
    expect(effectiveStage(item(), c)).toBe('in')
    expect(stageCounts([item(), item({ status: 'go' }), item({ status: 'go', excluded: true })], c)).toEqual({ in: 1, go: 1 })
  })

  it('WITHDRAWN applicants (m40) keep their stage but leave the stage counts; they are counted apart and exported with the reason', () => {
    const c = normalizeSelectionConfig({ stages: [{ key: 'in', type: 'inbox' }, { key: 'go', type: 'accept' }] })
    const gone = item({ status: 'go', withdrawn: true, withdrawal: { at: '2026-10-13T08:00:00Z', reason: 'left', source: 'participant' } })
    expect(stageCounts([item(), item({ status: 'go' }), gone], c)).toEqual({ in: 1, go: 1 })
    expect(withdrawnCount([item(), gone, item({ withdrawn: true })])).toBe(2)
    expect(withdrawnCount()).toBe(0)
    const cols = boardColumns((k) => k, 'en', { config: c, fields: [] })
    expect(cols.find((x) => x.header === 'entity.export.presence').key(gone)).toBe('entity.export.withdrawn')
    expect(cols.find((x) => x.header === 'entity.export.presence').key(item())).toBe('')
    expect(cols.find((x) => x.header === 'entity.withdraw.reason').key(gone)).toBe('left')
  })

  it('renders templates like the server: escaped values, <br> for plain text, anchors for the booking link, unknown tokens dropped', () => {
    const vars = sampleVars(item(), { pmName: 'Mona', programName: 'Prog', bookingLink: 'https://x/book/s?invite=t' })
    expect(vars.first_name).toBe('Abdel Rahman')
    expect(renderTemplate('Re: {{company_name}} <b>', { company_name: 'A&B' })).toBe('Re: A&B <b>')
    expect(renderTemplate('Hi {{first_name}} {company_name}\n{{nope}}', { first_name: 'A<b>', company_name: 'C' }, { html: true })).toBe('Hi A&lt;b&gt; C<br>')
    expect(renderTemplate('<p>{{booking_link}}</p>', { booking_link: 'https://x/y?a=1&b=2' }, { html: true })).toBe('<p><a href="https://x/y?a=1&amp;b=2">https://x/y?a=1&amp;b=2</a></p>')
    expect(sanitizePreviewHtml('<p onclick="x()">a</p><script>bad()</script><a href="javascript:1">b</a>')).toBe('<p>a</p><a href="1">b</a>')
  })

  it('indexes outbox rows and scores per item and builds the export columns with labelled answers', () => {
    const emails = emailIndex([
      { item_id: 'i', email_key: 'interview', status: 'sent', created_at: '2026-10-01T00:00:00Z' },
      { item_id: 'i', email_key: 'interview', status: 'queued', created_at: '2026-10-02T00:00:00Z' },
      { item_id: null, email_key: 'interview', status: 'queued', created_at: '2026-10-03T00:00:00Z' },
    ])
    expect(emails.i.interview.count).toBe(2)
    expect(emails.i.interview.last.status).toBe('queued')
    const scores = scoreIndex([{ item_id: 'i', reviewer_id: 'u1', score: 4 }, { item_id: 'i', reviewer_id: 'u2', score: 5 }, { item_id: 'i', reviewer_id: 'u3', score: null, note: 'n' }], 'u2')
    expect(scores.i.avg).toBe(4.5)
    expect(scores.i.count).toBe(2)
    expect(scores.i.mine.score).toBe(5)
    const t = (k) => k
    const cols = boardColumns(t, 'en', { config: defaultSelectionConfig(), reviews: { i: { reason: 'why', reviewed_at: 'd' } }, scores, emails, fields: [{ name: 'q7', label: { en: 'Pitch ready?', ar: '' } }, { name: 'q7', label: { en: 'dup' } }] })
    const row = Object.fromEntries(cols.map((c) => [c.header, c.key(item({ status: 'accepted' }))]))
    expect(row['selection.col.stage']).toBe('Accepted')
    expect(row['selection.col.reason']).toBe('why')
    expect(row['selection.col.score']).toBe(4.5)
    expect(row['Pitch ready?']).toBe('yes')
    expect(row['selection.email.interview (selection.col.sent)']).toBe(2)
    expect(cols.filter((c) => c.header === 'Pitch ready?')).toHaveLength(1)
  })
})
