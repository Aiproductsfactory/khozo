/**
 * Sends one SMS through the configured gateway.
 *
 * Used for the registration OTP (shared/routes/auth.js) and for telling a
 * family about their case (shared/routes/reports.js). Both used to differ in
 * the one way that mattered: the OTP really went through the gateway, while
 * the family alert only set `smsSent: true` on the case and told the officer
 * "SMS sent" - with no gateway connected at all. An officer who believes the
 * family has been told does not call them.
 *
 * The gateway is a plain HTTPS endpoint taking `{ to, message }` as JSON with a
 * bearer key (KHOZO_SMS_GATEWAY_URL / KHOZO_SMS_API_KEY). Nothing here throws:
 * the answer is `{ sent: true }` or `{ sent: false, reason }`, and the caller
 * decides what a failure means for its own flow.
 */

const TIMEOUT_MS = 8000;

/** Whether both halves of the gateway configuration are present. */
export function smsGatewayConfigured(settings = {}) {
  return Boolean(settings.smsGatewayUrl && settings.smsApiKey);
}

/**
 * `{ sent: true }`, or `{ sent: false, reason }` where reason is
 * `no_gateway` (not configured) or `gateway_failed` (it refused, errored or
 * timed out; `status` carries its HTTP status when it answered).
 *
 * `fetchImpl` is injectable so tests never reach a real gateway.
 */
export async function sendSms({ to, message }, { settings = {}, fetchImpl = fetch } = {}) {
  if (!smsGatewayConfigured(settings)) return { sent: false, reason: 'no_gateway' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(settings.smsGatewayUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.smsApiKey}` },
      body: JSON.stringify({ to, message }),
      signal: controller.signal,
    });
    if (!res?.ok) return { sent: false, reason: 'gateway_failed', status: res?.status ?? null };
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: 'gateway_failed', status: null, detail: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}
