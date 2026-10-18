// The trafficking-risk reasons and levels (shared/trafficking.js), wrapped for
// translation. The server sends a code and an English label; the console
// shows the label for the code in the reader's language.
//
// Defined with a local msg so plain Node scripts can import this module.
const msg = (text) => text;

export const RISK_REASON_LABELS = {
  flagged_trafficking_risk: msg('Registered with a trafficking-risk flag'),
  child_labour_risk: msg('Registered with a child-labour risk flag'),
  abuse_risk: msg('Registered with an abuse or exploitation risk flag'),
  unaccompanied: msg('Unaccompanied when last seen or found'),
  adolescent: msg('Aged 12 to 17'),
  adolescent_girl: msg('A girl aged 12 to 17'),
  young_woman: msg('A woman aged 18 to 25'),
  lure_described: msg('Circumstances describe a job, marriage, online contact or agent'),
  work_mentioned: msg('Circumstances mention work or employment'),
  left_by_transport: msg('Circumstances mention a train, bus or station'),
  railway: msg('Found or produced through the railway (RPF)'),
  previously_missing: msg('Has been reported missing before'),
  district_cluster: msg('Three or more adolescents missing from this district within 30 days'),
};

export const RISK_BADGES = {
  high: { label: msg('Trafficking risk: high'), className: 'bg-red-100 text-red-800 ring-red-200' },
  elevated: { label: msg('Trafficking risk: elevated'), className: 'bg-amber-100 text-amber-800 ring-amber-200' },
};

/** The reason's label in the reader's language, or the server's English. */
export function riskReasonLabel(t, reason) {
  const label = RISK_REASON_LABELS[reason?.code];
  return label ? t(label) : reason?.label || '';
}
