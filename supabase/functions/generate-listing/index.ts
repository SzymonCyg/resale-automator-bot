const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { name, condition, size, price, packageSize } = await req.json();

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const prompt = `Jesteś ekspertem sprzedaży odzieży i obuwia na Vinted. Na podstawie surowych danych sprzedawcy przygotuj profesjonalne ogłoszenie.
Dane:
- Produkt: ${name || ''}
- Stan (opis sprzedawcy): ${condition || ''}
- Rozmiar: ${size || ''}
- Cena: ${price || ''}
- Wielkość paczki: ${packageSize || ''}
Zwróć TYLKO JSON:
{"title":"chwytliwy tytuł Vinted max 60 znaków po polsku (np. 'Białe sneakersy Nike Air Force 1 r.43')","description":"naturalny, rozbudowany opis po polsku: produkt, stan (KONIECZNIE uwzględnij wady wymienione przez sprzedawcę), rozmiar; 2-5 zdań; nie zmyślaj faktów","brand":"nazwa marki np. Nike lub '' gdy brak","category":"kategoria Vinted możliwie precyzyjnie, z płcią jeśli wynika, np. 'Mężczyźni > Obuwie > Sneakersy'","color":"jeden główny kolor po polsku jak w Vinted (Biały, Czarny, Czerwony...)","condition":"DOKŁADNIE jedna z: Nowy z metką | Nowy bez metki | Bardzo dobry | Dobry | Zadowalający"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return new Response(JSON.stringify({ error: `Anthropic API ${response.status}: ${err}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const data = await response.json();
    const raw = data.content?.[0]?.text || '';

    let parsed: {
      title?: string; description?: string; brand?: string;
      category?: string; color?: string; condition?: string;
    } = {};
    try {
      parsed = JSON.parse(raw.trim());
    } catch {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
      else throw new Error('AI nie zwróciło poprawnego JSON');
    }

    return new Response(JSON.stringify({
      title: parsed.title || '',
      description: parsed.description || '',
      brand: parsed.brand || '',
      category: parsed.category || '',
      color: parsed.color || '',
      condition: parsed.condition || '',
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
