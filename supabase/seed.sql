-- Starter catalog (run once, from the SQL editor or as a migration)
insert into public.games (name, url, status) values
  ('GeoGuessr Daily Challenge', 'https://www.geoguessr.com/daily-challenges', 'approved'),
  ('TimeGuessr',               'https://timeguessr.com/',                     'approved'),
  ('Metrodoku',                'https://metrodoku.fr/',                       'approved'),
  ('Pédantix',                 'https://pedantix.certitudes.org/',            'approved'),
  ('Krillion',                 'https://krillion.io/',                        'approved'),
  ('Farflung',                 'https://farflung.game/',                      'approved')
on conflict (url) do nothing;
