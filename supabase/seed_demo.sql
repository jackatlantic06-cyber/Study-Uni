-- OPTIONAL: demo rows so you can try the /marketing dashboard before the
-- Monday jobs exist. Every row has is_demo = true; the publisher (Phase E)
-- will never send an is_demo post anywhere.
--
-- Remove them afterwards with the DELETE statements at the bottom.

insert into public.mkt_posts (post_key, week, platform, format, status, hook, caption, link, media, compliance, script, is_demo)
values
  ('demo-tt-01', 'demo', 'tiktok', 'carousel', 'pending_review',
   'POV: it''s week 12 and you still can''t find a single EC1101 past paper',
   'All UCC exam papers in one place so you can actually practise 📚 #UCC #revision',
   'https://study-uni.ie/?utm_source=tiktok&utm_medium=social&utm_campaign=demo&utm_content=demo-tt-01',
   '[{"kind":"image","url":"https://study-uni.ie/logo.png"}]',
   '{"passed":true,"warnings":[]}',
   '{"scenes":[{"text":"POV: week 12, still no past papers","onscreen":"week 12 panic"},{"text":"Every UCC past paper, one site","onscreen":"study-uni.ie"}]}',
   true),
  ('demo-ig-01', 'demo', 'instagram', 'carousel', 'pending_review',
   '5 ways to actually use past papers',
   'Save this for exam season. Past papers + marking schemes for 100+ UCC modules.',
   'https://study-uni.ie/?utm_source=instagram&utm_medium=social&utm_campaign=demo&utm_content=demo-ig-01',
   '[{"kind":"image","url":"https://study-uni.ie/logo.png"},{"kind":"image","url":"https://study-uni.ie/logo.png"}]',
   '{"passed":true,"warnings":[]}',
   '{"slides":[{"title":"Stop rereading notes"},{"title":"Time yourself"},{"title":"Mark it with the scheme"}]}',
   true)
on conflict (post_key) do nothing;

insert into public.mkt_comments (platform, external_id, author, body, category, reply_draft, status)
values
  ('tiktok', 'demo-c1', 'demo_user', 'is there EC1101 on it?', 'safe_question', 'Yep! EC1101 past papers are up 🙌 study-uni.ie', 'draft'),
  ('instagram', 'demo-c2', 'demo_user2', 'I got charged twice for pro??', 'needs_jack', null, 'needs_jack')
on conflict (platform, external_id) do nothing;

-- Clean up:
-- delete from public.mkt_posts where is_demo = true;
-- delete from public.mkt_comments where external_id like 'demo-%';
