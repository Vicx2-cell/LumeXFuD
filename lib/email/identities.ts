export const EMAIL_DOMAIN = 'lumexfud.com.ng' as const

export type EmailIdentityKey =
  | 'hello'
  | 'support'
  | 'careers'
  | 'partners'
  | 'security'
  | 'press'
  | 'legal'
  | 'founder'
  | 'noreply'

export type EmailWorkflowCategory =
  | 'auth'
  | 'order'
  | 'support'
  | 'application'
  | 'partnership'
  | 'security'
  | 'press'
  | 'legal'
  | 'general'
  | 'founder'

export interface EmailIdentity {
  readonly address: `${string}@${typeof EMAIL_DOMAIN}`
  readonly displayName: string
  readonly purpose: string
  readonly defaultReplyTo: `${string}@${typeof EMAIL_DOMAIN}`
  readonly allowedWorkflowCategories: readonly EmailWorkflowCategory[]
  readonly publiclyDisplayable: boolean
  readonly manualUse: boolean
  readonly automatedUse: boolean
}

export const EMAIL_IDENTITIES = {
  hello: {
    address: 'hello@lumexfud.com.ng', displayName: 'LumeX Fud',
    purpose: 'General enquiries and default public contact.', defaultReplyTo: 'hello@lumexfud.com.ng',
    allowedWorkflowCategories: ['general'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  support: {
    address: 'support@lumexfud.com.ng', displayName: 'LumeX Support',
    purpose: 'Operational support for accounts, orders, payments, delivery, refunds and complaints.', defaultReplyTo: 'support@lumexfud.com.ng',
    allowedWorkflowCategories: ['support'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  careers: {
    address: 'careers@lumexfud.com.ng', displayName: 'LumeX Careers',
    purpose: 'Vendor, rider, ambassador, job and internship applications.', defaultReplyTo: 'careers@lumexfud.com.ng',
    allowedWorkflowCategories: ['application'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  partners: {
    address: 'partners@lumexfud.com.ng', displayName: 'LumeX Partnerships',
    purpose: 'Restaurant, university, sponsor, brand and strategic partnerships.', defaultReplyTo: 'partners@lumexfud.com.ng',
    allowedWorkflowCategories: ['partnership'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  security: {
    address: 'security@lumexfud.com.ng', displayName: 'LumeX Security',
    purpose: 'Vulnerability, suspicious-activity, fraud and account-security reports.', defaultReplyTo: 'security@lumexfud.com.ng',
    allowedWorkflowCategories: ['security'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  press: {
    address: 'press@lumexfud.com.ng', displayName: 'LumeX Press',
    purpose: 'Media enquiries, interviews, media assets and public relations.', defaultReplyTo: 'press@lumexfud.com.ng',
    allowedWorkflowCategories: ['press'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  legal: {
    address: 'legal@lumexfud.com.ng', displayName: 'LumeX Legal',
    purpose: 'Privacy, legal, regulatory and contractual correspondence.', defaultReplyTo: 'legal@lumexfud.com.ng',
    allowedWorkflowCategories: ['legal'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  founder: {
    address: 'chibuike@lumexfud.com.ng', displayName: 'Chibuike from LumeX Fud',
    purpose: 'Founder welcome, executive announcements and personal milestone correspondence only.', defaultReplyTo: 'chibuike@lumexfud.com.ng',
    allowedWorkflowCategories: ['founder'], publiclyDisplayable: true, manualUse: true, automatedUse: true,
  },
  noreply: {
    address: 'noreply@lumexfud.com.ng', displayName: 'LumeX Fud',
    purpose: 'Transactional authentication, order, payment, delivery and account notifications only.', defaultReplyTo: 'support@lumexfud.com.ng',
    allowedWorkflowCategories: ['auth', 'order'], publiclyDisplayable: false, manualUse: false, automatedUse: true,
  },
} as const satisfies Record<EmailIdentityKey, EmailIdentity>

export type EmailWorkflow =
  | 'customer_welcome' | 'vendor_welcome' | 'rider_welcome' | 'ambassador_welcome'
  | 'founder_announcement' | 'personal_milestone'
  | 'auth_otp' | 'password_reset' | 'email_verification' | 'login_security'
  | 'order_confirmation' | 'payment_receipt' | 'delivery_status' | 'refund_status' | 'account_system'
  | 'support_acknowledgement' | 'support_ticket_created' | 'complaint_received' | 'issue_status_update'
  | 'refund_dispute_update' | 'additional_information_request' | 'case_resolution'
  | 'application_received' | 'application_approved' | 'application_rejected' | 'application_invitation' | 'onboarding_instructions'
  | 'partnership_acknowledgement' | 'partnership_application_received' | 'sponsorship_acknowledgement'
  | 'security_report_acknowledgement' | 'fraud_report_acknowledgement' | 'suspicious_activity_case' | 'security_case_update'
  | 'privacy_request_acknowledgement' | 'deletion_request_acknowledgement' | 'legal_notice_acknowledgement'
  | 'press_acknowledgement'
  | 'general_contact_acknowledgement' | 'enquiry_reference_confirmation' | 'contact_routing_confirmation'

export interface EmailWorkflowPolicy {
  readonly category: EmailWorkflowCategory
  readonly identity: EmailIdentityKey
  readonly replyToIdentity: EmailIdentityKey
  readonly trigger: string
  readonly recipient: string
  readonly template: string
  readonly internalStatusUpdate: string
  readonly retryBehaviour: string
  readonly authorization: 'system' | 'admin' | 'founder'
  readonly displayNameOverride?: string
}

const retry = 'Resend idempotency key; retry transient provider failures up to 3 attempts; persist failure for admin review.'
const policy = (category: EmailWorkflowCategory, identity: EmailIdentityKey, replyToIdentity: EmailIdentityKey, trigger: string, recipient: string, template: string, internalStatusUpdate: string, authorization: EmailWorkflowPolicy['authorization'] = 'system'): EmailWorkflowPolicy =>
  ({ category, identity, replyToIdentity, trigger, recipient, template, internalStatusUpdate, retryBehaviour: retry, authorization })

export const EMAIL_WORKFLOWS: Record<EmailWorkflow, EmailWorkflowPolicy> = {
  customer_welcome: policy('founder', 'founder', 'hello', 'Customer account is created with its first valid email.', 'New customer.', 'customer-welcome', 'Mark welcome_email_sent_at after delivery.'),
  vendor_welcome: policy('founder', 'founder', 'careers', 'Admin approves a vendor application.', 'Approved vendor applicant.', 'vendor-welcome', 'Mark application approved and welcome delivery status.', 'admin'),
  rider_welcome: policy('founder', 'founder', 'careers', 'Admin approves a rider application.', 'Approved rider applicant.', 'rider-welcome', 'Mark application approved and welcome delivery status.', 'admin'),
  ambassador_welcome: policy('founder', 'founder', 'careers', 'Admin approves an ambassador application.', 'Approved ambassador applicant.', 'ambassador-welcome', 'Mark application approved and welcome delivery status.', 'admin'),
  founder_announcement: { ...policy('founder', 'founder', 'founder', 'Founder explicitly publishes an important announcement.', 'Selected audience.', 'founder-announcement', 'Record announcement delivery outcome.', 'founder'), displayNameOverride: 'Chibuike at LumeX Fud' },
  personal_milestone: { ...policy('founder', 'founder', 'founder', 'Founder explicitly selects a milestone message.', 'Selected recipient.', 'personal-milestone', 'Record milestone delivery outcome.', 'founder'), displayNameOverride: 'Chibuike at LumeX Fud' },
  auth_otp: policy('auth', 'noreply', 'support', 'An email OTP is requested without revealing account existence.', 'Address supplied to the authentication flow.', 'auth-otp', 'Record security notification delivery.'),
  password_reset: policy('auth', 'noreply', 'support', 'A password reset is requested.', 'Address supplied to the authentication flow.', 'password-reset', 'Record security notification delivery.'),
  email_verification: policy('auth', 'noreply', 'support', 'An email address needs verification.', 'Unverified account email.', 'email-verification', 'Record verification delivery.'),
  login_security: policy('auth', 'noreply', 'support', 'A qualifying login/security event occurs.', 'Affected account email.', 'login-security', 'Record security notification delivery.'),
  order_confirmation: policy('order', 'noreply', 'support', 'A paid order is durably created.', 'Ordering customer.', 'order-confirmation', 'Record provider ID against the order event.'),
  payment_receipt: policy('order', 'noreply', 'support', 'Payment is confirmed by a verified provider event.', 'Paying customer.', 'payment-receipt', 'Record receipt delivery against payment.'),
  delivery_status: policy('order', 'noreply', 'support', 'A customer-relevant delivery state is committed.', 'Ordering customer.', 'delivery-status', 'Record delivery update against status event.'),
  refund_status: policy('order', 'noreply', 'support', 'A refund state is committed.', 'Affected customer.', 'refund-status', 'Record refund notification delivery.'),
  account_system: policy('order', 'noreply', 'support', 'A qualifying account-system event is committed.', 'Affected account holder.', 'account-system', 'Record notification delivery.'),
  support_acknowledgement: policy('support', 'support', 'support', 'A support intent submission is saved.', 'Case requester.', 'support-acknowledgement', 'Set acknowledgement delivery state on case.'),
  support_ticket_created: policy('support', 'support', 'support', 'A support ticket is created.', 'Case requester.', 'support-ticket-created', 'Set ticket status to received.'),
  complaint_received: policy('support', 'support', 'support', 'A complaint is saved.', 'Complainant.', 'complaint-received', 'Set complaint status to received.'),
  issue_status_update: policy('support', 'support', 'support', 'An agent changes an issue state.', 'Case requester.', 'issue-status-update', 'Record notified_at on case.'),
  refund_dispute_update: policy('support', 'support', 'support', 'A refund/dispute state changes.', 'Affected customer.', 'refund-dispute-update', 'Record notified_at on dispute.'),
  additional_information_request: policy('support', 'support', 'support', 'An agent requests more information.', 'Case requester.', 'additional-information', 'Set case to awaiting_user.'),
  case_resolution: policy('support', 'support', 'support', 'An agent resolves a case.', 'Case requester.', 'case-resolution', 'Set case to resolved and record outcome.'),
  application_received: policy('application', 'careers', 'careers', 'A valid application is saved.', 'Applicant.', 'application-received', 'Set application to received and record acknowledgement.'),
  application_approved: policy('application', 'careers', 'careers', 'Admin approves an application.', 'Applicant.', 'application-approved', 'Set application to approved and record notified_at.', 'admin'),
  application_rejected: policy('application', 'careers', 'careers', 'Admin rejects an application.', 'Applicant.', 'application-rejected', 'Set application to rejected and record notified_at.', 'admin'),
  application_invitation: policy('application', 'careers', 'careers', 'Admin schedules an interview or inspection.', 'Applicant.', 'application-invitation', 'Set application to reviewing and record notified_at.', 'admin'),
  onboarding_instructions: policy('application', 'careers', 'careers', 'Admin starts onboarding.', 'Approved applicant.', 'onboarding-instructions', 'Record onboarding notification.', 'admin'),
  partnership_acknowledgement: policy('partnership', 'partners', 'partners', 'A partnership enquiry is saved.', 'Enquirer.', 'partnership-acknowledgement', 'Set case to received and assign partnerships queue.'),
  partnership_application_received: policy('partnership', 'partners', 'partners', 'A restaurant/institution application is saved.', 'Applicant.', 'partnership-application', 'Set application to received.'),
  sponsorship_acknowledgement: policy('partnership', 'partners', 'partners', 'A sponsorship enquiry is saved.', 'Enquirer.', 'sponsorship-acknowledgement', 'Set case to received.'),
  security_report_acknowledgement: policy('security', 'security', 'security', 'A security report is securely saved.', 'Reporter when an email is supplied.', 'security-report-acknowledgement', 'Set case to received and assign security queue.'),
  fraud_report_acknowledgement: policy('security', 'security', 'security', 'A fraud report is securely saved.', 'Reporter.', 'fraud-report-acknowledgement', 'Set case to received and assign security queue.'),
  suspicious_activity_case: policy('security', 'security', 'security', 'A suspicious-activity case is created.', 'Affected reporter/account contact.', 'suspicious-activity-case', 'Set case to reviewing.'),
  security_case_update: policy('security', 'security', 'security', 'An authorized investigator changes a case state.', 'Reporter when safe.', 'security-case-update', 'Record notified_at without logging evidence.', 'admin'),
  privacy_request_acknowledgement: policy('legal', 'legal', 'legal', 'A privacy request is saved.', 'Requestor.', 'privacy-request-acknowledgement', 'Set case to received and assign legal queue.'),
  deletion_request_acknowledgement: policy('legal', 'legal', 'legal', 'A deletion request is saved.', 'Requestor.', 'deletion-request-acknowledgement', 'Set case to received and assign legal queue.'),
  legal_notice_acknowledgement: policy('legal', 'legal', 'legal', 'A legal notice is saved.', 'Sender.', 'legal-notice-acknowledgement', 'Set case to received and assign legal queue.'),
  press_acknowledgement: policy('press', 'press', 'press', 'A media enquiry is saved.', 'Journalist/enquirer.', 'press-acknowledgement', 'Set case to received and assign press queue.'),
  general_contact_acknowledgement: policy('general', 'hello', 'hello', 'A general contact request is saved.', 'Enquirer.', 'general-contact-acknowledgement', 'Set case to received and assign general queue.'),
  enquiry_reference_confirmation: policy('general', 'hello', 'hello', 'A general enquiry reference is created.', 'Enquirer.', 'enquiry-reference', 'Record reference acknowledgement.'),
  contact_routing_confirmation: policy('general', 'hello', 'hello', 'A general request is re-routed.', 'Enquirer.', 'contact-routing', 'Record assigned queue and notified_at.'),
}

export function formatEmailIdentity(key: EmailIdentityKey, configuredDomain: string = EMAIL_DOMAIN, displayName?: string): string {
  const identity = EMAIL_IDENTITIES[key]
  const local = identity.address.split('@')[0]
  return `${displayName ?? identity.displayName} <${local}@${configuredDomain}>`
}
