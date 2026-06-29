const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'ID хэрэгтэй' });

  const { data, error } = await supabase
    .from('reports')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Тайлан олдсонгүй' });

  res.setHeader('Cache-Control', 's-maxage=3600');
  return res.status(200).json(data);
};
