-- Starter catalog (run once, from the SQL editor or as a migration)
insert into public.games (name, url, status) values
  ('GeoGuessr Daily Challenge', 'https://www.geoguessr.com/daily-challenges', 'approved'),
  ('TimeGuessr',               'https://timeguessr.com/',                     'approved'),
  ('Metrodoku',                'https://metrodoku.fr/',                       'approved'),
  ('Wordle',                   'https://www.nytimes.com/games/wordle/index.html', 'approved'),
  ('Connections',              'https://www.nytimes.com/games/connections',   'approved'),
  ('Worldle',                  'https://worldle.teuteuf.fr/',                 'approved'),
  ('Globle',                   'https://globle-game.com/',                    'approved'),
  ('Travle',                   'https://travle.earth/',                       'approved'),
  ('Framed',                   'https://framed.wtf/',                         'approved'),
  ('SUTOM',                    'https://sutom.nocle.fr/',                     'approved'),
  ('Cémantix',                 'https://cemantix.certitudes.org/',            'approved'),
  ('Contexto',                 'https://contexto.me/',                        'approved'),
  ('Pédantix',                 'https://pedantix.certitudes.org/',            'approved'),
  ('Krillion',                 'https://krillion.io/',                        'approved'),
  ('Farflung',                 'https://farflung.game/',                      'approved')
on conflict (url) do nothing;
