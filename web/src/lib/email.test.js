import { describe, expect, it } from 'vitest'
import { normalizeEmailTemplate, renderTemplate, sanitizePreviewHtml, splitAddresses, unknownPlaceholders, validateEmailTemplate } from './email.js'

describe('lib/email (mirror of app_private.render_email_template)', () => {
  it('replaces {{key}} and {key}, escapes values in HTML mode, converts plain text to <br>, drops unknown tokens', () => {
    expect(renderTemplate('Hi {{first_name}} {company_name}\n{{nope}}', { first_name: 'A<b>', company_name: 'C&D' }, { html: true })).toBe('Hi A&lt;b&gt; C&amp;D<br>')
    expect(renderTemplate('Re: {{company_name}}', { company_name: 'C&D' })).toBe('Re: C&D')
  })
  it('turns the link keys into anchors only when they hold a URL', () => {
    expect(renderTemplate('{{cancel_link}}|{{meet_link}}|{{booking_link}}', { cancel_link: 'https://x.y/b?c=1&t=2', meet_link: 'later', booking_link: 'https://x.y/book' }, { html: true }))
      .toBe('<a href="https://x.y/b?c=1&amp;t=2">https://x.y/b?c=1&amp;t=2</a>|later|<a href="https://x.y/book">https://x.y/book</a>')
  })
  it('sanitises PM html for the preview and finds unknown placeholders', () => {
    expect(sanitizePreviewHtml('<p onclick="x()">a</p><script>bad()</script>')).toBe('<p>a</p>')
    expect(unknownPlaceholders(['a'], '{{a}} {b} {{ c }}')).toEqual(['b', 'c'])
    expect(validateEmailTemplate({ subject: '{{a}}', body_html: '', subject_ar: '', body_html_ar: '', cc: ['bad'], admin: [] }, ['a'])).toBe('badAddress')
    expect(validateEmailTemplate({ subject: '{{z}}', body_html: '', subject_ar: '', body_html_ar: '', cc: [], admin: [] }, ['a'])).toBe('unknownPlaceholder')
  })
  it('normalises a stored template with defaults and splits address lists', () => {
    const d = { subject: 'S', body_html: 'B', subject_ar: 'س', body_html_ar: 'ب' }
    expect(normalizeEmailTemplate(undefined, d)).toMatchObject({ enabled: true, subject: 'S', subject_ar: 'س', cc: [], admin: [] })
    expect(normalizeEmailTemplate({ subject: 'Mine', cc: ['a@x.io', ' '] }, d)).toMatchObject({ subject: 'Mine', subject_ar: '', body_html: 'B', cc: ['a@x.io'] })
    expect(splitAddresses('a@x.io, b@y.io; c@z.io')).toEqual(['a@x.io', 'b@y.io', 'c@z.io'])
  })
})
