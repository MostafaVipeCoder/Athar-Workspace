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
  it('sanitiser: allow-list, no bypass through "/" separators, svg, entities, case, nesting', () => {
    const bad = [
      '<img/src=x/onerror=alert(1)>', '<svg/onload=alert(1)>', '<svg><script>alert(1)</script></svg>', '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
      '<a href="jav&#x61;script:alert(1)">x</a>', '<a href="&#106;avascript:alert(1)">x</a>', '<a href=" jAvAsCrIpT:alert(1)">x</a>', '<a href="java\tscript:alert(1)">x</a>',
      '<a href="data:text/html,<script>alert(1)</script>">x</a>', '<img src="javascript:alert(1)">', '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
      '<body onload=alert(1)>', '<div onmouseover=alert(1)>x</div>', '<p style="background:url(javascript:alert(1))">x</p>', '<style>@import "x";</style>',
      '<scr<script>ipt>alert(1)</scr</script>ipt>', '<form action="javascript:alert(1)"><button formaction="javascript:alert(1)">x</button></form>', '<object data="x"></object>',
    ]
    // inspect the RESULT as a DOM: no element may carry an event handler, a script-like URL or a forbidden tag (text inside an attribute value is harmless)
    for (const b of bad) {
      const doc = new DOMParser().parseFromString(sanitizePreviewHtml(b), 'text/html')
      expect(doc.querySelectorAll('script, svg, math, iframe, style, object, embed, form, button, link, meta').length, b).toBe(0)
      for (const el of doc.body.querySelectorAll('*')) {
        for (const at of el.attributes) {
          expect(/^on/i.test(at.name), b + ' -> ' + at.name).toBe(false)
          expect(['style', 'srcdoc', 'formaction'].includes(at.name.toLowerCase()), b + ' -> ' + at.name).toBe(false)
          if (['href', 'src'].includes(at.name)) expect(/^[ ]*(javascript|data|vbscript):/i.test(at.value), b + ' -> ' + at.value).toBe(false)
        }
      }
    }
    expect(sanitizePreviewHtml('<p>Hi <b>there</b> <a href="https://x.io/a?b=1&amp;c=2">link</a></p>')).toBe('<p>Hi <b>there</b> <a href="https://x.io/a?b=1&amp;c=2">link</a></p>')
    expect(sanitizePreviewHtml(null)).toBe('')
  })
  it('normalises a stored template with defaults and splits address lists', () => {
    const d = { subject: 'S', body_html: 'B', subject_ar: 'س', body_html_ar: 'ب' }
    expect(normalizeEmailTemplate(undefined, d)).toMatchObject({ enabled: true, subject: 'S', subject_ar: 'س', cc: [], admin: [] })
    expect(normalizeEmailTemplate({ subject: 'Mine', cc: ['a@x.io', ' '] }, d)).toMatchObject({ subject: 'Mine', subject_ar: '', body_html: 'B', cc: ['a@x.io'] })
    expect(splitAddresses('a@x.io, b@y.io; c@z.io')).toEqual(['a@x.io', 'b@y.io', 'c@z.io'])
  })
})
