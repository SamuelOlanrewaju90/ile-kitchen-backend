// Wraps Termii's SMS API. If TERMII_API_KEY isn't set, this just logs
// what would have been sent instead of failing — so the rest of the app
// (orders, status updates) keeps working perfectly with zero cost while
// you're testing, and starts actually texting people the moment you add
// a real key.

function formatPhoneForTermii(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.startsWith('234')) return digits;
  if (digits.startsWith('0')) return '234' + digits.slice(1);
  return digits;
}

async function sendSMS(to, message) {
  if (!process.env.TERMII_API_KEY) {
    console.log(`[SMS not sent — no TERMII_API_KEY configured] To ${to}: ${message}`);
    return;
  }
  try {
    const response = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: formatPhoneForTermii(to),
        from: process.env.TERMII_SENDER_ID || 'N-Alert',
        sms: message,
        type: 'plain',
        channel: 'generic',
        api_key: process.env.TERMII_API_KEY
      })
    });
    const data = await response.json();
    if (!response.ok || data.code !== 'ok') {
      console.error('Termii SMS failed:', data);
    }
  } catch (err) {
    // SMS failures should never break the actual order flow — log and move on.
    console.error('SMS send error:', err);
  }
}

module.exports = { sendSMS };
