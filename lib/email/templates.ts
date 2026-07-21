import { EMAIL_IDENTITIES, EMAIL_WORKFLOWS, type EmailWorkflow } from './identities'

const BRAND = '#F28C28'
const INK = '#241A12'

function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there'
}

function layout(preheader: string, body: string, department: string, replyAddress: string): string {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"></head>
<body style="margin:0;background:#FFF8EF;color:${INK};font-family:Arial,Helvetica,sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#FFF8EF"><tr><td align="center" style="padding:28px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #F3E4D2;border-radius:20px;overflow:hidden">
<tr><td style="padding:30px 30px 18px"><div style="font-size:22px;font-weight:800">LumeX <span style="color:${BRAND}">Fud</span></div></td></tr><tr><td style="padding:0 30px 32px;font-size:16px;line-height:1.65">${body}</td></tr>
<tr><td style="padding:22px 30px;background:#FFF8EF;color:#806B58;font-size:12px;line-height:1.5">${escapeHtml(department)} · Reply to ${escapeHtml(replyAddress)}<br>You received this message because of the request described above.</td></tr></table></td></tr></table></body></html>`
}

function button(label: string, url: string): string {
  return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 8px"><tr><td bgcolor="${BRAND}" style="border-radius:12px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:13px 20px;color:#fff;text-decoration:none;font-weight:700">${escapeHtml(label)}</a></td></tr></table>`
}

export function renderEmailVerification(input: { code: string }) {
  const subject = 'Confirm your LumeX Fud email'
  const why = 'You received this because this email address was entered for a LumeX Fud account or application.'
  const text = [why, '', `Verification code: ${input.code}`, '', 'This code expires in 10 minutes. If you did not request it, ignore this message.', '', 'LumeX Fud', `Support: ${EMAIL_IDENTITIES.support.address}`].join('\n')
  const html = layout(why, `<h1 style="margin:0 0 12px;font-size:25px">Confirm your email</h1><p>${escapeHtml(why)}</p><div style="margin:22px 0;padding:18px;background:#FFF8EF;border-radius:12px;text-align:center;font-size:30px;font-weight:800;letter-spacing:8px">${escapeHtml(input.code)}</div><p>This code expires in 10 minutes. If you did not request it, ignore this message.</p>`, 'LumeX Fud', EMAIL_IDENTITIES.support.address)
  return { subject, text, html }
}

export function renderCaseAcknowledgement(input: { workflow: EmailWorkflow; name: string; reference: string; actionUrl: string }) {
  const policy = EMAIL_WORKFLOWS[input.workflow]
  const identity = EMAIL_IDENTITIES[policy.identity]
  const reply = EMAIL_IDENTITIES[policy.replyToIdentity].address
  const name = firstName(input.name)
  const subject = `We received your request — ${input.reference}`
  const reason = `You received this because you submitted a request to ${identity.displayName}.`
  const text = [`Hi ${name},`, '', reason, '', `Reference: ${input.reference}`, 'Status: Received', '', 'Our team will review it and reply from the correct department. Keep the reference above when following up.', '', `View contact options: ${input.actionUrl}`, '', identity.displayName, reply].join('\n')
  const html = layout(reason, `<p style="margin:0 0 8px">Hi ${escapeHtml(name)},</p><h1 style="margin:0 0 12px;font-size:25px">We received your request.</h1><p style="margin:0 0 16px">${escapeHtml(reason)}</p><div style="padding:15px;background:#FFF8EF;border-radius:12px"><strong>Reference</strong><br>${escapeHtml(input.reference)}<br><span style="color:#806B58">Status: Received</span></div><p>Our team will review it and reply from the correct department. Keep this reference when following up.</p>${button('View contact options', input.actionUrl)}`, identity.displayName, reply)
  return { subject, text, html }
}

export function renderApplicationEmail(input: { workflow: 'application_received' | 'application_approved' | 'application_rejected' | 'vendor_welcome' | 'rider_welcome'; name: string; kind: 'vendor' | 'rider'; reference: string; actionUrl: string; reason?: string | null }) {
  const policy = EMAIL_WORKFLOWS[input.workflow]
  const identity = EMAIL_IDENTITIES[policy.identity]
  const reply = EMAIL_IDENTITIES[policy.replyToIdentity].address
  const name = firstName(input.name)
  const approved = input.workflow === 'application_approved' || input.workflow.endsWith('_welcome')
  const rejected = input.workflow === 'application_rejected'
  const title = approved ? `Welcome to LumeX Fud as a ${input.kind}` : rejected ? 'An update on your application' : 'We received your application'
  const why = `You received this because you ${approved || rejected ? 'have an active' : 'submitted a'} ${input.kind} application with LumeX Fud.`
  const detail = approved ? 'Your application has been approved. Follow the onboarding instructions in your account.' : rejected ? `Your application was not approved at this time.${input.reason ? ` Reason: ${input.reason}` : ''}` : 'Our Careers team will review your details and contact you if anything else is needed.'
  const subject = `${title} — ${input.reference}`
  const text = [`Hi ${name},`, '', why, '', detail, '', `Reference: ${input.reference}`, '', `Continue: ${input.actionUrl}`, '', identity.displayName, `Reply: ${reply}`].join('\n')
  const html = layout(why, `<p style="margin:0 0 8px">Hi ${escapeHtml(name)},</p><h1 style="margin:0 0 12px;font-size:25px">${escapeHtml(title)}</h1><p>${escapeHtml(why)}</p><p>${escapeHtml(detail)}</p><div style="padding:15px;background:#FFF8EF;border-radius:12px"><strong>Application reference</strong><br>${escapeHtml(input.reference)}</div>${button(approved ? 'Start onboarding' : 'View application information', input.actionUrl)}`, identity.displayName, reply)
  return { subject, text, html }
}

export function renderCaseUpdate(input: { workflow: 'issue_status_update' | 'additional_information_request' | 'case_resolution' | 'security_case_update'; name: string; reference: string; status: string; publicMessage: string; actionUrl: string }) {
  const policy = EMAIL_WORKFLOWS[input.workflow]
  const identity = EMAIL_IDENTITIES[policy.identity]
  const reply = EMAIL_IDENTITIES[policy.replyToIdentity].address
  const title = input.workflow === 'case_resolution' ? 'Your case has been resolved' : input.workflow === 'additional_information_request' ? 'We need more information' : 'Your case has an update'
  const why = `You received this update because you opened case ${input.reference} with LumeX Fud.`
  const subject = `${title} — ${input.reference}`
  const text = [`Hi ${firstName(input.name)},`, '', why, '', input.publicMessage, '', `Status: ${input.status}`, `Reference: ${input.reference}`, '', `Contact us: ${input.actionUrl}`, '', identity.displayName, `Reply: ${reply}`].join('\n')
  const html = layout(why, `<p style="margin:0 0 8px">Hi ${escapeHtml(firstName(input.name))},</p><h1 style="margin:0 0 12px;font-size:25px">${escapeHtml(title)}</h1><p>${escapeHtml(why)}</p><p>${escapeHtml(input.publicMessage)}</p><div style="padding:15px;background:#FFF8EF;border-radius:12px"><strong>${escapeHtml(input.reference)}</strong><br>Status: ${escapeHtml(input.status)}</div>${button('View contact options', input.actionUrl)}`, identity.displayName, reply)
  return { subject, text, html }
}
