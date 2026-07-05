// Study-Uni — public configuration
// The anon key and publishable key are safe to commit — they only allow what policies permit.
window.SU_CONFIG = {
  SUPABASE_URL: 'https://ntpnxvndjkaqlqwzquub.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_cQJKlMMxJYm4hyrQri2V1w_pGbHxzv2',
  STRIPE_PUBLISHABLE_KEY: 'pk_live_51SIVoD5nRvQshm57PqruaeqgweBHjrUU9X2hk7G9cFVhR9OtQXEKqsxgRFavWdKdetrg5IWIidm2SwaQ1awpr55200K7jSSK9M',
  // Stripe price IDs — fill in after creating prices in your Stripe dashboard
  STRIPE_PRICE_MONTHLY:  'price_1Tptzd5nRvQshm57jjSWRYJG',
  STRIPE_PRICE_SEMESTER: 'price_1Tptzy5nRvQshm57KALROrRF',
  STRIPE_PRICE_ANNUAL:   'price_1Tpu0T5nRvQshm57nUxvSkV3',
  // Emails that bypass the paywall and the UCC-email restriction.
  OWNER_EMAILS: ['jackatlantic06@gmail.com'],
  // Non-UCC emails granted full Pro access (but not owner/admin privileges).
  PRO_EMAILS: ['tommyatlantic13@gmail.com'],
};
